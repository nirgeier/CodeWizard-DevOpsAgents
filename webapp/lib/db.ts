// Server-only data layer for the CodeWizard Jobs Intelligence webapp.
//
// All storage goes through the abstraction in @codewizard/devopsagents-db
// (db/ts submodule). Three backends are supported, chosen either by the
// STORAGE_MODE / DB_MODE env vars or by the persisted `storage_mode`
// setting (Settings page):
//
//   * "supabase" - PostgREST against SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY
//   * "postgres" - local or remote Postgres via DATABASE_URL
//   * "local"    - JSON files under <repo>/data
//
// The UI never shows which one is active.

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import {
  createBackend,
  normalizeMode,
  type DataMode,
  type DbBackend,
  type QuerySpec,
} from "@codewizard/devopsagents-db";
import type { ListingSpec } from "./listing";
import { parseWeights, scoreFit } from "./fit";
import { authClient, authConfigured, currentUserId } from "./auth";
import { listTrackedJobs } from "./tracked-jobs-server";
import type {
  Company,
  DevOpsJob,
  FacetOption,
  ListJobsArgs,
  ListOpportunitiesArgs,
  Opportunity,
  OpportunityPatch,
  Paged,
  PageQuery,
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
const POSTGRES_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  fileEnv.DATABASE_URL ||
  fileEnv.POSTGRES_URL ||
  "";

// ---------------------------------------------------------------------------
// Mode detection (cached)
// ---------------------------------------------------------------------------

let modePromise: Promise<DataMode> | null = null;
let backendPromise: Promise<DbBackend> | null = null;

/** The `storage_mode` setting, read straight from the local file so the
 * choice survives restarts no matter which backend is active. */
function readPersistedMode(): DataMode | null {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, "settings.json"), "utf8");
    const parsed = JSON.parse(raw);
    const items: Array<{ key?: string; value?: unknown }> = Array.isArray(parsed)
      ? parsed
      : parsed?.items ?? [];
    const row = items.find((s) => s.key === "storage_mode");
    const value = row?.value as { mode?: string; storage_mode?: string } | string | undefined;
    const rawMode =
      typeof value === "string" ? value : value?.mode ?? value?.storage_mode ?? null;
    return normalizeMode(rawMode);
  } catch {
    return null;
  }
}

