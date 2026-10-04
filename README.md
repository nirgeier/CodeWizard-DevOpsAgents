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

`data/*.json` is **read-only** — nothing in the app writes back to it. That
includes the WhatsApp scanner: it extracts jobs and shows them, but reports them
as unsaved. Set real Supabase credentials to get persistence.

>>>>>>> origin/main
### Switching to Supabase Mode
1. Copy `webapp/.env.example` to `webapp/.env.local` and add real credentials
2. Copy `agents/.env.example` to `agents/.env` and add real credentials
3. Run `./start.sh` instead of `./start-local.sh`

## Database

Supabase project **CodeWizard-DevOpsAgents** (`cbygmjbtnarsdodlvcwr`), 8 tables,
credentials in `webapp/.env.local`. Schema, migrations and the cross-project
transfer tool are documented in [`db/README.md`](db/README.md).

## WhatsApp tab

The **`/whatsapp`** tab (in the sidebar) scans WhatsApp groups for DevOps jobs.
There is no separate server and no second `npm start` — the Baileys socket is a
module inside the Next.js server (`webapp/lib/whatsapp/session.ts`), so
`./start.sh` is still the only thing you run.

**What it does**
- Pairs by QR (the QR is pushed over SSE to `/api/whatsapp/events`, so it shows
  up in the tab — no cross-origin page, no manual port)
- Lists the account's groups, lets you pick which ones to monitor, and joins or
  leaves groups by invite link
- Captures messages from monitored groups to `webapp/.wa-session/messages.ndjson`
- Extracts job posts (Hebrew + English) into the same `devops_jobs` table the
  board scanners write to, deduped on `unique (source, external_id)`

**Setup**
1. The credentials live in `webapp/.wa-session/auth_info/` (gitignored). If the
   folder is empty, open `/whatsapp` and press **התחל חיבור** → scan the QR with
   *WhatsApp → Settings → Linked devices → Link a device*.
2. Mark the job groups you want (e.g. `משרות DevOps IL`, `משרות DevOps`).
3. **חלץ משרות** to extract and save. `/whatsapp/jobs` lists what was extracted.

**Two things worth knowing**
- Only monitored groups are written to disk. This is a personal account with
  hundreds of groups on it; nothing is captured until you opt in per group.
- **"משוך היסטוריה" is best-effort.** Baileys can only *ask* the phone to push
  history (`historySyncOnDemandRequest`); it cannot read it directly. If the
  phone is offline — or WhatsApp declines to serve on-demand group history to a
  linked secondary device — you get zero and the tab says so. Live capture of new
  messages always works.

Extracted jobs land in `devops_jobs` **only in Supabase mode**. In local mode
`data/*.json` is read-only, so the tab shows what it extracted but reports that
nothing was saved.

Key files:

| Path | Role |
|---|---|
| `webapp/lib/whatsapp/session.ts` | the socket: connect, QR, groups, capture, history |
| `webapp/lib/whatsapp/extract.ts` | message → job post scoring and field parsing |
| `webapp/app/whatsapp/page.tsx` | the tab |
| `webapp/app/api/whatsapp/*` | status, session, events (SSE), groups, messages, scan |
| `webapp/patches/@whiskeysockets+baileys+6.17.16.patch` | required baileys fix (see below) |

Baileys is pinned to **6.17.16** with a `patch-package` patch applied on
`postinstall`. WhatsApp changed its protocol in 2026-07; without the patch,
pairing and message decryption break. Keep both the version and the patch in
sync if you ever bump it.
>>>>>>> origin/main
