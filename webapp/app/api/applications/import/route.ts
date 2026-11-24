import { NextResponse } from "next/server";
import { trackerIdentity, sameOrigin } from "../route";
import { putTrackedJob, validTrackedJob } from "@/lib/tracked-jobs-server";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const identity = await trackerIdentity();
  if (!identity) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    if (!Array.isArray(body?.jobs) || body.jobs.length > 500 || !body.jobs.every(validTrackedJob)) {
      return NextResponse.json({ error: "Invalid jobs" }, { status: 400 });
    }
    for (const job of body.jobs) await putTrackedJob(identity.userId, identity.preview, job, true);
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Tracker import failed" }, { status: 503 }); }
}