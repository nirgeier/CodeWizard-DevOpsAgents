import type { DevOpsJob } from "./types";

export interface KeywordWeight {
  term: string;
  weight: number;
}

export function parseWeights(value: unknown): KeywordWeight[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, KeywordWeight>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const term = typeof entry.term === "string" ? entry.term.trim() : "";
    const weight = entry.weight;
    if (!term || term.length > 80 || !Number.isInteger(weight) || weight < 1 || weight > 100) continue;
    unique.set(term.toLocaleLowerCase(), { term, weight });
  }
  return [...unique.values()];
}

export function scoreFit(job: DevOpsJob, weights: KeywordWeight[]) {
  if (!weights.length) return { score: Number(job.score) || 0, matches: [] as KeywordWeight[] };
  const text = [job.title, job.company, job.location, job.work_mode, job.description]
    .filter(Boolean)
    .join(" ")
    .replace(/<[^>]*>/g, " ")
    .toLocaleLowerCase();
  const matches = weights.filter(({ term }) => {
    const escaped = term.toLocaleLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").test(text);
  });
  const total = weights.reduce((sum, item) => sum + item.weight, 0);
  const matched = matches.reduce((sum, item) => sum + item.weight, 0);
  return { score: Math.round((matched / total) * 100), matches };
}