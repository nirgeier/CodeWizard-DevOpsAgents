import { NextResponse } from "next/server";
import { getSession } from "@/lib/whatsapp/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Captured group messages.
 *
 * GET  ?jid=&limit=&q=&since=&kind=   read the store
 * POST { action: "history", jid, count }  ask the phone to push recent history
 * POST { action: "flush", jid }         persist anything still buffered
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const session = getSession();

  const jid = searchParams.get("jid") || undefined;
  const since = searchParams.get("since");
  const result = await session.listMessages({
    jid: jid || undefined,
    limit: Number(searchParams.get("limit") || 100),
    q: searchParams.get("q") || undefined,
    since: since ? Number(since) : undefined,
    kind: searchParams.get("kind") || undefined,
  });

  return NextResponse.json({
    ok: true,
    jid: jid || null,
    count: result.messages.length,
    total: result.total,
    store: result.store,
    messages: result.messages,
  });
}

export async function POST(request: Request) {
  const session = getSession();
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    /* empty body */
  }
  const action = String(body.action || "history");

  try {
    if (action === "history") {
      const jid = String(body.jid || "");
      if (!jid) return NextResponse.json({ error: "jid חסר" }, { status: 400 });
      const result = await session.fetchHistory(jid, Number(body.count || 50));
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "flush") {
      return NextResponse.json({ ok: true, store: { total: session.messages.size } });
    }
    return NextResponse.json({ error: `unknown action "${action}"` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String((err as Error)?.message || err) }, { status: 500 });
  }
}