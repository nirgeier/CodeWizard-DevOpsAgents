// Server-only data layer for the CodeWizard Jobs Intelligence webapp.
// Two backends:
//   * "supabase" - REST calls against SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY
//   * "local"    - JSON files under <repo>/data
// The app auto-detects which one to use at runtime, but the UI never shows it.

import fs from "node:fs";
import path from "node:path";
import type {
  Company,
  DataMode,
  DevOpsJob,
  ListJobsArgs,
  ListOpportunitiesArgs,
  Opportunity,
  OpportunityPatch,
  Person,
  Scan,
  Signal,
  Stats,
} from "./types";

// Resolve paths relative to the running webapp so the tool works from both the
// repo root and the internal-app/ bundle (next dev runs with cwd = webapp dir).
const WEBAPP_DIR = process.cwd();

function firstExisting(candidates: string[], fallback: string): string {
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }
  return fallback;
}

const WEB_ENV_PATH = firstExisting(
  [
    path.resolve(WEBAPP_DIR, "..", "..", "web", ".env"), // internal-app/web/.env
    path.resolve(WEBAPP_DIR, "..", "web", ".env"),
    path.resolve(WEBAPP_DIR, "web", ".env"),
  ],
  path.resolve(WEBAPP_DIR, "..", "..", "web", ".env"),
);

const DATA_DIR = firstExisting(
  [path.resolve(WEBAPP_DIR, "..", "data"), path.resolve(WEBAPP_DIR, "data")],
  path.resolve(WEBAPP_DIR, "..", "data"),
);

// ---------------------------------------------------------------------------
// Env resolution (env vars, with a fallback read of web/.env at import time)
// ---------------------------------------------------------------------------

function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const text = fs.readFileSync(file, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key) out[key] = value;
    }
  } catch {
    // ignore - env vars may still be set in the process
  }
  return out;
}

const fileEnv = parseEnvFile(WEB_ENV_PATH);

const SUPABASE_URL = (process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || "").replace(
  /\/+$/,
  "",
);
const SUPABASE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || fileEnv.SUPABASE_PUBLISHABLE_KEY || "";

// ---------------------------------------------------------------------------
// Mode detection (cached)
// ---------------------------------------------------------------------------

let modePromise: Promise<DataMode> | null = null;

function supabaseHeaders(): Record<string, string> {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Accept: "application/json",
  };
}

async function detectMode(): Promise<DataMode> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return "local";
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/opportunities?select=id&limit=1`,
      { headers: supabaseHeaders(), cache: "no-store" },
    );
    return res.ok ? "supabase" : "local";
  } catch {
    return "local";
  }
}

export async function getMode(): Promise<DataMode> {
  if (!modePromise) modePromise = detectMode();
  return modePromise;
}

// ---------------------------------------------------------------------------
// Local JSON store (cached in memory so updateOpportunity can mutate it)
// ---------------------------------------------------------------------------

const localCache: Record<string, unknown[]> = {};

function loadLocal<T>(name: string): T[] {
  if (localCache[name]) return localCache[name] as T[];
  let items: unknown[] = [];
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, `${name}.json`), "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) items = parsed;
    else if (parsed && Array.isArray(parsed.items)) items = parsed.items;
  } catch {
    items = [];
  }
  localCache[name] = items;
  return items as T[];
}

// ---------------------------------------------------------------------------
// Generic Supabase helpers
// ---------------------------------------------------------------------------

async function sbGet<T>(table: string, query: string): Promise<T[]> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: supabaseHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as T[]) : [];
  } catch {
    return [];
  }
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function byDesc<T>(items: T[], key: (item: T) => string | number): T[] {
  return [...items].sort((a, b) => {
    const av = key(a);
    const bv = key(b);
    if (av < bv) return 1;
    if (av > bv) return -1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Public read API
// ---------------------------------------------------------------------------

export async function getStats(): Promise<Stats> {
  const mode = await getMode();

  const [opportunities, signals, companies, people, scans] = await Promise.all([
    listOpportunities({ limit: 5000 }),
    listSignals({ limit: 5000 }),
    listCompanies({ limit: 5000 }),
    listPeople({ limit: 5000 }),
    listScans({ limit: 1 }),
  ]);

  const qualified = opportunities.filter(
    (o) => num(o.confidence) >= 0.7 && str(o.status) !== "rejected",
  ).length;
  const review = opportunities.filter((o) => str(o.status) === "review").length;
  const approved = opportunities.filter((o) => str(o.status) === "approved").length;

  return {
    opportunities: opportunities.length,
    qualified,
    review,
    approved,
    signals: signals.length,
    companies: companies.length,
    people: people.length,
    lastScan: scans[0]?.started_at ?? null,
    mode,
  };
}

export async function listOpportunities({
  status,
  minConfidence,
  limit,
}: ListOpportunitiesArgs = {}): Promise<Opportunity[]> {
  const mode = await getMode();
  const cap = Math.min(Math.max(limit ?? 50, 0), 5000);

  if (mode === "supabase") {
    const params = [
      "select=*",
      "order=confidence.desc,created_at.desc",
      `limit=${cap}`,
    ];
    if (status) params.push(`status=eq.${encodeURIComponent(status)}`);
    if (minConfidence != null) params.push(`confidence=gte.${minConfidence}`);
    return sbGet<Opportunity>("opportunities", params.join("&"));
  }

  let items = loadLocal<Opportunity>("opportunities");
  if (status) items = items.filter((o) => str(o.status) === status);
  if (minConfidence != null)
    items = items.filter((o) => num(o.confidence) >= minConfidence);
  items = byDesc(items, (o) => num(o.confidence));
  return items.slice(0, cap);
}

export async function getOpportunity(id: string): Promise<Opportunity | null> {
  const mode = await getMode();
  if (mode === "supabase") {
    const rows = await sbGet<Opportunity>(
      "opportunities",
      `select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
    );
    return rows[0] ?? null;
  }
  const items = loadLocal<Opportunity>("opportunities");
  return items.find((o) => String(o.id) === String(id)) ?? null;
}

