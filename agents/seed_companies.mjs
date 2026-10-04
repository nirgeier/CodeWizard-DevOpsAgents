#!/usr/bin/env node
/**
 * agents/seed_companies.mjs - import the Israeli DevOps employer directory
 * into the `companies` table / data/companies.json.
 *
 * Source of truth: config/israel-companies.json - 739 Israeli employers that
 * hire DevOps / SRE / platform engineers, built by
 * scripts/build_company_directory.py. Each row already carries a stable uuid,
 * a sector, an optional ATS descriptor and the DevOps/open role counts.
 *
 *   node agents/seed_companies.mjs                # auto-detect the target
 *   node agents/seed_companies.mjs --dry-run      # report, write nothing
 *   node agents/seed_companies.mjs --target=local
 *   node agents/seed_companies.mjs --target=supabase
 *
 * Idempotency notes (both matter, both are deliberate):
 *
 *  1. The conflict key is `id`, never `domain`. The directory has 7 domains
 *     shared by a parent and its Israeli R&D subsidiary - ARMO / Kubescape,
 *     Redis / Redis Israel, Philips Israel / Philips Healthcare Israel - which
 *     are two real companies each. A domain-keyed upsert would silently drop
 *     one of each pair, and `companies.domain` carries no unique constraint
 *     anyway, so PostgREST would reject the whole batch with "no unique or
 *     exclusion constraint matching".
 *
 *  2. A row that already exists under a *different* id (the scanner's own rows)
 *     is matched on lowercased name and updated in place, so importing the
 *     directory twice - or importing it after the scanner has run - never
 *     produces a duplicate. For those rows only the descriptive fields are
 *     filled in; the scanner-owned counters (devops_hiring,
 *     devops_hiring_count, score, last_seen_at) are left alone, because the
 *     directory is a point-in-time snapshot and must not overwrite live data.
 *
 * Env: SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY, loaded from webapp/.env,
 * web/.env or agents/.env when present.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

// config/ moved from agents/ to worker/ during the repo restructure; accept both
// so the script works on either side of that rename.
const CONFIG_DIR = [
  join(REPO, "worker", "config"),
  join(REPO, "agents", "config"),
].find((d) => existsSync(join(d, "israel-companies.json")));

if (!CONFIG_DIR) {
  console.error("could not find config/israel-companies.json (looked in worker/config and agents/config)");
  process.exit(1);
}

for (const envFile of ["webapp", "web", "agents"]) {
  try { process.loadEnvFile(join(REPO, envFile, ".env")); } catch { /* optional */ }
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const forced = argv.find((a) => a.startsWith("--target="))?.split("=")[1];

const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const supabaseKey =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
const target =
  forced || (supabaseUrl && supabaseKey ? "supabase" : "local");

if (target !== "local" && target !== "supabase") {
  console.error(`unknown --target=${target} (expected local or supabase)`);
  process.exit(1);
}
if (target === "supabase" && !(supabaseUrl && supabaseKey)) {
  console.error("missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (see webapp/.env)");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load + map
// ---------------------------------------------------------------------------

const directory = JSON.parse(
  await readFile(join(CONFIG_DIR, "israel-companies.json"), "utf8"),
);
const companies = directory.companies || [];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v) => (typeof v === "string" ? v.trim() : "");

function normaliseTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : []).map(str).filter(Boolean))];
}

/** Fields that only ever fill a gap; safe to write over an existing row. */
function descriptiveFields(c) {
  const row = {
    domain: str(c.domain) || null,
    industry: str(c.sector) || null,
    country: str(c.country) || null,
    open_roles_israel: num(c.open_roles_israel),
    ats: c.ats ?? null,
    tags: normaliseTags(c.tags),
  };
  // An empty value in the directory must not erase something already known.
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) delete row[k];
  }
  return row;
}

/** Everything, for a row that does not exist yet. */
function newRow(c) {
  return {
    id: c.id,
    name: str(c.name),
    domain: str(c.domain) || null,
    industry: str(c.sector) || null,
    country: str(c.country) || null,
    open_roles_israel: num(c.open_roles_israel),
    ats: c.ats ?? null,
    devops_hiring: num(c.devops_roles_israel) > 0,
    devops_hiring_count: num(c.devops_roles_israel),
    status: "active",
    tags: normaliseTags(c.tags),
  };
}

// ---------------------------------------------------------------------------
// Local JSON target
// ---------------------------------------------------------------------------

function findDataDir() {
  return [join(REPO, "data"), join(REPO, "..", "data")].find((d) => existsSync(d)) || join(REPO, "data");
}

