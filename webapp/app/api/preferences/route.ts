import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/auth";
import { getPreferences, savePreferences, type UserPreferences } from "@/lib/db";
import { parseWeights } from "@/lib/fit";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!await currentUserId()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ preferences: await getPreferences() });
  } catch (error) {
    console.error("Preferences load failed", error);
    return NextResponse.json({ error: "Preferences unavailable" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  if (!await currentUserId()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const fields = ["full_name", "linkedin_url", "github_url", "cv_url"] as const;
    if (fields.some((field) => typeof body?.[field] !== "string" || body[field].length > 2048) ||
        !Array.isArray(body.keyword_weights) ||
        body.keyword_weights.length !== parseWeights(body.keyword_weights).length ||
        typeof body.alerts_enabled !== "boolean" ||
        !Number.isInteger(body.alert_min_score) || body.alert_min_score < 0 || body.alert_min_score > 100) {
      return NextResponse.json({ error: "Invalid preferences" }, { status: 400 });
    }
    for (const field of ["linkedin_url", "github_url", "cv_url"] as const) {
      if (!body[field]) continue;
      const url = new URL(body[field]);
      if (url.protocol !== "https:") return NextResponse.json({ error: "Only HTTPS links are allowed" }, { status: 400 });
    }
    const preferences: Omit<UserPreferences, "user_id" | "updated_at"> = {
      full_name: body.full_name.trim().slice(0, 200),
      linkedin_url: body.linkedin_url,
      github_url: body.github_url,
      cv_url: body.cv_url,
      keyword_weights: parseWeights(body.keyword_weights),
      alerts_enabled: body.alerts_enabled,
      alert_min_score: body.alert_min_score,
    };
    await savePreferences(preferences);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    console.error("Preferences save failed", error);
    return NextResponse.json({ error: "Preferences unavailable" }, { status: 500 });
  }
}