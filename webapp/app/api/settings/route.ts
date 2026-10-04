import { NextResponse } from "next/server";
import { listSettings, resetModeCache, updateSetting } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await listSettings();
    return NextResponse.json({ settings });
  } catch (err) {
    console.error("Failed to load settings", err);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { key, value, description } = body ?? {};

    if (!key) {
      return NextResponse.json({ error: "Missing key" }, { status: 400 });
    }

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
