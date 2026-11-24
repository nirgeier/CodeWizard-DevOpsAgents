import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/auth";
import { listTrackedJobs, putTrackedJob, validTrackedJob } from "@/lib/tracked-jobs-server";

export const dynamic = "force-dynamic";

export async function trackerIdentity() {
  const userId = await currentUserId();
  return userId ? { userId, preview: userId === "00000000-0000-0000-0000-000000000001" } : null;
}

export function sameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}

export async function GET() {
  const identity = await trackerIdentity();
  if (!identity) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ jobs: await listTrackedJobs(identity.userId, identity.preview) }); }
  catch { return NextResponse.json({ error: "Tracker unavailable" }, { status: 503 }); }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const identity = await trackerIdentity();
  if (!identity) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const job: unknown = await request.json();
    if (!validTrackedJob(job)) return NextResponse.json({ error: "Invalid job" }, { status: 400 });
    await putTrackedJob(identity.userId, identity.preview, job);
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Tracker unavailable" }, { status: 503 }); }
}