export async function listSignals({
  type,
  limit,
}: { type?: string | null; limit?: number | null } = {}): Promise<Signal[]> {
  const mode = await getMode();
  const cap = Math.min(Math.max(limit ?? 50, 0), 5000);

  if (mode === "supabase") {
    const params = [
      "select=*",
      "order=occurred_at.desc,ingested_at.desc",
      `limit=${cap}`,
    ];
    if (type) params.push(`type=eq.${encodeURIComponent(type)}`);
    return sbGet<Signal>("signals", params.join("&"));
  }

  let items = loadLocal<Signal>("signals");
  if (type) items = items.filter((s) => str(s.type) === type);
  items = byDesc(items, (s) => str(s.occurred_at) || str(s.ingested_at));
  return items.slice(0, cap);
}

export async function listCompanies({
  limit,
}: { limit?: number | null } = {}): Promise<Company[]> {
  const mode = await getMode();
  const cap = Math.min(Math.max(limit ?? 100, 0), 5000);

  if (mode === "supabase") {
    return sbGet<Company>(
      "companies",
      `select=*&order=score.desc&limit=${cap}`,
    );
  }

  const items = byDesc(loadLocal<Company>("companies"), (c) => num(c.score));
  return items.slice(0, cap);
}

export async function listPeople({
  limit,
}: { limit?: number | null } = {}): Promise<Person[]> {
  const mode = await getMode();
  const cap = Math.min(Math.max(limit ?? 100, 0), 5000);

  if (mode === "supabase") {
    return sbGet<Person>("people", `select=*&order=relevance.desc&limit=${cap}`);
  }

  const items = byDesc(loadLocal<Person>("people"), (p) => num(p.relevance));
  return items.slice(0, cap);
}

export async function listScans({
  limit,
}: { limit?: number | null } = {}): Promise<Scan[]> {
  const mode = await getMode();
  const cap = Math.min(Math.max(limit ?? 50, 0), 5000);

  if (mode === "supabase") {
    return sbGet<Scan>("scans", `select=*&order=started_at.desc&limit=${cap}`);
  }

  const items = byDesc(loadLocal<Scan>("scans"), (s) => str(s.started_at));
  return items.slice(0, cap);
}

// DevOps Jobs
export interface SaveJobsResult {
  mode: DataMode;
  inserted: number;
  skipped: number;
  error?: string;
}

/**
 * Upsert scanned jobs.
 *
 * `unique (source, external_id)` is what makes a re-scan idempotent: a WhatsApp
 * group hands back the same posting every hour, and the second sighting should
 * bump `last_seen_at` rather than add a duplicate row.
 *
 * Local mode has no writable store - the rest of this file treats
 * `data/*.json` as a read-only cache - so it reports the jobs back rather than
 * pretending they were saved.
 */
