#!/usr/bin/env node
/**
 * db/apply.mjs - apply the DevOps Agents schema to Supabase.
 *
 * Uses the Supabase Management API (NOT psql), so it works with just a token:
 *
 *   export SUPABASE_ACCESS_TOKEN=sbp_...
 *   node db/apply.mjs                  # applies db/schema_app.sql (8 tables in use)
 *   node db/apply.mjs --check          # connection check only
 *   node db/apply.mjs --file db/sales_schema.sql   # full 12-table schema
 *
 * The project ref is taken (in order) from --ref, SUPABASE_PROJECT_REF, or the
 * host of SUPABASE_URL (loaded from webapp/.env.local). If the token is
 * missing/expired you can alternatively paste the schema into the Supabase
 * Dashboard -> SQL Editor -> Run. The schema is idempotent.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

// Pick up SUPABASE_URL / SUPABASE_ACCESS_TOKEN without overriding real env.
try { process.loadEnvFile(join(REPO, "webapp", ".env.local")); } catch { /* optional */ }
try { process.loadEnvFile(join(REPO, "webapp", ".env")); } catch { /* optional */ }
try { process.loadEnvFile(join(REPO, "web", ".env")); } catch { /* optional */ }

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(name);

function projectRef() {
  const explicit = arg("--ref") || process.env.SUPABASE_PROJECT_REF;
  if (explicit) return explicit;
  const url = process.env.SUPABASE_URL || "";
  const m = url.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

async function runSql(ref, token, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const ref = projectRef();
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const files = hasFlag("--check") ? [] : [arg("--file") || join(HERE, "schema_app.sql")];

  if (!ref) { console.error("No Supabase project ref. Pass --ref or set SUPABASE_URL."); process.exit(2); }
  if (!token) {
    console.error("Missing SUPABASE_ACCESS_TOKEN.");
    console.error("Create one at https://supabase.com/dashboard/account/tokens, then:");
    console.error("  export SUPABASE_ACCESS_TOKEN=sbp_... && node db/apply.mjs");
    console.error("Or paste db/schema_app.sql into Dashboard -> SQL Editor -> Run.");
    process.exit(2);
  }

  console.log(`project: ${ref}`);
  const check = await runSql(ref, token, "select current_database() as db, now() as at;");
  if (!check.ok) {
    console.error(`connection failed (${check.status}):`, JSON.stringify(check.data).slice(0, 300));
    if (check.status === 401) console.error("Token is invalid or expired - generate a new one.");
    process.exit(1);
  }
  console.log("connection OK:", JSON.stringify(check.data));

  for (const file of files) {
    const sql = await readFile(file, "utf8");
    process.stdout.write(`applying ${file} (${sql.length} bytes) ... `);
    const r = await runSql(ref, token, sql);
    if (!r.ok) {
      console.log("FAILED");
      console.error(JSON.stringify(r.data).slice(0, 1200));
      process.exit(1);
    }
    console.log("ok");
  }
  if (files.length) {
    // PostgREST caches the DB schema; new tables are invisible to it until reload.
    console.log("reloading the PostgREST schema cache ...");
    const nr = await runSql(ref, token, "notify pgrst, 'reload schema';");
    if (!nr.ok) console.warn("  reload notification failed:", JSON.stringify(nr.data).slice(0, 300));
  }
  if (!files.length) console.log("check-only: nothing applied.");
  else console.log("done. The agents will now persist to Supabase.");
}

main().catch((e) => { console.error(e); process.exit(1); });
