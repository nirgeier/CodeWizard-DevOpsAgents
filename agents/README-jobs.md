# Job agent - DevOps jobs in Israel

The job agent watches public job boards for **DevOps / platform / cloud** roles in
Israel, normalizes every posting into one row, and persists it to
`public.devops_jobs` (Supabase) plus the local mirror `Jobs/data/devops_jobs.json`.
The internal app renders those rows under the **"סוכני משרות" (Agents)** tab.

It is rule-based and dependency-free (Python stdlib only), so it runs with no API
keys. LLM enrichment and paid connectors can slot in later without changing the
persistence contract.

## Two runtimes, one contract

The same scanners exist in two places and write the same normalized rows:

- **`web/jobscan.mjs`** - an in-process JavaScript port used by the internal app.
  It powers the **per-agent "rescan"** buttons in the Agents tab and runs
  anywhere the app runs, including the serverless deployment (which has no Python
  runtime). It reuses the identical `uuid5` id scheme, so it upserts onto the
  same rows the Python scanner produces.
- **`Jobs/agents/scan_jobs.py`** - the original Python CLI, kept for scheduled
  and local/cron runs.

Both read the board list from the same place: `public.job_sources` in Supabase
(seeded from `config/comeet-companies.json` by `Jobs/agents/seed_sources.mjs`),
falling back to the repo config files when Supabase is not configured.

## The Agents tab (per-agent rescan + custom sources)

The **"סוכני משרות"** tab lists one card per agent:

- **Native agents** - `LinkedIn` and `Drushim` (fixed in code), plus `Comeet`,
  which fans out over its configured companies (each company has its own
  enable toggle and rescan button).
- **Custom agents** - any Greenhouse or Lever board the team adds, stored in
  `public.job_sources` and scannable independently.

Each card has a **rescan** button ("סרוק"), a running job count and its last scan
time; the header has **"סרוק את כולם"** (scan all). **"הוסף סוכן"** adds a custom
board (Comeet uid+token, a Greenhouse board token, or a Lever company), with a
"Israel only" toggle (on by default). Removing a custom agent also removes the
jobs it produced.

## Sources

| Source     | What it is                                        | Access |
|------------|---------------------------------------------------|--------|
| `linkedin` | LinkedIn's public `jobs-guest` search endpoint    | no login |
| `drushim`  | Drushim, Israel's largest job board (search HTML) | public |
| `comeet`   | Comeet's public careers API, per company          | public uid + token |

A blocked or redesigned board never aborts a scan - each source returns whatever
it could and the run continues.

## Run it

```bash
cd internal-app

# all sources, config defaults (Israel, 30 days, 2 pages/keyword)
python3 Jobs/agents/scan_jobs.py --json

# narrow it down
python3 Jobs/agents/scan_jobs.py --source linkedin --pages 1
python3 Jobs/agents/scan_jobs.py --keywords "DevOps,SRE" --max-age-days 7
python3 Jobs/agents/scan_jobs.py --list        # print rows, do not persist
python3 Jobs/agents/scan_jobs.py --no-db       # local mirror only
```

Output ends with a JSON summary:

```json
{"ok":true,"table":"devops_jobs","mode":"supabase","scanned":98,"saved":98,
 "by_source":{"linkedin":70,"drushim":22,"comeet":6},"duration_ms":51993}
```

## Configuration

- `config/job-scan.json` - location, page depth, recency window, min relevance
  score, and the keyword lists per source. Everything is CLI-overridable.
- `config/comeet-companies.json` - the Comeet companies to watch. A company is
  identified by its public `uid` + `token`, both embedded in the company's own
  public careers page, so they are not secrets. Add one with:

  ```bash
  python3 Jobs/agents/scan_jobs.py --comeet-discover \
    "https://www.comeet.com/jobs/<slug>/<uid>/<role>/<posuid>"
  ```

  Paste the printed `token` into `config/comeet-companies.json`. Tokens are
  re-discovered automatically at scan time from `discover_from` if they rotate.
  Then sync the file into the `public.job_sources` table the app reads (idempotent
  - existing rows are left untouched):

  ```bash
  node Jobs/agents/seed_sources.mjs           # insert any new companies
  node Jobs/agents/seed_sources.mjs --dry-run # show what would be inserted
  ```

## Relevance scoring

Each posting gets a `score` in `[0, 0.99]` from DevOps **role** terms (title
weight 1.0: `devops`, `site reliability`, `sre`, `platform engineer`,
`infrastructure engineer`, `cloud engineer`, ...) and **stack** terms
(`kubernetes`, `terraform`, `ci/cd`, `argocd`, `observability`, `aws`, ...).
A posting qualifies (`is_devops = true`) when the *title* names a relevant role,
or the combined signal is strong (>= 0.60) - a generic "full stack developer"
that merely mentions Kubernetes in its body does not.

The scanner also derives `seniority`, `work_mode` (remote/hybrid/onsite) and
`employment`, and parses relative dates ("3 weeks ago", "לפני 2 שעות").

## Persistence

Rows carry a deterministic id (`uuid5` of `source:external_id`) and the table has
a `unique (source, external_id)`, so every run is an idempotent upsert. Local
writes **merge** (scanners accumulate over time), unlike the pipeline which
replaces its snapshots. Columns are defined in `Jobs/db/Jobs_schema.sql` and
applied with:

```bash
SUPABASE_ACCESS_TOKEN=sbp_... node Jobs/db/apply.mjs --ref <project-ref>
```

## Scheduling (24/7)

`.github/workflows/scan-devops-jobs.yml` runs the scan every 6 hours and can be
triggered manually. Set two repository secrets:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (the publishable key the app already uses - the
  `devops_jobs` RLS policy grants it read/write by design)

Locally you can do the same with a cron entry:

```cron
0 */6 * * * cd /path/to/internal-app && python3 Jobs/agents/scan_jobs.py --json >> /tmp/jobs-scan.log 2>&1
```

On the deployed app the scan runs **in-process** through `web/jobscan.mjs`, so
the per-agent "rescan" and "סרוק את כולם" buttons work directly - no external
worker or Python runtime is needed. The Python CLI stays available for
scheduled/local use.
