import { NextResponse } from "next/server";
import { getRunAllState, startRunAll } from "@/lib/agent-runner";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getRunAllState());
}

export async function POST(request: Request) {
  const input = await request.json().catch(() => ({}));
  const pages = Math.min(Math.max(Number(input?.pages) || 2, 1), 5);
  return NextResponse.json(startRunAll({ discover: input?.discover !== false, scanOptions: { pages } }));
}
