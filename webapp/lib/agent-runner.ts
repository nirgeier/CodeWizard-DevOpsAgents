import "server-only";
import { finishAgentScan, startAgentScan } from "@/lib/db";
import { listAgentSources, scanArgsForSource } from "@/lib/agent-sources";
import { runAgentScript, runJobScan } from "@/lib/job-scan-runner";

export interface DiscoveryState {
  status: "idle" | "running" | "completed" | "failed";
  startedAt?: string;
  finishedAt?: string;
  result?: Record<string, unknown>;
  error?: string;
}

export interface RunAllState {
  status: "idle" | "running" | "completed";
  startedAt?: string;
  finishedAt?: string;
  total: number;
  done: number;
  failed: number;
  running: string[];
  discover: boolean;
  discovery?: DiscoveryState;
}

const RUN_ALL_CONCURRENCY = Math.max(1, Number(process.env.AGENTS_CONCURRENCY) || 4);

// Kept on globalThis so state survives dev-mode module reloads.
const state = globalThis as typeof globalThis & {
  __agentsRunAll?: RunAllState;
  __agentsDiscovery?: DiscoveryState;
};
state.__agentsRunAll ??= { status: "idle", total: 0, done: 0, failed: 0, running: [], discover: false };
state.__agentsDiscovery ??= { status: "idle" };

export async function startSourceScan(sourceId: string, options: Record<string, unknown> = {}) {
  const { id, startedAt } = await startAgentScan(sourceId, options);
  const finished = (async () => {
    try {
      const result = await runJobScan(scanArgsForSource(sourceId, options));
      await finishAgentScan(id, { status: "completed", finishedAt: new Date().toISOString(), result });
      return true;
    } catch (err) {
      await finishAgentScan(id, {
        status: "failed", finishedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      }).catch((e) => console.error("Failed to record agent scan failure:", e));
      return false;
    }
  })();
  return { id, startedAt, finished };
}

export function getRunAllState(): RunAllState {
  return { ...state.__agentsRunAll!, discovery: state.__agentsDiscovery };
}

export function getDiscoveryState(): DiscoveryState {
  return state.__agentsDiscovery!;
}

export function startDiscovery(limit = 30): DiscoveryState {
  const current = state.__agentsDiscovery!;
  if (current.status === "running") return current;
  const next: DiscoveryState = { status: "running", startedAt: new Date().toISOString() };
  state.__agentsDiscovery = next;
  runAgentScript("scripts/auto_discover_agents.py", ["--limit", String(Math.min(Math.max(limit, 1), 200))])
    .then((result) => { state.__agentsDiscovery = { ...next, status: "completed", finishedAt: new Date().toISOString(), result }; })
    .catch((err) => {
      state.__agentsDiscovery = {
        ...next, status: "failed", finishedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      };
    });
  return next;
}

export function startRunAll(options: { discover?: boolean; scanOptions?: Record<string, unknown> } = {}): RunAllState {
  const current = state.__agentsRunAll!;
  if (current.status === "running") return getRunAllState();

  const sources = listAgentSources().filter((s) => s.enabled);
  // "Comeet (all)" re-scans every configured Comeet company, which run-all already covers one by one.
  const hasComeet = sources.some((s) => s.type === "comeet");
  const queue = sources.filter((s) => !(hasComeet && s.id === "comeet-global")).map((s) => s.id);

  const run: RunAllState = {
    status: "running", startedAt: new Date().toISOString(),
    total: queue.length, done: 0, failed: 0, running: [], discover: !!options.discover,
  };
  state.__agentsRunAll = run;

  const worker = async () => {
    for (let sourceId = queue.shift(); sourceId; sourceId = queue.shift()) {
      run.running.push(sourceId);
      try {
        const { finished } = await startSourceScan(sourceId, options.scanOptions ?? { pages: 2 });
        if (!(await finished)) run.failed++;
      } catch (err) {
        console.error(`Run-all: failed to scan ${sourceId}:`, err);
        run.failed++;
      } finally {
        run.running = run.running.filter((id) => id !== sourceId);
        run.done++;
      }
    }
  };

  Promise.all(Array.from({ length: RUN_ALL_CONCURRENCY }, worker)).then(() => {
    run.status = "completed";
    run.finishedAt = new Date().toISOString();
    if (run.discover) startDiscovery();
  });
  return getRunAllState();
}
