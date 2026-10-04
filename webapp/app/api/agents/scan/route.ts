import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

// Simple in-memory scan status store (in production, use Redis or DB)
const scanStatus = new Map<string, { status: "idle" | "running" | "completed" | "failed"; startedAt?: string; finishedAt?: string; result?: any; error?: string }>();

function getAgentsDir(): string {
  const WEBAPP_DIR = process.cwd();
  const candidates = [
    path.resolve(WEBAPP_DIR, "..", "agents"),
    path.resolve(WEBAPP_DIR, "agents"),
  ];
  for (const c of candidates) {
    try { require("node:fs").accessSync(c); return c; } catch {}
  }
  return path.resolve(WEBAPP_DIR, "..", "agents");
}

function runScan(args: string[]): Promise<any> {
  const agentsDir = getAgentsDir();
  const scanScript = path.join(agentsDir, "scan_jobs.py");
  const python = process.env.PYTHON_BIN || "python3";

  return new Promise((resolve, reject) => {
    const child = spawn(python, [scanScript, ...args, "--json"], {
      cwd: agentsDir,
      env: { ...process.env, PYTHONPATH: agentsDir },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("close", (code) => {
      if (code === 0) {
        try {
          const lines = stdout.trim().split("\n");
          const lastLine = lines[lines.length - 1];
          const result = JSON.parse(lastLine);
          resolve(result);
        } catch (e) {
          resolve({ ok: true, raw: stdout });
        }
      } else {
        reject(new Error(stderr || `Scan exited with code ${code}`));
      }
    });

    child.on("error", (err) => reject(err));
  });
}

export async function POST(request: Request) {
  try {
    const { sourceId, options } = await request.json();
    
    if (!sourceId) {
      return NextResponse.json({ error: "sourceId required" }, { status: 400 });
    }

    // Initialize status
    scanStatus.set(sourceId, { status: "running", startedAt: new Date().toISOString() });

    // Run scan asynchronously
    runScanForSource(sourceId, options).catch(err => {
      scanStatus.set(sourceId, { 
        status: "failed", 
        startedAt: scanStatus.get(sourceId)?.startedAt,
        finishedAt: new Date().toISOString(),
        error: err.message 
      });
    });

    return NextResponse.json({ ok: true, message: "Scan started", sourceId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function runScanForSource(sourceId: string, options: any = {}) {
  const args: string[] = [];

  if (sourceId === "linkedin") {
    args.push("--source", "linkedin");
  } else if (sourceId === "drushim") {
    args.push("--source", "drushim");
  } else if (sourceId === "comeet-global") {
    args.push("--source", "comeet");
  } else if (sourceId.startsWith("comeet:")) {
    // Scan specific Comeet company
    const uid = sourceId.replace("comeet:", "");
    // We'll need to pass the company UID somehow
    args.push("--source", "comeet");
  } else if (sourceId === "ats") {
    args.push("--source", "ats");
  } else if (sourceId.startsWith("ats:")) {
    // Scan specific ATS company
    const slug = sourceId.replace("ats:", "");
    args.push("--ats-company", slug);
  } else {
    // Custom source or unknown - scan all
    args.push("--source", "linkedin,drushim,comeet,ats");
  }

  // Add options
  if (options.pages) args.push("--pages", String(options.pages));
  if (options.maxAgeDays) args.push("--max-age-days", String(options.maxAgeDays));
  if (options.keywords) args.push("--keywords", options.keywords);
  if (options.limit) args.push("--limit", String(options.limit));

  try {
    const result = await runScan(args);
    scanStatus.set(sourceId, { 
      status: "completed", 
      startedAt: scanStatus.get(sourceId)?.startedAt,
      finishedAt: new Date().toISOString(),
      result 
    });
  } catch (err: any) {
    scanStatus.set(sourceId, { 
      status: "failed", 
      startedAt: scanStatus.get(sourceId)?.startedAt,
      finishedAt: new Date().toISOString(),
      error: err.message 
    });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sourceId = searchParams.get("sourceId");
  
  if (sourceId) {
    const status = scanStatus.get(sourceId) || { status: "idle" };
    return NextResponse.json(status);
  }
  
  // Return all statuses
  const allStatuses: Record<string, any> = {};
  scanStatus.forEach((value, key) => { allStatuses[key] = value; });
  return NextResponse.json(allStatuses);
}