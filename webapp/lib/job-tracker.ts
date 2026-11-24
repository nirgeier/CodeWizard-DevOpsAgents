export type JobStage = "saved" | "applied" | "screening" | "interview" | "offer" | "rejected" | "dismissed";

export interface TrackedJob {
  id: string;
  title: string;
  company: string;
  url: string;
  stage: JobStage;
  appliedAt: string;
  followUpAt: string;
  notes: string;
  updatedAt: string;
}

const STORAGE_KEY = "codewizard:tracked-jobs:v1";
export const TRACKER_CHANGE = "codewizard:tracked-jobs-change";

let cachedJobs: TrackedJob[] = [];
let pendingLoad: Promise<TrackedJob[]> | null = null;

async function fetchTrackedJobs(): Promise<TrackedJob[]> {
  const response = await fetch("/api/applications", { cache: "no-store" });
  if (!response.ok) throw new Error("Tracker unavailable");
  const { jobs } = await response.json() as { jobs: TrackedJob[] };
  const legacy = readTrackedJobs();
  if (legacy.length) {
    const imported = await fetch("/api/applications/import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobs: legacy }),
    });
    if (!imported.ok) throw new Error("Tracker import failed");
    localStorage.removeItem(STORAGE_KEY);
    return fetchTrackedJobs();
  }
  cachedJobs = jobs;
  window.dispatchEvent(new Event(TRACKER_CHANGE));
  return jobs;
}

export function loadTrackedJobs(refresh = false): Promise<TrackedJob[]> {
  if (!pendingLoad || refresh) {
    const request = fetchTrackedJobs();
    pendingLoad = request;
    void request.finally(() => { if (pendingLoad === request) pendingLoad = null; }).catch(() => {});
  }
  return pendingLoad;
}

export function cachedTrackedJobs(): TrackedJob[] {
  return cachedJobs;
}

export async function saveTrackedJob(job: TrackedJob): Promise<void> {
  const response = await fetch("/api/applications", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job),
  });
  if (!response.ok) throw new Error("Tracker save failed");
  await loadTrackedJobs(true);
}

export async function removeTrackedJob(id: string): Promise<void> {
  const response = await fetch(`/api/applications/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Tracker delete failed");
  await loadTrackedJobs(true);
}

export function readTrackedJobs(): TrackedJob[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is TrackedJob =>
      entry && typeof entry.id === "string" && typeof entry.title === "string" &&
      typeof entry.company === "string" && typeof entry.stage === "string" &&
      ["saved", "applied", "screening", "interview", "offer", "rejected"].includes(entry.stage));
  } catch {
    return [];
  }
}

export function writeTrackedJobs(jobs: TrackedJob[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
    window.dispatchEvent(new Event(TRACKER_CHANGE));
    return true;
  } catch {
    return false;
  }
}