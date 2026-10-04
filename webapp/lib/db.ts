// Server-only data layer for the CodeWizard Jobs Intelligence webapp.
// Two backends:
//   * "supabase" - REST calls against SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY
//   * "local"    - JSON files under <repo>/data
// The app auto-detects which one to use at runtime, but the UI never shows it.

import fs from "node:fs";
import path from "node:path";
import { applyListing, type ListingSpec } from "./listing";
import type {
  Company,
  DataMode,
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

// ====================================================================// Paged list API
// ====================================================================//
// The `list*` functions above return a capped array and leave filtering to the
// caller. That is fine for a dashboard widget but wrong for a list view: the
// page needs the *total* matching count to render "26-50 of 312", and it must
// not pull 5000 rows over the wire to show 25 of them.
//
// Everything below answers a PageQuery with a Paged<T>. Both backends are held
// to the same contract - Supabase does the work in Postgres, local mode does it
// in memory over the JSON cache - so a page never knows which one it is on.

/**
 * Per-entity description of what is searchable and sortable.
 *
 * Keys of `sorters` double as the `sort=` value in the URL *and* the Postgres
 * column name, so the two backends stay in step without a translation table.
 * Local mode feeds these straight into `applyListing`; Supabase mode turns the
 * same key into an `order=` clause.
 */
type EntitySpec<T> = ListingSpec<T>;

/** Local mode: the shared in-memory pipeline, over the JSON cache. */
const pageLocal = applyListing;

/**
 * One page from PostgREST, with an exact count.
 *
 * `Prefer: count=exact` plus a `Range` header makes Postgres do the counting
 * and the slicing; the total comes back in `Content-Range` as `0-24/312`.
 * A ranged request answers 206, which `res.ok` already accepts.
 */
async function sbPage<T>(
  table: string,
  opts: {
    filters?: string[];
    or?: string | null;
    order: string;
    page: number;
    pageSize: number;
  },
): Promise<Paged<T>> {
  const pageSize = Math.min(Math.max(opts.pageSize, 1), 200);
  const page = Math.max(opts.page, 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const params = ["select=*", `order=${opts.order}`, ...(opts.filters ?? [])];
  if (opts.or) params.push(`or=(${opts.or})`);

  const empty: Paged<T> = { items: [], total: 0, page: 1, pageSize, totalPages: 1 };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params.join("&")}`, {
      headers: {
        ...supabaseHeaders(),
        Range: `${from}-${to}`,
        "Range-Unit": "items",
        Prefer: "count=exact",
      },
      cache: "no-store",
    });
    if (!res.ok) return empty;

    const data = await res.json();
    const items = Array.isArray(data) ? (data as T[]) : [];
    const range = res.headers.get("content-range") ?? "";
    const total = Number(range.split("/")[1]);
    const resolved = Number.isFinite(total) ? total : items.length;
    const totalPages = Math.max(1, Math.ceil(resolved / pageSize));
    return { items, total: resolved, page: Math.min(page, totalPages), pageSize, totalPages };
  } catch {
    return empty;
  }
}

/** `col.ilike.*term*` for every searchable column, joined for PostgREST `or=()`. */
function sbSearch(q: string | null | undefined, columns: string[]): string | null {
  const term = (q ?? "").trim();
  if (!term) return null;
  // Commas and parens would break out of the or=() grouping.
  const safe = term.replace(/[(),*]/g, " ").trim();
  if (!safe) return null;
  return columns.map((c) => `${c}.ilike.*${safe}*`).join(",");
}

function sbOrder(spec: EntitySpec<unknown>, query: PageQuery, fallback: string): string {
  const key = query.sort && spec.sorters[query.sort] ? query.sort : fallback;
  const dir = query.dir === "asc" ? "asc" : "desc";
  return `${key}.${dir}.nullslast`;
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
  const mode = await getMode();
  const status = query.filters?.status ?? "";
  const minConfidence = query.filters?.minConfidence ? Number(query.filters.minConfidence) : null;

  if (mode === "supabase") {
    const filters: string[] = [];
    if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);
    if (minConfidence != null && Number.isFinite(minConfidence)) {
      filters.push(`confidence=gte.${minConfidence}`);
    }
    return sbPage<Opportunity>("opportunities", {
      filters,
      or: sbSearch(query.q, OPPORTUNITY_SPEC.search),
      order: sbOrder(OPPORTUNITY_SPEC as EntitySpec<unknown>, query, "confidence"),
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 25,
    });
  }

  return pageLocal(
    loadLocal<Opportunity>("opportunities"),
    OPPORTUNITY_SPEC,
    query,
    (o) =>
      (!status || str(o.status) === status) &&
      (minConfidence == null || !Number.isFinite(minConfidence) || num(o.confidence) >= minConfidence),
  );
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
  const mode = await getMode();
  const type = query.filters?.type ?? "";
  const source = query.filters?.source ?? "";

  if (mode === "supabase") {
    const filters: string[] = [];
    if (type) filters.push(`type=eq.${encodeURIComponent(type)}`);
    if (source) filters.push(`source=eq.${encodeURIComponent(source)}`);
    return sbPage<Signal>("signals", {
      filters,
      or: sbSearch(query.q, SIGNAL_SPEC.search),
      order: sbOrder(SIGNAL_SPEC as EntitySpec<unknown>, query, "occurred_at"),
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 25,
    });
  }

  return pageLocal(
    loadLocal<Signal>("signals"),
    SIGNAL_SPEC,
    query,
    (s) => (!type || str(s.type) === type) && (!source || str(s.source) === source),
  );
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
  const mode = await getMode();
  const hiring = query.filters?.hiring ?? "";

  if (mode === "supabase") {
    const filters: string[] = [];
    if (hiring === "yes") filters.push("devops_hiring=eq.true");
    if (hiring === "no") filters.push("devops_hiring=eq.false");
    return sbPage<Company>("companies", {
      filters,
      or: sbSearch(query.q, COMPANY_SPEC.search),
      order: sbOrder(COMPANY_SPEC as EntitySpec<unknown>, query, "score"),
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 25,
    });
  }

  return pageLocal(
    loadLocal<Company>("companies"),
    COMPANY_SPEC,
    query,
    (c) =>
      !hiring ||
      (hiring === "yes" ? Boolean(c.devops_hiring) : !c.devops_hiring),
  );
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
  const mode = await getMode();
  const seniority = query.filters?.seniority ?? "";
  const persona = query.filters?.persona ?? "";
  const hasContact = query.filters?.contact ?? "";

  const reachable = (p: Person) => Boolean(p.email || p.phone || p.linkedin_url);

  if (mode === "supabase") {
    const filters: string[] = [];
    if (seniority) filters.push(`seniority=eq.${encodeURIComponent(seniority)}`);
    if (persona) filters.push(`persona=eq.${encodeURIComponent(persona)}`);
    const paged = await sbPage<Person>("people", {
      filters,
      or: sbSearch(query.q, PERSON_SPEC.search),
      order: sbOrder(PERSON_SPEC as EntitySpec<unknown>, query, "relevance"),
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 25,
    });
    // "has contact details" spans three nullable columns; expressing it in
    // PostgREST alongside the search `or=()` would need a second or-group,
    // which PostgREST will not nest. Filtering the page is a deliberate
    // trade-off: the toggle narrows what you see without a second round trip.
    if (!hasContact) return paged;
    const items = paged.items.filter((p) => (hasContact === "yes" ? reachable(p) : !reachable(p)));
    return { ...paged, items };
  }

  return pageLocal(
    loadLocal<Person>("people"),
    PERSON_SPEC,
    query,
    (p) =>
      (!seniority || str(p.seniority) === seniority) &&
      (!persona || str(p.persona) === persona) &&
      (!hasContact || (hasContact === "yes" ? reachable(p) : !reachable(p))),
  );
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
  const mode = await getMode();
  const status = query.filters?.status ?? "";

  if (mode === "supabase") {
    const filters: string[] = [];
    if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);
    return sbPage<Scan>("scans", {
      filters,
      or: sbSearch(query.q, SCAN_SPEC.search),
      order: sbOrder(SCAN_SPEC as EntitySpec<unknown>, query, "started_at"),
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 25,
    });
  }

  return pageLocal(
    loadLocal<Scan>("scans"),
    SCAN_SPEC,
    query,
    (s) => !status || str(s.status) === status,
  );
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
  const mode = await getMode();
  const source = query.filters?.source ?? "";
  const seniority = query.filters?.seniority ?? "";
  const minScore = query.filters?.minScore ? Number(query.filters.minScore) : null;

  if (mode === "supabase") {
    const filters: string[] = [];
    if (source) filters.push(`source=eq.${encodeURIComponent(source)}`);
    if (seniority) filters.push(`seniority=eq.${encodeURIComponent(seniority)}`);
    if (minScore != null && Number.isFinite(minScore)) filters.push(`score=gte.${minScore}`);
    return sbPage<DevOpsJob>("devops_jobs", {
      filters,
      or: sbSearch(query.q, JOB_SPEC.search),
      order: sbOrder(JOB_SPEC as EntitySpec<unknown>, query, "score"),
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 25,
    });
  }

  return pageLocal(
    loadLocal<DevOpsJob>("devops_jobs"),
    JOB_SPEC,
    query,
    (j) =>
      (!source || str(j.source) === source) &&
      (!seniority || str(j.seniority) === seniority) &&
      (minScore == null || !Number.isFinite(minScore) || num(j.score) >= minScore),
  );
}

// --- Facets ----------------------------------------------------------------

/**
 * Distinct values of a column, newest-data-first, for a filter dropdown.
 *
 * Deliberately reads the unfiltered set: a dropdown that only lists values
 * surviving the current filter can strand the user on an empty result with no
 * way back to a wider view.
 */
export async function facet(
  entity: "opportunities" | "signals" | "companies" | "people" | "scans" | "devops_jobs",
  column: string,
): Promise<FacetOption[]> {
  const mode = await getMode();

  let rows: Record<string, unknown>[] = [];
  if (mode === "supabase") {
    rows = await sbGet<Record<string, unknown>>(
      entity,
      `select=${encodeURIComponent(column)}&limit=5000`,
    );
  } else {
    rows = loadLocal<Record<string, unknown>>(entity);
  }

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
//
// Unlike the scanner-owned rows above, a setting has to survive a restart -
// "local" mode is itself a setting - so the local backend writes
// data/settings.json back to disk after an update.

export interface Setting {
  key: string;
  value: unknown;
  description: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

const SETTING_COLUMNS = "key,value,description,created_at,updated_at";

/** Drop the cached backend so a `storage_mode` change takes effect. */
export function resetModeCache(): void {
  modePromise = null;
}

function saveLocalSettings(items: Setting[]): void {
  localCache.settings = items;
  try {
    fs.writeFileSync(
      path.join(DATA_DIR, "settings.json"),
      `${JSON.stringify(items, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // best effort - the in-memory copy still serves this process
  }
}

export async function listSettings(): Promise<Setting[]> {
  const mode = await getMode();

  if (mode === "supabase") {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/settings?select=${SETTING_COLUMNS}&order=key.asc`,
        { headers: supabaseHeaders(), cache: "no-store" },
      );
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? (data as Setting[]) : [];
    } catch {
      return [];
    }
  }

  return [...loadLocal<Setting>("settings")].sort((a, b) =>
    a.key.localeCompare(b.key, "he"),
  );
}

export async function getSetting(key: string): Promise<Setting | null> {
  const cleanKey = String(key ?? "").trim();
  if (!cleanKey) return null;

  const mode = await getMode();

  if (mode === "supabase") {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/settings?key=eq.${encodeURIComponent(cleanKey)}&select=${SETTING_COLUMNS}&limit=1`,
        { headers: supabaseHeaders(), cache: "no-store" },
      );
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data) && data.length > 0 ? (data[0] as Setting) : null;
    } catch {
      return null;
    }
  }

  return loadLocal<Setting>("settings").find((s) => s.key === cleanKey) ?? null;
}

export async function updateSetting(
  key: string,
  value: unknown,
  description?: string | null,
): Promise<Setting | null> {
  const cleanKey = String(key ?? "").trim();
  if (!cleanKey) return null;

  const mode = await getMode();
  const now = new Date().toISOString();

  if (mode === "supabase") {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?on_conflict=key`, {
        method: "POST",
        headers: {
          ...supabaseHeaders(),
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify([
          { key: cleanKey, value, description: description ?? null, updated_at: now },
        ]),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data) && data.length > 0
        ? (data[0] as Setting)
        : { key: cleanKey, value, description: description ?? null, updated_at: now };
    } catch {
      return null;
    }
  }

  const items = loadLocal<Setting>("settings");
  const idx = items.findIndex((s) => s.key === cleanKey);
  const row: Setting = {
    ...(idx >= 0 ? items[idx] : { created_at: now }),
    key: cleanKey,
    value,
    description: description ?? items[idx]?.description ?? null,
    updated_at: now,
  };
  if (idx >= 0) items[idx] = row;
  else items.push(row);
  saveLocalSettings(items);
  return row;
}