async function probe(mode: DataMode): Promise<boolean> {
  try {
    if (mode === "supabase") {
      if (!SUPABASE_URL || !SUPABASE_KEY) return false;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/opportunities?select=id&limit=1`, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      return res.ok;
    }
    if (mode === "postgres") {
      if (!POSTGRES_URL) return false;
      const backend = createBackend({
        mode,
        dataDir: DATA_DIR,
        postgresUrl: POSTGRES_URL,
      });
      await backend.list("opportunities", { limit: 1 });
      return true;
    }
    return true; // local JSON always works
  } catch {
    return false;
  }
}

async function detectMode(): Promise<DataMode> {
  // 1. Explicit env var wins.
  const envMode = normalizeMode(process.env.DB_MODE || process.env.STORAGE_MODE);
  if (envMode) return envMode;

  // 2. Persisted user choice wins - but only if it is actually reachable,
  //    otherwise we would silently read an empty store.
  const persisted = readPersistedMode();
  if (persisted && (await probe(persisted))) return persisted;

  // 3. Otherwise probe in order: supabase -> postgres -> local.
  if (SUPABASE_URL && SUPABASE_KEY && (await probe("supabase"))) return "supabase";
  if (POSTGRES_URL && (await probe("postgres"))) return "postgres";
  return "local";
}

export async function getMode(): Promise<DataMode> {
  if (!modePromise) modePromise = detectMode();
  return modePromise;
}

async function getBackend(): Promise<DbBackend> {
  if (!backendPromise) {
    backendPromise = getMode().then((mode) =>
      createBackend({
        mode,
        dataDir: DATA_DIR,
        supabaseUrl: SUPABASE_URL,
        supabaseKey: SUPABASE_KEY,
        postgresUrl: POSTGRES_URL,
      }),
    );
  }
  return backendPromise;
}

export function resetModeCache(): void {
  modePromise = null;
  backendPromise = null;
}

const SYNC_TABLES = [
  "companies", "people", "scans", "job_sources", "devops_jobs",
  "signals", "opportunities", "settings",
] as const;
type SyncStore = DataMode;
type SyncRow = Record<string, unknown>;

function syncKey(table: string, row: SyncRow): string {
  const value = table === "settings" ? row.key : row.id;
  if (typeof value !== "string" || !value) throw new Error(`Missing key in ${table}`);
  return value;
}

function syncBackend(mode: SyncStore): DbBackend {
  return createBackend({ mode, dataDir: DATA_DIR, postgresUrl: POSTGRES_URL,
    supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY });
}

async function readSyncRows(mode: SyncStore, table: string, postgres?: pg.Client): Promise<SyncRow[]> {
  if (mode === "local") {
    const file = path.join(DATA_DIR, `${table}.json`);
    if (!fs.existsSync(file)) return [];
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const rows = Array.isArray(parsed) ? parsed : (parsed as { items?: unknown })?.items;
    if (!Array.isArray(rows)) throw new Error(`Invalid local ${table}.json`);
    return rows.filter((row) => table !== "settings" || row.key !== "storage_mode");
  }
  if (mode === "supabase") {
    if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_URL.includes("YOUR-PROJECT") || SUPABASE_URL.includes("your-project")) {
      throw new Error("Supabase is not configured with a real project URL and key");
    }
    const rows: SyncRow[] = [];
    for (let offset = 0; ; offset += 500) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=500&offset=${offset}`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Supabase ${table}: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const batch: unknown = await res.json();
      if (!Array.isArray(batch)) throw new Error(`Invalid Supabase response for ${table}`);
      rows.push(...batch);
      if (batch.length < 500) break;
    }
    return rows.filter((row) => table !== "settings" || row.key !== "storage_mode");
  }
  if (!POSTGRES_URL) throw new Error("Postgres is not configured");
  const client = postgres ?? new pg.Client({ connectionString: POSTGRES_URL });
  if (!postgres) await client.connect();
  try {
    const result = await client.query(`SELECT * FROM "${table}"`);
    return (result.rows as SyncRow[]).filter((row) => table !== "settings" || row.key !== "storage_mode");
  } finally {
    if (!postgres) await client.end();
  }
}

export async function syncStatus(source: SyncStore, target: SyncStore) {
  if (source === target) throw new Error("Choose different storage locations");
  const tables = [];
  for (const table of SYNC_TABLES) {
    const [from, to] = await Promise.all([readSyncRows(source, table), readSyncRows(target, table)]);
    const existing = new Set(to.map((row) => syncKey(table, row)));
    tables.push({ table, source: from.length, target: to.length,
      missing: from.filter((row) => !existing.has(syncKey(table, row))).length });
  }
  return tables;
}

