#!/usr/bin/env node
/**
 * db/transfer.mjs - copy the DevOps Agents tables from one Supabase project to another.
 *
 *   SOURCE (read-only)                  TARGET (write)
 *   ---------------------------         ---------------------------
 *   SUPABASE_URL                        TARGET_SUPABASE_URL   (or --ref)
 *   SUPABASE_PUBLISHABLE_KEY            TARGET_SUPABASE_KEY   (publishable key)
 *                                       SUPABASE_ACCESS_TOKEN (sbp_..., DDL only)
 *
 * Both key pairs are also read from webapp/.env.local when the variables above
 * are not set, so in the common case (env still points at the old project) you
 * only need the target's URL + publishable key.
 *
 * Usage:
 *   export SUPABASE_ACCESS_TOKEN=sbp_...          # Account -> Access Tokens
 *   node db/transfer.mjs --ref abcdefghijklmnop   # schema + data + verify
 *   node db/transfer.mjs --ref <ref> --dry-run    # plan only, writes nothing
 *   node db/transfer.mjs --ref <ref> --schema-only
 *   node db/transfer.mjs --ref <ref> --data-only
 *   node db/transfer.mjs --ref <ref> --verify-only
 *   node db/transfer.mjs --check                 # target connection check only
 *
 * Options:
 *   --ref <ref>            target project ref (or TARGET_SUPABASE_URL)
 *   --file <path>          schema file (default db/schema_app.sql)
 *   --token-file <path>    read SUPABASE_ACCESS_TOKEN from a file instead of env
 *   --batch <n>            rows per insert (default 200)
 *   --yes                  skip the confirmation prompt
 *
 * Safety: the source project is only ever read (GET). Writes use
 * resolution=merge-duplicates, so re-running never duplicates rows.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

// FK-safe order: parents before children.
const TABLES = [
  "settings", // seeded by the schema; upserted on its unique `key`
  "job_sources",
  "devops_jobs",
  "companies",
  "scans",
  "people", // -> companies
  "signals", // -> companies, people
  "opportunities", // -> scans, companies, people
];
const ON_CONFLICT = { settings: "key" }; // every other table upserts on `id`
const PAGE = 1000;

// Pull the app's own env file in (does not override real env vars).
try { process.loadEnvFile(join(REPO, "webapp", ".env.local")); } catch { /* optional */ }
try { process.loadEnvFile(join(REPO, "webapp", ".env")); } catch { /* optional */ }
try { process.loadEnvFile(join(REPO, "web", ".env")); } catch { /* optional */ }

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (f) => process.argv.includes(f);

const log = (...a) => console.log(...a);
const fail = (msg) => { console.error(`error: ${msg}`); process.exit(1); };

async function resolveConfig() {
  const ref =
    arg("--ref") ||
    process.env.SUPABASE_PROJECT_REF ||
    (process.env.TARGET_SUPABASE_URL || "").match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ||
    null;

  const tokenFile = arg("--token-file");
  const token = tokenFile
    ? (await readFile(tokenFile, "utf8")).trim()
    : process.env.SUPABASE_ACCESS_TOKEN || "";

  return {
    ref,
    token,
    sourceUrl: (process.env.SOURCE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
    sourceKey: process.env.SOURCE_SUPABASE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "",
    targetUrl: (process.env.TARGET_SUPABASE_URL || (ref ? `https://${ref}.supabase.co` : "")).replace(/\/+$/, ""),
    targetKey: process.env.TARGET_SUPABASE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "",
  };
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
  if (!res.ok) {
    throw new Error(`SQL failed (${res.status}): ${JSON.stringify(data).slice(0, 600)}`);
  }
  return data;
}

function rest(url, key, extraHeaders = {}) {
  return fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...extraHeaders,
    },
  });
}

