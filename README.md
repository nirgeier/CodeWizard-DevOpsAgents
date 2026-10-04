# CodeWizard DevOps Agents

Standalone DevOps Jobs intelligence and job scanning application.
This is extracted from the internal-app Jobs section, providing the agents engine and web UI focused on DevOps job tracking and Jobs opportunities.

## Quick Start (Local Mode - No Supabase Needed)

```bash
# Start webapp only (reads local JSON files from ./data/)
./start-local.sh

# Start webapp + run a one-time scan
./start-local.sh --scan

# Run scan only (no webapp)
./start-local.sh --scan-only

# Custom port
./start-local.sh --port 4000
```

The local mode uses JSON files in `./data/` - no Supabase credentials required!
Sample data is included for opportunities, signals, companies, people, and scans.

## Run (Production Mode - Requires Supabase)

```bash
./start.sh              # dev server on http://localhost:3001
./start.sh --port 4000  # different port
./start.sh --prod       # production server (builds on first run)
./start.sh --install    # force npm install
```

Requires Node.js 20+. Dependencies in `webapp/` are installed automatically on
first run, so a fresh clone only needs `./start.sh`. Requires `python3` on PATH
for the "Run pipeline" action (see `agents/README.md`).

`start.sh` reclaims the ports before starting: whatever holds **3000** or the
target port is stopped (SIGTERM, then SIGKILL after ~3s), so a stale server from
an earlier run never blocks startup. Processes in the script's own process tree
are never killed. Use `--no-kill-ports` to skip this.

## Local Development Details

### Data Files (in `./data/`)
- `opportunities.json` - Sales opportunities with WHO/WHAT/WHY NOW/PAIN/CONTEXT/APPROACH/QUESTION
- `signals.json` - Market signals (funding, hiring, product launches, leadership changes)
- `companies.json` - Company profiles with tech stack, hiring status, fit scores
- `people.json` - Contact profiles (decision makers, influencers, recruiters)
- `scans.json` - Scan history with metadata
- `devops_jobs.json` - Raw DevOps job postings from ATS/boards

### Running Agents Locally
```bash
# One-time scan (writes to ./data/)
cd agents
JOBS_LOCAL_ONLY=1 python run.py --no-db --json

# With custom mode
JOBS_LOCAL_ONLY=1 python run.py --no-db --mode targeted

# The pipeline reads from agent/data/{jobs,leads,inbox}.json
# and writes to ./data/{signals,companies,people,opportunities,scans}.json
```

### Webapp in Local Mode
The Next.js app auto-detects local mode when `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are not set.
It reads from `./data/*.json` and caches in memory. Writes (status updates) are in-memory only.

### Switching to Supabase Mode
1. Copy `webapp/.env.example` to `webapp/.env.local` and add real credentials
2. Copy `agents/.env.example` to `agents/.env` and add real credentials
3. Run `./start.sh` instead of `./start-local.sh`

## Database

Supabase project **CodeWizard-DevOpsAgents** (`cbygmjbtnarsdodlvcwr`), 8 tables,
credentials in `webapp/.env.local`. Schema, migrations and the cross-project
transfer tool are documented in [`db/README.md`](db/README.md).
