import { NextResponse } from "next/server";
import { getSession } from "@/lib/whatsapp/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET - list the account's groups. Pass ?refresh=1 to re-fetch from WhatsApp. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const session = getSession();

  if (!session.isRunning()) {
    return NextResponse.json(
      { ok: false, error: "הסשן לא מחובר", groups: [], monitored: session.monitoredJids() },
      { status: 409 },
    );
  }

  if (searchParams.get("refresh") === "1" || session.listGroups().length === 0) {
    await session.refreshGroups();
  }

  return NextResponse.json({
    ok: true,
    groups: session.listGroups(),
    monitored: session.monitoredJids(),
  });
}

/**
 * POST - choose which groups to capture messages from.
 *
 *   { action: "monitor",   jids: [...] }
 *   { action: "unmonitor", jids: [...] }
 *   { action: "join",      code: "chat.whatsapp.com/XXXX" }
 *   { action: "leave",     jid: "123@g.us" }
 */
export async function POST(request: Request) {
  const session = getSession();
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    /* empty body */
  }

  const action = String(body.action || "");

  try {
    if (action === "monitor" || action === "unmonitor") {
      const jids = Array.isArray(body.jids) ? (body.jids as string[]) : [];
      if (!jids.length) {
        return NextResponse.json({ error: "jids חסר" }, { status: 400 });
      }
      const changed = await session.setMonitored(jids, action === "monitor");
      return NextResponse.json({
        ok: true,
        changed,
        monitored: session.monitoredJids(),
        groups: session.listGroups(),
      });
    }

    if (action === "join") {
      const code = String(body.code || "");
      const clean = await session.joinByInvite(code);
      return NextResponse.json({
        ok: true,
        joined: clean,
        link: `https://chat.whatsapp.com/${clean}`,
        groups: session.listGroups(),
      });
    }

    if (action === "leave") {
      await session.leaveGroup(String(body.jid || ""));
      return NextResponse.json({ ok: true, monitored: session.monitoredJids(), groups: session.listGroups() });
    }

    return NextResponse.json({ error: `unknown action "${action}"` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String((err as Error)?.message || err) }, { status: 500 });
  }
}