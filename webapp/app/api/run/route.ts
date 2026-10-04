import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resolve agents/ relative to this repo instead of hardcoding an absolute path:
// the old value pointed at the previous CodeWizard/sales checkout, so the UI's
// "Run pipeline" button spawned python3 in a directory that did not exist.
const AGENTS_DIR = path.resolve(process.cwd(), "..", "agents");
const TIMEOUT_MS = 120_000;
const MAX_LOG = 40_000;

export async function GET() {
  return NextResponse.json({ ok: false, error: "POST to run" });
}

export async function POST() {
  const result = await new Promise<{
    ok: boolean;
    code: number;
    log: string;
  }>((resolve) => {
    let log = "";
    let settled = false;

    const finish = (ok: boolean, code: number, extra = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (extra) log += extra;
      if (log.length > MAX_LOG) log = log.slice(-MAX_LOG);
      resolve({ ok, code, log });
    };

    let child;
    try {
      child = spawn("python3", ["run.py", "--json"], {
        cwd: AGENTS_DIR,
        env: process.env,
      });
    } catch (err) {
      finish(false, -1, `\n[spawn error] ${String(err)}`);
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      finish(false, -1, "\n[timeout] pipeline exceeded 120s and was killed");
    }, TIMEOUT_MS);

    child.stdout?.on("data", (chunk) => {
      log += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      log += chunk.toString();
    });
    child.on("error", (err) => {
      finish(false, -1, `\n[process error] ${String(err)}`);
    });
    child.on("close", (code) => {
      finish(code === 0, code ?? -1);
    });
  });

  return NextResponse.json(result);
}
