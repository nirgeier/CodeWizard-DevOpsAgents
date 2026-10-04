import { NextResponse } from "next/server";
import { getSession, WA_AUTH_DIR } from "@/lib/whatsapp/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live WhatsApp session state for the /whatsapp tab. */
export async function GET() {
  const session = getSession();
  return NextResponse.json({
    ok: true,
    ...session.state(),
    monitored: session.monitoredJids(),
    sessionDir: WA_AUTH_DIR,
  });
}