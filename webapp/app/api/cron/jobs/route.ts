import { NextResponse } from "next/server";
import { runJobScan } from "@/lib/job-scan-runner";
import { startDiscovery } from "@/lib/agent-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let running = false;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (running) return NextResponse.json({ error: "A job scan is already running" }, { status: 409 });
  running = true;
  try {
    const result = await runJobScan([]);
    const discovery = startDiscovery();
    return NextResponse.json({ ...result, discovery: discovery.status });
  } catch (error) {
    console.error("Scheduled job scan failed", error);
    return NextResponse.json({ error: "Job scan failed" }, { status: 503 });
  } finally {
    running = false;
  }
}