async function seedLocal() {
  const dataDir = findDataDir();
  const file = join(dataDir, "companies.json");

  let raw = [];
  let wrapped = false;
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (Array.isArray(parsed)) raw = parsed;
    else if (parsed && Array.isArray(parsed.items)) { raw = parsed.items; wrapped = true; }
  } catch { /* no file yet */ }

  const byName = new Map();
  for (const row of raw) byName.set(str(row.name).toLowerCase(), row);
  const byId = new Set(raw.map((r) => str(r.id)));

  const inserted = [];
  const updated = [];
  const skipped = [];

  for (const c of companies) {
    if (!str(c.name)) { skipped.push(c); continue; }

    const existing =
      (byId.has(str(c.id)) ? raw.find((r) => str(r.id) === str(c.id)) : null) ||
      byName.get(str(c.name).toLowerCase());

    if (!existing) {
      const row = newRow(c);
      raw.push(row);
      byName.set(str(row.name).toLowerCase(), row);
      byId.add(row.id);
      inserted.push(row);
      continue;
    }

    // Existing row under a different id: keep the scanner's identity and its
    // live counters, fill in only what the directory knows and the row lacks.
    let changed = false;
    for (const [k, v] of Object.entries(descriptiveFields(c))) {
      const cur = existing[k];
      const empty =
        cur === undefined || cur === null || cur === "" ||
        (Array.isArray(cur) && cur.length === 0);
      if (!empty) continue;
      existing[k] = v;
      changed = true;
    }
    if (!existing.tags?.length && !Array.isArray(existing.tags)) existing.tags = normaliseTags(c.tags);
    if (changed) updated.push(existing);
    else skipped.push(c);
  }

  const payload = wrapped ? { items: raw } : raw;
  console.log(`local target: ${file}`);
  console.log(`  directory rows : ${companies.length}`);
  console.log(`  inserted       : ${inserted.length}`);
  console.log(`  filled in      : ${updated.length}`);
  console.log(`  already present: ${skipped.length}`);
  console.log(`  file rows now  : ${raw.length}`);

  if (dryRun) { console.log("dry run: nothing written"); return; }

  await mkdir(dataDir, { recursive: true });
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log("written.");
}

// ---------------------------------------------------------------------------
// Supabase target
// ---------------------------------------------------------------------------

async function sbGetAll(table, select) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?select=${select}`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  if (!res.ok) throw new Error(`GET ${table} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function seedSupabase() {
  const existing = await sbGetAll("companies", "id,name");
  const byName = new Map();
  const byId = new Map();
  for (const row of existing) {
    byName.set(str(row.name).toLowerCase(), row);
    byId.set(str(row.id), row);
  }

  const inserts = [];
  const updates = [];
  for (const c of companies) {
    if (!str(c.name)) continue;
    const match = byId.get(str(c.id)) || byName.get(str(c.name).toLowerCase());
    if (!match) { inserts.push(newRow(c)); continue; }
    // Preserve the existing id so the upsert updates rather than duplicates.
    updates.push({ id: match.id, ...descriptiveFields(c) });
  }

  console.log(`supabase target: ${supabaseUrl}`);
  console.log(`  existing rows  : ${existing.length}`);
  console.log(`  to insert      : ${inserts.length}`);
  console.log(`  to fill in     : ${updates.length}`);

  if (dryRun) {
    for (const row of inserts.slice(0, 10)) console.log(`  + ${row.name} (${row.domain})`);
    console.log(`  ... and ${Math.max(0, inserts.length - 10)} more`);
    console.log("dry run: nothing written");
    return;
  }

  // Chunked so one bad row cannot fail 739 rows at once, and so the payload
  // stays well inside PostgREST's practical body limit.
  const CHUNK = 200;
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let firstError = "";

  async function push(rows, onOk) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      const res = await fetch(`${supabaseUrl}/rest/v1/companies?on_conflict=id`, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "content-type": "application/json",
          // merge-duplicates turns a repeat import into an update
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(batch),
      });
      if (res.ok) onOk(batch.length);
      else {
        failed += batch.length;
        if (!firstError) firstError = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      }
    }
  }

  await push(inserts, (n) => { inserted += n; });
  await push(updates, (n) => { updated += n; });

  console.log(`  upserted       : ${inserted} new, ${updated} filled in`);
  if (firstError) {
    console.error(`  FAILED         : ${failed} rows - ${firstError}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------

if (target === "supabase") await seedSupabase();
else await seedLocal();