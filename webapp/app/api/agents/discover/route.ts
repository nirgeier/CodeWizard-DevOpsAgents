import { NextResponse } from "next/server";
import { getDiscoveryState, startDiscovery } from "@/lib/agent-runner";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getDiscoveryState());
}

export async function POST(request: Request) {
  const input = await request.json().catch(() => ({}));
  return NextResponse.json(startDiscovery(Number(input?.limit) || 30));
}
