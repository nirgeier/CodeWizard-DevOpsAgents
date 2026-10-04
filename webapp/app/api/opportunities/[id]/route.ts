import { NextRequest, NextResponse } from "next/server";
import { updateOpportunity } from "@/lib/db";
import type { OpportunityPatch } from "@/lib/types";

export const dynamic = "force-dynamic";

const ALLOWED_STATUS = new Set([
  "new",
  "review",
  "approved",
  "rejected",
  "contacted",
  "meeting",
  "lost",
  "archived",
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "body must be an object" },
      { status: 400 },
    );
  }

  const raw = body as Record<string, unknown>;
  const patch: OpportunityPatch = {};

  if ("status" in raw) {
    if (typeof raw.status !== "string" || !ALLOWED_STATUS.has(raw.status)) {
      return NextResponse.json(
        { ok: false, error: "invalid status" },
        { status: 400 },
      );
    }
    patch.status = raw.status;
  }
  if ("owner_notes" in raw) {
    if (raw.owner_notes !== null && typeof raw.owner_notes !== "string") {
      return NextResponse.json(
        { ok: false, error: "owner_notes must be a string or null" },
        { status: 400 },
      );
    }
    patch.owner_notes = (raw.owner_notes as string | null) ?? null;
  }
  if ("next_action" in raw) {
    if (raw.next_action !== null && typeof raw.next_action !== "string") {
      return NextResponse.json(
        { ok: false, error: "next_action must be a string or null" },
        { status: 400 },
      );
    }
    patch.next_action = (raw.next_action as string | null) ?? null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { ok: false, error: "no supported fields provided" },
      { status: 400 },
    );
  }

  const item = await updateOpportunity(id, patch);
  if (!item) {
    return NextResponse.json(
      { ok: false, error: "opportunity not found or update failed" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, item });
}