async function countRows(url, key, table) {
  const res = await rest(`${url}/rest/v1/${table}?select=*`, key, {
    Prefer: "count=exact",
    Range: "0-0",
  });
  if (!res.ok) throw new Error(`count ${table} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  const range = res.headers.get("content-range") || "";
  const total = Number(range.split("/")[1] ?? NaN);
  return Number.isFinite(total) ? total : 0;
}

async function readAll(url, key, table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const to = from + PAGE - 1;
    const res = await rest(
      `${url}/rest/v1/${table}?select=*&order=id.asc`,
      key,
      { Range: `${from}-${to}` },
    );
    if (!res.ok) throw new Error(`read ${table} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

async function insertRows(url, key, table, rows, batch) {
  const conflict = ON_CONFLICT[table];
  const q = conflict ? `?on_conflict=${encodeURIComponent(conflict)}` : "";
  for (let i = 0; i < rows.length; i += batch) {
    await post(
      `${url}/rest/v1/${table}${q}`,
      key,
      table,
      rows.slice(i, i + batch),
      { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    );
  }
}

async function post(url, key, path, body, headers) {
  const res = await fetch(url, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`write ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * PostgREST caches the database schema, so tables created through the SQL API
 * are invisible to it until the cache is reloaded. Without this the first
 * write fails with PGRST205 "Could not find the table ... in the schema cache".
 */
async function reloadSchemaCache(cfg) {
  await runSql(cfg.ref, cfg.token, "notify pgrst, 'reload schema';");
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    const res = await rest(`${cfg.targetUrl}/rest/v1/${TABLES[0]}?select=*&limit=1`, cfg.targetKey);
    if (res.ok) return true;
  }
  return false;
}

async function main() {
  const cfg = await resolveConfig();
  const batch = Number(arg("--batch", "200"));

  if (!cfg.sourceUrl || !cfg.sourceKey) {
    fail("source not configured - set SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (or SOURCE_* )");
  }
  if (!cfg.targetUrl) fail("target not configured - pass --ref <ref> or set TARGET_SUPABASE_URL");

  log(`source : ${cfg.sourceUrl}`);
  log(`target : ${cfg.targetUrl}${cfg.ref ? `  (ref ${cfg.ref})` : ""}`);
  log(`schema : ${arg("--file") || "db/schema_app.sql"}`);
  log(`tables : ${TABLES.join(", ")}`);
  log("");

  if (hasFlag("--check")) {
    if (!cfg.token) fail("SUPABASE_ACCESS_TOKEN missing (needed for SQL)");
    const r = await runSql(cfg.ref, cfg.token, "select current_database() as db, now() as at;");
    log("target connection OK:", JSON.stringify(r));
    return;
  }

  // Inventory the source first - nothing is written before this succeeds.
  const sourceCounts = {};
  let totalRows = 0;
  for (const t of TABLES) {
    sourceCounts[t] = await countRows(cfg.sourceUrl, cfg.sourceKey, t);
    totalRows += sourceCounts[t];
    log(`  source ${t.padEnd(14)} ${String(sourceCounts[t]).padStart(5)} rows`);
  }
  log(`  ${"total".padEnd(22)} ${String(totalRows).padStart(5)} rows`);
  log("");

  if (hasFlag("--verify-only")) {
    await verify(cfg, sourceCounts);
    return;
  }

  if (hasFlag("--dry-run")) {
    log("dry run - nothing written. Would:");
    if (!hasFlag("--data-only")) log(`  1. apply the schema to ${cfg.targetUrl} (idempotent)`);
    log(`  2. copy ${totalRows} rows into ${TABLES.length} tables (merge-duplicates)`);
    log("  3. compare row counts target vs source");
    return;
  }

  if (!hasFlag("--yes") && process.stdin.isTTY) {
    const answer = await prompt(
      `Write the schema + ${totalRows} rows to ${cfg.targetUrl}? [y/N] `,
    );
    if (!/^y(es)?$/i.test(answer)) { log("aborted"); return; }
  }

  if (!hasFlag("--data-only")) {
    if (!cfg.token) fail("SUPABASE_ACCESS_TOKEN missing (needed to create tables)");
    const file = arg("--file") || join(HERE, "schema_app.sql");
    const sql = await readFile(file, "utf8");
    log(`==> applying schema (${sql.length} bytes) to ${cfg.targetUrl}`);
    await runSql(cfg.ref, cfg.token, sql);
    log("    schema applied");
    log("==> reloading the PostgREST schema cache");
    const ready = await reloadSchemaCache(cfg);
    if (!ready) fail("tables created but PostgREST cannot see them yet - wait a minute and re-run with --data-only");
    log("    PostgREST is serving the new tables");
  }

  if (!hasFlag("--schema-only")) {
    for (const t of TABLES) {
      const rows = await readAll(cfg.sourceUrl, cfg.sourceKey, t);
      await insertRows(cfg.targetUrl, cfg.targetKey, t, rows, batch);
      const conflict = ON_CONFLICT[t];
      log(`  copied ${t.padEnd(14)} ${String(rows.length).padStart(5)} rows${conflict ? ` (on_conflict=${conflict})` : ""}`);
    }
  }

  log("");
  await verify(cfg, sourceCounts);
}

async function verify(cfg, sourceCounts) {
  log("==> verification");
  let ok = true;
  for (const t of TABLES) {
    const n = await countRows(cfg.targetUrl, cfg.targetKey, t);
    const match = n === sourceCounts[t];
    if (!match) ok = false;
    log(
      `  ${match ? "OK " : "DIFF"} ${t.padEnd(14)} source=${String(sourceCounts[t]).padStart(5)} target=${String(n).padStart(5)}`,
    );
  }
  log(ok ? "\nall tables match the source." : "\nmismatch - see DIFF rows above.");
  if (!ok) process.exitCode = 1;
}

function prompt(question) {
  return new Promise((res) => {
    process.stdout.write(question);
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (d) => { process.stdin.pause(); res(String(d).trim()); });
  });
}

main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });