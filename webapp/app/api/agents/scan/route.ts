import { NextResponse } from "next/server";
import { agentScanStatuses, latestAgentScan } from "@/lib/db";
import { startSourceScan } from "@/lib/agent-runner";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { sourceId, options } = await request.json();
    
    if (typeof sourceId !== "string" || !sourceId || sourceId.length > 200) {
      return NextResponse.json({ error: "sourceId required" }, { status: 400 });
    }

    const { finished, startedAt } = await startSourceScan(sourceId, options ?? {});
    finished.catch(err => console.error("Failed to finish agent scan:", err));

    return NextResponse.json({ ok: true, message: "Scan started", sourceId, startedAt });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sourceId = searchParams.get("sourceId");
  
  try {
    return NextResponse.json(sourceId ? await latestAgentScan(sourceId) : await agentScanStatuses());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load scans" }, { status: 500 });
  }
}