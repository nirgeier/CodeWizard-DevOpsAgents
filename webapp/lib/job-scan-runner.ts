import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import { accessSync } from "node:fs";

function getAgentsDir(): string {
  const webappDir = process.cwd();
  const candidates = [path.resolve(webappDir, "..", "agents"), path.resolve(webappDir, "agents")];
  for (const candidate of candidates) {
    try { accessSync(candidate); return candidate; } catch { /* try next */ }
  }
  return path.resolve(webappDir, "..", "agents");
}

export const AGENT_SCRIPT_TIMEOUT_MS = 20 * 60 * 1000;

export function runAgentScript(
  script: string, args: string[], timeoutMs = AGENT_SCRIPT_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const agentsDir = getAgentsDir();
  const scriptPath = path.join(agentsDir, script);
  const python = process.env.PYTHON_BIN || "python3";

  return new Promise((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ python, [scriptPath, ...args, "--json"], {
      cwd: agentsDir,
      env: { ...process.env, PYTHONPATH: agentsDir },
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${script} timed out after ${Math.round(timeoutMs / 60000)} minutes`));
    }, timeoutMs);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr = (stderr + data.toString()).slice(-4000); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.trim() || `${script} exited with code ${code}`));
      try {
        resolve(JSON.parse(stdout.trim().split("\n").at(-1) || ""));
      } catch {
        reject(new Error(`${script} did not return a valid summary`));
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export function runJobScan(args: string[]): Promise<Record<string, unknown>> {
  return runAgentScript("scan_jobs.py", args);
}