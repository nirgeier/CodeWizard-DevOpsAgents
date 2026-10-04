import { NextResponse } from "next/server";
import { getSession } from "@/lib/whatsapp/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Control the WhatsApp socket.
 *
 *   { action: "start" }    open the socket (pairing if needed, connect if not)
 *   { action: "stop" }     close it
 *   { action: "restart" }  close and reopen - the fix for a wedged socket
 *
 * `start` returns as soon as the socket is created; the QR (or the connect)
 * arrives afterwards through /api/whatsapp/events.
 */
export async function POST(request: Request) {
  let action = "start";
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.action) action = String(body.action);
  } catch {
    /* empty body = start */
  }

  const session = getSession();

  try {
    if (action === "stop") {
      await session.stop();
    } else if (action === "restart") {
      await session.restart();
    } else if (action === "start") {
      await session.start();
    } else {
      return NextResponse.json({ error: `unknown action "${action}"` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String((err as Error)?.message || err), ...session.state() },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, ...session.state() });
}