import { NextResponse } from "next/server";
import { listJobs } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source");
  const company = searchParams.get("company");
  const isDevops = searchParams.get("is_devops");
  const minScore = searchParams.get("min_score");
  const limit = searchParams.get("limit");

  try {
    const jobs = await listJobs({
      source: source || undefined,
      company: company || undefined,
      is_devops: isDevops ? isDevops === "true" : undefined,
      minScore: minScore ? Number(minScore) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    return NextResponse.json({ jobs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}