#!/usr/bin/env node
/**
 * Jobs/agents/seed_sources.mjs - seed public.job_sources with the job boards
 * the app scans.
 *
 * The internal app (web/agents.mjs + web/jobscan.mjs) reads its configurable
 * agents from public.job_sources, so the board list travels with the database
 * instead of a file that is not bundled into the Vercel function. This script
 * migrates the Comeet companies from config/comeet-companies.json into that
 * table. It is idempotent (ignores rows that already exist), so it is safe to
 * re-run after adding companies to the JSON file.
 *
 *   node Jobs/agents/seed_sources.mjs           # insert missing boards
 *   node Jobs/agents/seed_sources.mjs --dry-run # show what would be inserted
 *
 * Env: SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (loaded from web/.env).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
try { process.loadEnvFile(join(REPO, "web", ".env")); } catch { /* optional */ }

const dryRun = process.argv.includes("--dry-run");
const base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!base || !key) {
  console.error("missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (see web/.env)");
  process.exit(1);
}

const cfg = JSON.parse(await readFile(join(HERE, "config", "comeet-companies.json"), "utf8"));
const rows = (cfg.companies || []).map((c) => ({
  name: c.name,
  provider: "comeet",
  source_key: "comeet",
  url: c.discover_from || "",
  config: { uid: c.uid, token: c.token, domain: c.domain || "", discover_from: c.discover_from || "" },
  enabled: true,
  notes: "Comeet company careers board",
}));

if (dryRun) {
  console.log(`would seed ${rows.length} comeet companies:`);
  for (const r of rows) console.log(`  ${r.name.padEnd(20)} uid=${r.config.uid}`);
  process.exit(0);
}

const res = await fetch(`${base}/rest/v1/job_sources?on_conflict=provider,name`, {
  method: "POST",
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "content-type": "application/json",
    Prefer: "resolution=ignore-duplicates,return=representation",
  },
  body: JSON.stringify(rows),
});
const text = await res.text();
console.log(`HTTP ${res.status}`);
if (!res.ok) { console.error(text); process.exit(1); }
let inserted = [];
try { inserted = JSON.parse(text); } catch { /* ignore */ }
console.log(`seeded ${Array.isArray(inserted) ? inserted.length : "?"} new board(s); ${rows.length} total configured.`);
