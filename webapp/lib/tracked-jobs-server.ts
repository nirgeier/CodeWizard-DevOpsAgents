import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { authClient, authConfigured } from "./auth";
import type { TrackedJob } from "./job-tracker";

const previewFile = path.resolve(process.cwd(), "..", "data", "tracked_jobs.preview.json");
const stages = ["saved", "applied", "screening", "interview", "offer", "rejected", "dismissed"];

export function validTrackedJob(value: unknown): value is TrackedJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Record<string, unknown>;
  return typeof job.id === "string" && job.id.length > 0 && job.id.length <= 240 &&
    typeof job.title === "string" && job.title.length > 0 && job.title.length <= 200 &&
    typeof job.company === "string" && job.company.length > 0 && job.company.length <= 160 &&
    typeof job.url === "string" && job.url.length <= 2048 &&
    (!job.url || /^https?:\/\//i.test(job.url)) && stages.includes(String(job.stage)) &&
    typeof job.appliedAt === "string" && /^$|^\d{4}-\d{2}-\d{2}$/.test(job.appliedAt) &&
    typeof job.followUpAt === "string" && /^$|^\d{4}-\d{2}-\d{2}$/.test(job.followUpAt) &&
    typeof job.notes === "string" && job.notes.length <= 2000 &&
    typeof job.updatedAt === "string" && job.updatedAt.length <= 40 &&
    (!job.updatedAt || !Number.isNaN(Date.parse(job.updatedAt)));
}

function toRow(job: TrackedJob, userId: string) {
  return { user_id: userId, id: job.id, title: job.title, company: job.company,
    url: job.url, stage: job.stage, applied_at: job.appliedAt, follow_up_at: job.followUpAt,
    notes: job.notes, updated_at: job.updatedAt || new Date().toISOString() };
}

function fromRow(row: Record<string, string>): TrackedJob {
  return { id: row.id, title: row.title, company: row.company, url: row.url,
    stage: row.stage as TrackedJob["stage"], appliedAt: row.applied_at,
    followUpAt: row.follow_up_at, notes: row.notes, updatedAt: row.updated_at };
}

async function readPreview(): Promise<Record<string, ReturnType<typeof toRow>[]>> {
  try { return JSON.parse(await fs.readFile(previewFile, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function listTrackedJobs(userId: string, preview: boolean): Promise<TrackedJob[]> {
  if (preview) return (await readPreview())[userId]?.map(fromRow) ?? [];
  if (!authConfigured()) throw new Error("Auth not configured");
  const { data, error } = await (await authClient()).from("tracked_jobs").select("*").eq("user_id", userId).order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

export async function putTrackedJob(userId: string, preview: boolean, job: TrackedJob, importOnly = false): Promise<void> {
  const row = toRow(job, userId);
  if (preview) {
    const store = await readPreview();
    const existing = store[userId] ?? [];
    if (!importOnly || !existing.some((item) => item.id === job.id)) {
      store[userId] = [row, ...existing.filter((item) => item.id !== job.id)];
      await fs.writeFile(previewFile, JSON.stringify(store), { mode: 0o600 });
    }
    return;
  }
  if (!authConfigured()) throw new Error("Auth not configured");
  const client = await authClient();
  if (importOnly) {
    const { data, error } = await client.from("tracked_jobs").select("id").eq("user_id", userId).eq("id", job.id).maybeSingle();
    if (error) throw error;
    if (data) return;
  }
  const { error } = await client.from("tracked_jobs").upsert(row, { onConflict: "user_id,id", ignoreDuplicates: importOnly });
  if (error) throw error;
}

export async function deleteTrackedJob(userId: string, preview: boolean, id: string): Promise<void> {
  if (preview) {
    const store = await readPreview();
    store[userId] = (store[userId] ?? []).filter((item) => item.id !== id);
    await fs.writeFile(previewFile, JSON.stringify(store), { mode: 0o600 });
    return;
  }
  if (!authConfigured()) throw new Error("Auth not configured");
  const { error } = await (await authClient()).from("tracked_jobs").delete().eq("user_id", userId).eq("id", id);
  if (error) throw error;
}