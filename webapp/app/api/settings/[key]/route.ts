import { NextResponse } from "next/server";
import { getSetting, resetModeCache, updateSetting } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const setting = await getSetting(key);
    if (!setting) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ setting });
  } catch (err) {
    console.error("Failed to load setting", err);
    return NextResponse.json({ error: "Failed to load setting" }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const body = await req.json();
    const { value, description } = body ?? {};

    const setting = await updateSetting(key, value, description ?? null);
    if (!setting) {
      return NextResponse.json({ error: "Failed to save setting" }, { status: 500 });
    }

    if (key === "storage_mode") {
      resetModeCache();
    }

    return NextResponse.json({ setting });
  } catch (err) {
    console.error("Failed to save setting", err);
    return NextResponse.json({ error: "Failed to save setting" }, { status: 500 });
  }
}