export async function syncMissingData(source: SyncStore, target: SyncStore) {
  if (source === target) throw new Error("Choose different storage locations");
  if (target === "supabase" && (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_URL.includes("YOUR-PROJECT") || SUPABASE_URL.includes("your-project"))) {
    throw new Error("Supabase is not configured with a real project URL and key");
  }
  if ((source === "postgres" || target === "postgres") && !POSTGRES_URL) throw new Error("Postgres is not configured");
  const backend = target === "local" ? syncBackend(target) : undefined;
  const postgres = target === "postgres" ? new pg.Client({ connectionString: POSTGRES_URL }) : null;
  const results = [];
  try {
    if (postgres) await postgres.connect();
    for (const table of SYNC_TABLES) {
      const [from, to] = await Promise.all([readSyncRows(source, table), readSyncRows(target, table, postgres ?? undefined)]);
      const existing = new Set(to.map((row) => syncKey(table, row)));
      const missing = from.filter((row) => !existing.has(syncKey(table, row)));
      for (let index = 0; index < missing.length; index += 100) {
        const batch = missing.slice(index, index + 100);
        if (target === "supabase") {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${table === "settings" ? "key" : "id"}`, {
            method: "POST",
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
              "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" },
            body: JSON.stringify(batch),
          });
          if (!res.ok) throw new Error(`${table}: ${res.status} ${(await res.text()).slice(0, 200)}`);
        } else if (postgres) {
          for (const row of batch) {
            const columns = Object.keys(row);
            if (!columns.every((column) => /^[a-z_][a-z0-9_]*$/.test(column))) throw new Error(`Invalid column in ${table}`);
            await postgres.query(
              `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(",")}) VALUES (${columns.map((_, position) => `$${position + 1}`).join(",")}) ON CONFLICT DO NOTHING`,
              columns.map((column) => row[column]),
            );
          }
        } else {
          const result = await backend!.upsert(table, batch, table === "settings" ? "key" : "id");
          if (result.error || result.saved !== batch.length) {
            throw new Error(`${table}: ${result.error ?? `saved ${result.saved} of ${batch.length}`}`);
          }
        }
      }
      const after = new Set((await readSyncRows(target, table, postgres ?? undefined)).map((row) => syncKey(table, row)));
      const copied = missing.filter((row) => after.has(syncKey(table, row))).length;
      if (copied !== missing.length) throw new Error(`${table}: only ${copied} of ${missing.length} missing rows were found after sync`);
      results.push({ table, copied });
    }
  } finally {
    if (postgres) await postgres.end();
  }
  return results;
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
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
  const cap = Math.min(Math.max(limit ?? 50, 0), 5000);
  const backend = await getBackend();
  return backend.list<Opportunity>("opportunities", {
    filters: status ? { status } : undefined,
    ranges: minConfidence != null ? { confidence: { gte: minConfidence } } : undefined,
    order: "confidence.desc,created_at.desc",
    limit: cap,
  });
}

export async function getOpportunity(id: string): Promise<Opportunity | null> {
  const backend = await getBackend();
  return backend.get<Opportunity>("opportunities", { id });
}

export async function listSignals({
  type,
  limit,
}: { type?: string | null; limit?: number | null } = {}): Promise<Signal[]> {
  const cap = Math.min(Math.max(limit ?? 50, 0), 5000);
  const backend = await getBackend();
  return backend.list<Signal>("signals", {
    filters: type ? { type } : undefined,
    order: "occurred_at.desc,ingested_at.desc",
    limit: cap,
  });
}

export async function listCompanies({
  limit,
}: { limit?: number | null } = {}): Promise<Company[]> {
  const cap = Math.min(Math.max(limit ?? 100, 0), 5000);
  const backend = await getBackend();
  return backend.list<Company>("companies", { order: "score.desc", limit: cap });
}

export async function createCompany(value: Pick<Company, "name" | "domain" | "industry" | "country" | "hq_city">): Promise<Company> {
  const backend = await getBackend();
  const name = value.name.trim();
  const domain = value.domain?.trim().toLowerCase() || "";
  const existing = await backend.list<Company>("companies", {
    search: { columns: ["name"], term: name }, limit: 5000,
  });
  if (existing.some((company) => company.name.trim().toLowerCase() === name.toLowerCase() &&
      (company.domain || "").trim().toLowerCase() === domain)) {
    throw new Error("החברה כבר קיימת ברשימה.");
  }
  const row: Company = {
    id: crypto.randomUUID(), name, domain,
    industry: value.industry?.trim() || "", country: value.country?.trim() || "",
    hq_city: value.hq_city?.trim() || "",
  };
  const result = await backend.upsert("companies", [row]);
  if (result.saved !== 1) throw new Error(result.error || "שמירת החברה נכשלה.");
  return row;
}

export async function listPeople({
  limit,
}: { limit?: number | null } = {}): Promise<Person[]> {
  const cap = Math.min(Math.max(limit ?? 100, 0), 5000);
  const backend = await getBackend();
  return backend.list<Person>("people", { order: "relevance.desc", limit: cap });
}

export async function listScans({
  limit,
}: { limit?: number | null } = {}): Promise<Scan[]> {
  const cap = Math.min(Math.max(limit ?? 50, 0), 5000);
  const backend = await getBackend();
  return backend.list<Scan>("scans", { order: "started_at.desc", limit: cap });
}

export interface AgentScanStatus {
  status: "idle" | "running" | "completed" | "failed";
  startedAt?: string;
  finishedAt?: string;
  result?: Record<string, unknown>;
  error?: string;
}

function agentScanStatus(scan: Scan): AgentScanStatus {
  const filters = scan.filters as { result?: Record<string, unknown> } | null;
  // A scan still "running" long after the runner's timeout was orphaned by a server restart.
  const stale = scan.status === "running" && scan.started_at &&
    Date.now() - Date.parse(scan.started_at) > 25 * 60 * 1000;
  return {
    status: stale ? "failed" : scan.status as AgentScanStatus["status"],
    startedAt: scan.started_at ?? undefined,
    finishedAt: scan.finished_at ?? undefined,
    result: filters?.result,
    error: stale ? "Scan was interrupted" : scan.error ?? undefined,
  };
}

export async function latestAgentScan(sourceId: string): Promise<AgentScanStatus> {
  const backend = await getBackend();
  const scans = await backend.list<Scan>("scans", {
    filters: { mode: `agent:${sourceId}` }, order: "started_at.desc", limit: 1,
  });
  return scans[0] ? agentScanStatus(scans[0]) : { status: "idle" };
}

export async function agentScanStatuses(): Promise<Record<string, AgentScanStatus>> {
  const backend = await getBackend();
  const scans = await backend.list<Scan>("scans", {
    search: { columns: ["mode"], term: "agent:" }, order: "started_at.desc", limit: 5000,
  });
  const statuses: Record<string, AgentScanStatus> = {};
  for (const scan of scans) {
    if (scan.mode?.startsWith("agent:")) {
      const sourceId = scan.mode.slice(6);
      if (!Object.hasOwn(statuses, sourceId)) statuses[sourceId] = agentScanStatus(scan);
    }
  }
  return statuses;
}

export async function startAgentScan(sourceId: string, options: Record<string, unknown>) {
  const backend = await getBackend();
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const result = await backend.upsert("scans", [{
    id, mode: `agent:${sourceId}`, status: "running", started_at: startedAt,
    filters: { options },
  }]);
  if (result.error || result.saved !== 1) throw new Error(result.error || "Failed to save scan");
  return { id, startedAt };
}

export async function finishAgentScan(id: string, status: AgentScanStatus) {
  const backend = await getBackend();
  const scan = await backend.get<Scan>("scans", { id });
  if (!scan) throw new Error("Scan not found");
  const result = await backend.update("scans", {
    status: status.status,
    finished_at: status.finishedAt,
    duration_ms: scan.started_at && status.finishedAt
      ? Math.max(0, Date.parse(status.finishedAt) - Date.parse(scan.started_at)) : null,
    filters: { ...(scan.filters as object), result: status.result },
    error: status.error ?? null,
  }, { id });
  if (result.updated !== 1) throw new Error("Failed to update scan");
}

// DevOps Jobs
export interface SaveJobsResult {
  mode: DataMode;
  inserted: number;
  skipped: number;
  error?: string;
}

export async function saveJobs(
  jobs: Array<Partial<DevOpsJob> & { external_id: string }>,
): Promise<SaveJobsResult> {
  const mode = await getMode();
  const backend = await getBackend();
  let inserted = 0;
  let skipped = 0;
  let error: string | undefined;
  const normalizedName = (value: string) => value.trim().toLocaleLowerCase().replace(/(?: israel| ישראל)$/, "");
  const companies = await listCompanies({ limit: 5000 });
  const knownCompanies = new Set(companies.map((company) => normalizedName(company.name)));
  const knownDomains = new Set(companies.map((company) => company.domain?.trim().toLowerCase()).filter(Boolean));

  for (const job of jobs) {
    const now = new Date().toISOString();
    const row = { ...job, last_seen_at: now, ingested_at: now };
    const result = await backend.upsert("devops_jobs", [row], "source,external_id");
    if (result.saved > 0) {
      inserted++;
      const name = job.company?.trim();
      if (job.country === "IL" && name && name.length <= 120 &&
          !/^(?:unknown|confidential|undisclosed|חסוי|לא ידוע)$/i.test(name) &&
          !knownCompanies.has(normalizedName(name)) &&
          (!job.company_domain || !knownDomains.has(job.company_domain.trim().toLowerCase()))) {
        try {
          await createCompany({ name, domain: job.company_domain, industry: "", country: "IL", hq_city: job.city });
          knownCompanies.add(normalizedName(name));
          if (job.company_domain) knownDomains.add(job.company_domain.trim().toLowerCase());
        } catch (failure) {
          if (!error) error = failure instanceof Error ? failure.message : "Company registration failed";
        }
      }
    } else {
      skipped++;
      if (!error) error = result.error;
    }
  }
  return { mode, inserted, skipped, error };
}

export async function listJobs({
  source,
  company,
  is_devops,
  minScore,
  limit,
}: ListJobsArgs = {}): Promise<DevOpsJob[]> {
  const cap = Math.min(Math.max(limit ?? 100, 0), 5000);
  const backend = await getBackend();
  const filters: Record<string, string | number | boolean> = {};
  if (source) filters.source = source;
  if (company) filters.company = company;
  if (is_devops != null) filters.is_devops = is_devops;
  return backend.list<DevOpsJob>("devops_jobs", {
    filters: Object.keys(filters).length ? filters : undefined,
    ranges: minScore != null ? { score: { gte: minScore } } : undefined,
    order: "score.desc,posted_at.desc,last_seen_at.desc",
    limit: cap,
  });
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

  const backend = await getBackend();
  const result = await backend.update<Opportunity>("opportunities", clean, { id });
  if (result.row) return result.row;
  if (result.updated > 0) return getOpportunity(id);
  return null;
}

// ====================================================================
// Paged list API
// ====================================================================
// The `list*` functions above return a capped array and leave filtering to the
// caller. That is fine for a dashboard widget but wrong for a list view: the
// page needs the *total* matching count to render "26-50 of 312", and it must
// not pull 5000 rows over the wire to show 25 of them.

/**
 * Per-entity description of what is searchable and sortable.
 *
 * Keys of `sorters` double as the `sort=` value in the URL *and* the Postgres
 * column name, so the backends stay in step without a translation table.
 */
type EntitySpec<T> = ListingSpec<T>;

function toPaged<T>(
  query: PageQuery,
  page: { items: T[]; total: number },
): Paged<T> {
  const pageSize = Math.min(Math.max(Number(query.pageSize) || 25, 1), 200);
  const totalPages = Math.max(1, Math.ceil(page.total / pageSize));
  const current = Math.min(Math.max(Number(query.page) || 1, 1), totalPages);
  return { items: page.items, total: page.total, page: current, pageSize, totalPages };
}

async function pageQuery<T>(
  table: string,
  spec: EntitySpec<T>,
  query: PageQuery,
  opts: {
    filters?: Record<string, string | number | boolean>;
    ranges?: QuerySpec["ranges"];
    /** Post-filter for things Postgres can't express safely here. */
    refine?: (rows: T[]) => T[];
    fallbackSort: string;
  },
): Promise<Paged<T>> {
  const backend = await getBackend();
  const pageSize = Math.min(Math.max(Number(query.pageSize) || 25, 1), 200);
  const page = Math.max(Number(query.page) || 1, 1);

  const key = query.sort && spec.sorters[query.sort] ? query.sort : opts.fallbackSort;
  const dir = query.dir === "asc" ? "asc" : "desc";

  const result = await backend.page<T>(table, {
    filters: opts.filters,
    ranges: opts.ranges,
    search: query.q ? { columns: spec.search as string[], term: query.q } : null,
    order: `${key}.${dir}.nullslast`,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  const items = opts.refine ? opts.refine(result.items) : result.items;
  return toPaged(query, { items, total: result.total });
}

// --- Opportunities ---------------------------------------------------------

const OPPORTUNITY_SPEC: EntitySpec<Opportunity> = {
  search: ["company_name", "domain", "target_person_name", "target_title", "persona", "location", "why_now"],
  sorters: {
    confidence: (o) => num(o.confidence),
    company_name: (o) => str(o.company_name),
    status: (o) => str(o.status),
    location: (o) => str(o.location),
    created_at: (o) => str(o.created_at),
  },
  tiebreak: (o) => str(o.created_at),
};

export async function pageOpportunities(query: PageQuery): Promise<Paged<Opportunity>> {
  const status = query.filters?.status ?? "";
  const minConfidence = query.filters?.minConfidence ? Number(query.filters.minConfidence) : null;

  return pageQuery("opportunities", OPPORTUNITY_SPEC, query, {
    filters: status ? { status } : undefined,
    ranges: minConfidence != null && Number.isFinite(minConfidence)
      ? { confidence: { gte: minConfidence } }
      : undefined,
    fallbackSort: "confidence",
  });
}

// --- Signals ---------------------------------------------------------------

const SIGNAL_SPEC: EntitySpec<Signal> = {
  search: ["company_name", "headline", "summary", "source", "location", "person_name", "domain"],
  sorters: {
    occurred_at: (s) => str(s.occurred_at) || str(s.ingested_at),
    company_name: (s) => str(s.company_name),
    type: (s) => str(s.type),
    source: (s) => str(s.source),
    relevance: (s) => num(s.relevance),
  },
};

export async function pageSignals(query: PageQuery): Promise<Paged<Signal>> {
  const type = query.filters?.type ?? "";
  const source = query.filters?.source ?? "";

  const filters: Record<string, string> = {};
  if (type) filters.type = type;
  if (source) filters.source = source;

  return pageQuery("signals", SIGNAL_SPEC, query, {
    filters: Object.keys(filters).length ? filters : undefined,
    fallbackSort: "occurred_at",
  });
}

// --- Companies -------------------------------------------------------------

const COMPANY_SPEC: EntitySpec<Company> = {
  search: ["name", "domain", "industry", "hq_city", "country", "service"],
  sorters: {
    score: (c) => num(c.score),
    name: (c) => str(c.name),
    devops_hiring_count: (c) => num(c.devops_hiring_count),
    last_seen_at: (c) => str(c.last_seen_at),
  },
};

export async function pageCompanies(query: PageQuery): Promise<Paged<Company>> {
  const hiring = query.filters?.hiring ?? "";

  return pageQuery("companies", COMPANY_SPEC, query, {
    filters:
      hiring === "yes" ? { devops_hiring: true } : hiring === "no" ? { devops_hiring: false } : undefined,
    fallbackSort: "score",
  });
}

// --- People ----------------------------------------------------------------

const PERSON_SPEC: EntitySpec<Person> = {
  search: ["full_name", "title", "company_name", "domain", "location", "email", "persona"],
  sorters: {
    relevance: (p) => num(p.relevance),
    full_name: (p) => str(p.full_name),
    company_name: (p) => str(p.company_name),
    title: (p) => str(p.title),
    seniority: (p) => str(p.seniority),
  },
};

export async function pagePeople(query: PageQuery): Promise<Paged<Person>> {
  const seniority = query.filters?.seniority ?? "";
  const persona = query.filters?.persona ?? "";
  const hasContact = query.filters?.contact ?? "";

  const reachable = (p: Person) => Boolean(p.email || p.phone || p.linkedin_url);

  const filters: Record<string, string> = {};
  if (seniority) filters.seniority = seniority;
  if (persona) filters.persona = persona;

  return pageQuery("people", PERSON_SPEC, query, {
    filters: Object.keys(filters).length ? filters : undefined,
    refine: hasContact
      ? (rows) => rows.filter((p) => (hasContact === "yes" ? reachable(p) : !reachable(p)))
      : undefined,
    fallbackSort: "relevance",
  });
}

// --- Scans -----------------------------------------------------------------

const SCAN_SPEC: EntitySpec<Scan> = {
  search: ["mode", "status", "query", "error"],
  sorters: {
    started_at: (s) => str(s.started_at),
    status: (s) => str(s.status),
    opportunities_found: (s) => num(s.opportunities_found),
    duration_ms: (s) => num(s.duration_ms),
  },
};

export async function pageScans(query: PageQuery): Promise<Paged<Scan>> {
  const status = query.filters?.status ?? "";

  return pageQuery("scans", SCAN_SPEC, query, {
    filters: status ? { status } : undefined,
    fallbackSort: "started_at",
  });
}

// --- DevOps jobs -----------------------------------------------------------

const JOB_SPEC: EntitySpec<DevOpsJob> = {
  search: ["title", "company", "location", "seniority", "department", "source"],
  sorters: {
    score: (j) => num(j.score),
    title: (j) => str(j.title),
    company: (j) => str(j.company),
    posted_at: (j) => str(j.posted_at) || str(j.last_seen_at),
    seniority: (j) => str(j.seniority),
  },
};

export async function pageJobs(query: PageQuery): Promise<Paged<DevOpsJob>> {
  const source = query.filters?.source ?? "";
  const seniority = query.filters?.seniority ?? "";
  const workMode = query.filters?.workMode ?? "";
  const minScore = query.filters?.minScore ? Number(query.filters.minScore) : null;
  const firstSeenSince = query.filters?.firstSeenSince || null;

  const filters: Record<string, string> = {};
  if (source) filters.source = source;
  if (seniority) filters.seniority = seniority;
  if (workMode) filters.work_mode = workMode;

  const weights = parseWeights((await getPreferences())?.keyword_weights);
  const userId = await currentUserId();
  const dismissed = new Set(userId ? (await listTrackedJobs(userId, userId === "00000000-0000-0000-0000-000000000001"))
    .filter((job) => job.stage === "dismissed").map((job) => job.id) : []);
  if (weights.length || dismissed.size) {
    const backend = await getBackend();
    const jobs: DevOpsJob[] = [];
    for (let offset = 0; ; offset += 500) {
      const batch = await backend.page<DevOpsJob>("devops_jobs", {
        filters: Object.keys(filters).length ? filters : undefined,
        ranges: firstSeenSince ? { first_seen_at: { gte: firstSeenSince } } : undefined,
        search: query.q ? { columns: JOB_SPEC.search as string[], term: query.q } : null,
        order: "posted_at.desc",
        offset,
        limit: 500,
      });
      jobs.push(...batch.items);
      if (offset + batch.items.length >= batch.total || !batch.items.length) break;
    }
    const ranked = jobs.filter((job) => !dismissed.has(job.id)).map((job) => {
      if (!weights.length) return job;
      const fit = scoreFit(job, weights);
      return { ...job, score: fit.score / 100, fit_matches: fit.matches };
    }).filter((job) => minScore == null || Number(job.score) >= minScore);
    const key = query.sort && JOB_SPEC.sorters[query.sort] ? query.sort : "score";
    const direction = query.dir === "asc" ? 1 : -1;
    ranked.sort((left, right) => {
      const first = JOB_SPEC.sorters[key](left);
      const second = JOB_SPEC.sorters[key](right);
      return (typeof first === "number" && typeof second === "number"
        ? first - second
        : String(first).localeCompare(String(second))) * direction;
    });
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 25, 1), 200);
    const page = Math.max(Number(query.page) || 1, 1);
    return toPaged(query, { items: ranked.slice((page - 1) * pageSize, page * pageSize), total: ranked.length });
  }

  return pageQuery("devops_jobs", JOB_SPEC, query, {
    filters: Object.keys(filters).length ? filters : undefined,
    ranges: {
      ...(minScore != null && Number.isFinite(minScore) ? { score: { gte: minScore } } : {}),
      ...(firstSeenSince ? { first_seen_at: { gte: firstSeenSince } } : {}),
    },
    fallbackSort: "score",
  });
}

// --- Facets ----------------------------------------------------------------

/**
 * Distinct values of a column, newest-data-first, for a filter dropdown.
 */
export async function facet(
  entity: "opportunities" | "signals" | "companies" | "people" | "scans" | "devops_jobs",
  column: string,
): Promise<FacetOption[]> {
  const backend = await getBackend();
  const rows = await backend.list<Record<string, unknown>>(entity, { limit: 5000 });

  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = str(row?.[column]).trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "he"));
}

// ====================================================================
// Settings (the key/value config behind /settings: ICP, keywords,
// storage_mode)
// ====================================================================
// Unlike the scanner-owned rows above, a setting has to survive a restart -
// "local" mode is itself a setting - so the local mirror at
// data/settings.json is always updated on write, whichever backend is active.

export interface Setting {
  key: string;
  value: unknown;
  description: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface UserPreferences {
  user_id: string;
  full_name: string;
  linkedin_url: string;
  github_url: string;
  cv_url: string;
  keyword_weights: { term: string; weight: number }[];
  alerts_enabled: boolean;
  alert_min_score: number;
  updated_at?: string;
}

export async function getPreferences(): Promise<UserPreferences | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  if (authConfigured() && (await getMode()) === "supabase") {
    const client = await authClient();
    const { data, error } = await client.from("user_preferences").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return data as UserPreferences | null;
  }
  return (await getBackend()).get<UserPreferences>("user_preferences", { user_id: userId });
}

export async function savePreferences(value: Omit<UserPreferences, "user_id" | "updated_at">): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Unauthorized");
  const row = { ...value, user_id: userId, updated_at: new Date().toISOString() };
  if (authConfigured() && (await getMode()) === "supabase") {
    const client = await authClient();
    const { error } = await client.from("user_preferences").upsert(row, { onConflict: "user_id" });
    if (error) throw error;
    return;
  }
  const result = await (await getBackend()).upsert("user_preferences", [row], "user_id");
  if (!result.saved) throw new Error(result.error || "Failed to save preferences");
}

function readLocalSettingsFile(): Setting[] {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, "settings.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as Setting[];
    if (Array.isArray(parsed?.items)) return parsed.items as Setting[];
    return [];
  } catch {
    return [];
  }
}

function writeLocalSettingsFile(items: Setting[]): void {
  try {
    fs.writeFileSync(
      path.join(DATA_DIR, "settings.json"),
      `${JSON.stringify(items, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // best effort
  }
}

/** Mirror one setting into data/settings.json so the choice survives restarts. */
function mirrorSettingLocally(setting: Setting): void {
  const items = readLocalSettingsFile();
  const idx = items.findIndex((s) => s.key === setting.key);
  if (idx >= 0) items[idx] = setting;
  else items.push(setting);
  writeLocalSettingsFile(items);
}

export async function listSettings(): Promise<Setting[]> {
  const backend = await getBackend();
  const rows = await backend.list<Setting>("settings", { order: "key.asc", limit: 5000 });
  return rows;
}

export async function getSetting(key: string): Promise<Setting | null> {
  const cleanKey = String(key ?? "").trim();
  if (!cleanKey) return null;

  const backend = await getBackend();
  const row = await backend.get<Setting>("settings", { key: cleanKey });
  return row ?? readLocalSettingsFile().find((s) => s.key === cleanKey) ?? null;
}

export async function updateSetting(
  key: string,
  value: unknown,
  description?: string | null,
): Promise<Setting | null> {
  const cleanKey = String(key ?? "").trim();
  if (!cleanKey) return null;

  const now = new Date().toISOString();
  const existing = await getSetting(cleanKey);
  const row: Setting = {
    ...(existing ?? { created_at: now }),
    key: cleanKey,
    value,
    description: description ?? existing?.description ?? null,
    updated_at: now,
  };

  // Always mirror locally so `storage_mode` is honoured on the next boot.
  mirrorSettingLocally(row);

  const backend = await getBackend();
  const result = await backend.upsert<Setting>("settings", [row], "key");
  if (result.saved > 0) {
    return row;
  }
  return row;
}
