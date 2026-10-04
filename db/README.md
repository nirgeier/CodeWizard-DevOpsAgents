# Database Schema

Supabase/Postgres. **One file is authoritative for this app:**

| file | contents |
|---|---|
| `schema_app.sql` | **use this** — the 8 tables the app + agents actually use |
| `sales_schema.sql` | full legacy 12-table schema (adds `job_stars`, `outreach`, `digest_logs`, `embeddings`) |

`schema_app.sql` creates:

- extensions: `pgcrypto`, `pg_trgm` (pgvector is **not** needed - only `embeddings` used it)
- tables: `companies`, `people`, `signals`, `scans`, `job_sources`, `devops_jobs`,
  `opportunities`, `settings`
- indexes (incl. `gin_trgm_ops` on company names), `cw_set_updated_at()` triggers
- **RLS enabled + `cw_anon_all` policies + grants**, so the app's publishable
  (anon) key works without a `service_role` key in the app
- seed `settings` (ICP, keywords, guardrails)

Idempotent - safe to re-run.

## Apply the schema

```bash
# Option A - Dashboard (no token needed)
#   Supabase -> SQL Editor -> paste db/schema_app.sql -> Run

# Option B - Management API token
export SUPABASE_ACCESS_TOKEN=sbp_...        # https://supabase.com/dashboard/account/tokens
node db/apply.mjs                           # applies db/schema_app.sql
node db/apply.mjs --check                   # connection check only
node db/apply.mjs --file db/sales_schema.sql # the full 12-table schema instead
```

> After DDL through the SQL API, PostgREST still serves the **old** schema cache -
> writes fail with `PGRST205 Could not find the table ... in the schema cache`
> until it is reloaded. `apply.mjs` and `transfer.mjs` send
> `notify pgrst, 'reload schema';` and poll until the tables answer; if you paste
> SQL into the Dashboard it reloads on its own.

## Transferring from another project

`db/transfer.mjs` copies the 8 tables from one Supabase project to another. The
source is only ever read; writes use `resolution=merge-duplicates`, so re-running
never duplicates rows.

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...              # DDL on the target
export TARGET_SUPABASE_URL=https://<ref>.supabase.co
export TARGET_SUPABASE_KEY=sb_publishable_...     # target publishable key
# source comes from webapp/.env.local (SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY),
# or set SOURCE_SUPABASE_URL / SOURCE_SUPABASE_KEY explicitly

node db/transfer.mjs --ref <ref> --dry-run     # plan + row counts, writes nothing
node db/transfer.mjs --ref <ref>              # schema + data + verify
node db/transfer.mjs --ref <ref> --data-only  # data only (schema already applied)
node db/transfer.mjs --ref <ref> --verify-only
```

Insert order is FK-safe (parents first); `settings` upserts on its unique `key`
because the schema seeds those three rows. At the end every table's row count is
compared source vs target and a non-zero exit code is returned on any mismatch.

## Current project

`CodeWizard-DevOpsAgents` - ref `cbygmjbtnarsdodlvcwr` (us-west-1), migrated
2026-10-03 from `CodeWizard` (`xnupezumwuufjfpnwmbj`). The live credentials live
in `webapp/.env.local` (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`) and
`agents/.env` (the Python pipeline reads `agents/.env`, then `web/.env`).

### Old project - what was left behind and why

The source project is **shared with the internal app** (`codewizard-internals` on
Vercel), which still reads these tables through its own `web/.env`:

| tables | consumer |
|---|---|
| `orders`, `users`, `access_log` | internal app auth / orders / access log |
| `companies`, `people`, `signals`, `scans`, `opportunities` | internal app tab "מודיעין מכירות" (`web/sales.mjs`, `web/server.mjs`) |
| `devops_jobs`, `job_sources`, `job_stars` | internal app tab "סוכני משרות" (`web/agents.mjs`, `web/_test_stars.mjs`) |

So those **8 tables were copied, not moved**. Note `job_stars` is used by the
internal app even though nothing in *this* repo touches it - keep it there, and
add it to this project before ever repointing the internal tabs at
`cbygmjbtnarsdodlvcwr`.

Dropped from the old project on 2026-10-03 (unreferenced by any code in any repo,
all empty except the seeded config): `settings`, `outreach`, `digest_logs`,
`embeddings`. Backup of the rows: `db/backup/2026-10-03-old-project-dropped-tables.json`;
the DDL is still in `sales_schema.sql`. `pgvector` remains installed on the old
project - it is project-wide and harmless.

## Why anon policies

The app never holds the `service_role` key. The agents and the web UI talk to
PostgREST with `SUPABASE_PUBLISHABLE_KEY`, so these tables grant the `anon` role
the access they need. Keep the `service_role` / management token out of the app
and CI. Internal tool - do not expose these tables publicly.

## Migrations

`db/migrations/01..07` are the original incremental migrations, kept for
reference/history. New environments should use `schema_app.sql` only.