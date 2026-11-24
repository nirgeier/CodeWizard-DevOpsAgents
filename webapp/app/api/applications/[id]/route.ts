import { NextResponse } from "next/server";
import { trackerIdentity, sameOrigin } from "../route";
import { deleteTrackedJob } from "@/lib/tracked-jobs-server";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const identity = await trackerIdentity();
  if (!identity) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!id || id.length > 240) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    await deleteTrackedJob(identity.userId, identity.preview, id);
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Tracker unavailable" }, { status: 503 }); }
}