import { NextRequest, NextResponse } from "next/server";
import { listOpportunities } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const minConfidenceRaw = searchParams.get("minConfidence");
  const minConfidence =
    minConfidenceRaw != null && minConfidenceRaw !== ""
      ? Number(minConfidenceRaw)
      : null;
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 200;

  const items = await listOpportunities({
    status: status || null,
    minConfidence: Number.isFinite(minConfidence as number)
      ? (minConfidence as number)
      : null,
    limit: Number.isFinite(limit) ? limit : 200,
  });

  return NextResponse.json({ items });
}