export async function saveJobs(
  jobs: Array<Partial<DevOpsJob> & { external_id: string }>,
): Promise<SaveJobsResult> {
  const mode = await getMode();
  let inserted = 0;
  let skipped = 0;
  let error: string | undefined;

  if (mode === "supabase") {
    for (const job of jobs) {
      const now = new Date().toISOString();
      const row: Record<string, unknown> = { ...job, last_seen_at: now, ingested_at: now };
      try {
        // The dedupe key is the pair (source, external_id) - that is the
        // unique constraint on devops_jobs, so on_conflict must name both
        // columns or PostgREST rejects the whole batch with "no unique or
        // exclusion constraint matching".
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/devops_jobs?on_conflict=source,external_id`,
          {
            method: "POST",
            headers: {
              ...supabaseHeaders(),
              "Content-Type": "application/json",
              // merge-duplicates turns a repeat sighting into an update
              // instead of a conflict error.
              Prefer: "resolution=merge-duplicates,return=minimal",
            },
            body: JSON.stringify(row),
          },
        );
        if (res.ok) {
          inserted++;
        } else {
          skipped++;
          // Keep the first failure so the tab can say why nothing landed
          // instead of showing a bare "0 saved".
          if (!error) error = `PostgREST ${res.status}: ${(await res.text()).slice(0, 200)}`;
        }
      } catch (err) {
        skipped++;
        if (!error) error = String((err as Error)?.message || err);
      }
    }
    return { mode, inserted, skipped, error };
  }

  // Local mode has no writable store: data/*.json is a read-only cache, and the
  // page and route-handler copies of this module do not even share memory, so
  // anything written here would be invisible to the UI. Report the jobs as
  // previewed-but-not-saved rather than pretending they landed.
  return {
    mode,
    inserted: 0,
    skipped: jobs.length,
    error:
      jobs.length > 0
        ? "מצב מקומי (local) - data/*.json נקרא בלבד, ולכן המשרות שחולצו מוצגות אך לא נשמרו. חברו Supabase ב-.env.local כדי לשמור."
        : undefined,
  };
}

export async function listJobs({
  source,
  company,
  is_devops,
  minScore,
  limit,
}: ListJobsArgs = {}): Promise<DevOpsJob[]> {
  const mode = await getMode();
  const cap = Math.min(Math.max(limit ?? 100, 0), 5000);

  if (mode === "supabase") {
    const params = [
      "select=*",
      "order=score.desc,posted_at.desc,last_seen_at.desc",
      `limit=${cap}`,
    ];
    if (source) params.push(`source=eq.${encodeURIComponent(source)}`);
    if (company) params.push(`company=eq.${encodeURIComponent(company)}`);
    if (is_devops != null) params.push(`is_devops=eq.${is_devops}`);
    if (minScore != null) params.push(`score=gte.${minScore}`);
    return sbGet<DevOpsJob>("devops_jobs", params.join("&"));
  }

  let items = loadLocal<DevOpsJob>("devops_jobs");
  if (source) items = items.filter((j) => str(j.source) === source);
  if (company) items = items.filter((j) => str(j.company) === company);
  if (is_devops != null) items = items.filter((j) => j.is_devops === is_devops);
  if (minScore != null) items = items.filter((j) => num(j.score) >= minScore);
  items = byDesc(items, (j) => num(j.score));
  return items.slice(0, cap);
}

// ---------------------------------------------------------------------------
// Write API
// ---------------------------------------------------------------------------

const ALLOWED_PATCH_KEYS = new Set(["status", "owner_notes", "next_action"]);

export async function updateOpportunity(
  id: string,
  patch: OpportunityPatch,
): Promise<Opportunity | null> {
  const clean: OpportunityPatch = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (ALLOWED_PATCH_KEYS.has(key)) {
      (clean as Record<string, unknown>)[key] = value;
    }
  }
  if (Object.keys(clean).length === 0) {
    return getOpportunity(id);
  }

  const mode = await getMode();

  if (mode === "supabase") {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/opportunities?id=eq.${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: {
            ...supabaseHeaders(),
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify(clean),
        },
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (Array.isArray(data)) return (data[0] as Opportunity) ?? null;
      return null;
    } catch {
      return null;
    }
  }

  // local: mutate the in-memory array only (never writes files)
  const items = loadLocal<Opportunity>("opportunities");
  const idx = items.findIndex((o) => String(o.id) === String(id));
  if (idx === -1) return null;
  const updated: Opportunity = {
    ...items[idx],
    ...clean,
    updated_at: new Date().toISOString(),
  };
  items[idx] = updated;
  return updated;
}