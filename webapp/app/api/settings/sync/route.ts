import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/auth";
import { syncMissingData, syncStatus } from "@/lib/db";

export const dynamic = "force-dynamic";

const MODES = ["local", "postgres", "supabase"] as const;
type Mode = typeof MODES[number];

function validMode(value: string | null): value is Mode {
  return MODES.some((mode) => mode === value);
}

export async function GET(request: Request) {
  if (!await currentUserId()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const source = url.searchParams.get("source");
  const target = url.searchParams.get("target");
  if (!validMode(source) || !validMode(target) || source === target) {
    return NextResponse.json({ error: "Choose two different storage locations" }, { status: 400 });
  }
  try {
    return NextResponse.json({ tables: await syncStatus(source, target) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sync check failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!await currentUserId()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (new URL(request.url).origin !== request.headers.get("origin")) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  let source: unknown;
  let target: unknown;
  try {
    ({ source, target } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (typeof source !== "string" || typeof target !== "string" ||
      !validMode(source) || !validMode(target) || source === target) {
    return NextResponse.json({ error: "Choose two different storage locations" }, { status: 400 });
  }
  try {
    return NextResponse.json({ results: await syncMissingData(source, target) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sync failed" }, { status: 500 });
  }
}