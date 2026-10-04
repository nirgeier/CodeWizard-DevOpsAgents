import { NextResponse } from "next/server";
import { getMode } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const mode = await getMode();
  return NextResponse.json({ ok: true, mode });
}