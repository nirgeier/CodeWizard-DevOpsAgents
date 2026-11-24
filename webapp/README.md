# CodeWizard DevOps Agents - Web App

Next.js web interface for DevOps Jobs intelligence and job scanning.

## Getting Started

```bash
npm install
npm run dev
```

Runs on port 3001.

## Features

- Job scanning and management
- Per-account profile links, weighted keyword ranking with matched-term explanations, dismissal feedback, and a seven-day in-app alert inbox
- Supabase email/password and Google, GitHub, or LinkedIn OIDC login (provider configuration required); account password update
- Jobs opportunities tracking
- Company and contact intelligence
- Agent pipeline management

## Job shortlist and application tracking

The jobs list can filter remote, hybrid, and onsite roles. Save a scanned role, dismiss a bad match, or mark an application you submitted; the Applications view also accepts manual entries, stages, notes, and follow-up dates. Marking a role as applied does **not** send an application. Dismissed jobs are hidden from the personalized jobs list and alerts; restore them from Applications. Tracker data is stored per account in Supabase, with owner-only RLS. Existing browser-local entries are imported once on the next tracker load and removed from local storage only after import succeeds. Localhost preview uses `data/tracked_jobs.preview.json`, isolated from production and not a substitute for a real account.

The Settings CV tab can extract text from a PDF locally or accept pasted text; matching technical terms can be reviewed and added to weighted keywords. The document itself is not uploaded or saved to the server. Matching uses explicit keyword weights, not semantic or AI inference.

To deliver daily emails, set `SUPABASE_URL`, server-only `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, `ALERT_EMAIL_FROM` (a verified sender), and `CRON_SECRET`. Schedule an HTTPS GET to `/api/cron/alerts` once per day with `Authorization: Bearer <CRON_SECRET>` using your deployment scheduler. Only users who opted into alerts and verified their email receive messages. The endpoint sends newly found matching jobs and due follow-ups, suppresses duplicate daily digests, and reports `sent` and `failed` counts. Without these variables and a scheduler, alerts remain in-app and reminders are visible on the Applications page; no mail is sent. Do not expose the secret key or cron token in the browser.

## Public careers pages

On the Agents page, **Add company** accepts ATS slugs, Comeet UID/token pairs, and public HTTPS careers pages. For a careers page, supply a unique source slug and the URL of a page with direct links to job postings. The generic scanner follows links on the same host; it does not search a portal's private API, log in, or render JavaScript. Check the page's terms and test a real scan before relying on its results. Portal scans check `robots.txt` first and fail when access is disallowed or cannot be verified. Portal sources live in `agents/config/job-scan.json`, so adding sources requires a writable persistent filesystem; serverless deployments need a durable source store before this form can save changes.

Job scans include public LinkedIn job listings, Drushim, configured Comeet and ATS boards, and explicitly configured public careers pages. The WhatsApp monitor can search only groups joined by the linked account; it cannot discover arbitrary groups. HireMeTech and other third-party sites are **not** scanned by default: add a permitted public/API feed or an authorized integration only after checking access and terms. Newly saved Israeli job postings register their named employer in Companies, without overwriting an existing profile. A company directory entry alone does not create a scan source; recurring scans revisit the underlying configured boards and portals.

To scan regularly on a host with Python, agent dependencies, and a persistent source configuration, set `CRON_SECRET` and schedule an authenticated `GET /api/cron/jobs` (for example, every six hours) with `Authorization: Bearer <CRON_SECRET>`. Run a job scan before `/api/cron/alerts` so the daily digest sees new postings. The HTTP route does not schedule itself, and a short-lived serverless function may time out during a full scan. Use a long-running worker with `python3 agents/scan_jobs.py --json` on such deployments; keep the source file and database credentials available to that worker. Do not expose `CRON_SECRET` in the browser.

### Israeli employer shortlist

The local `agents/config/israel-companies.json` directory (generated 2026-10-04) lists these employers with Israeli operations: Google Israel, Apple Israel, Microsoft Israel, NVIDIA Israel, Intel Israel, Amazon Web Services Israel, Meta Israel, IBM Israel, Oracle Israel, Salesforce Israel, Check Point Software, Wix, and monday.com. Prioritize their Israel/DevOps/SRE careers searches and verify an authorized public feed before adding each as a recurring source. These records have **no verified ATS binding or live role count** in the directory; presence there is not evidence of an open job. Live external research was unavailable when this shortlist was compiled, so current openings and site access need rechecking.

## Authentication and storage

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to a real project in `webapp/.env.local`. Configure the desired OAuth providers and allowed callback URL (`/auth/callback`) in Supabase Auth. `APP_URL` must be the canonical web origin if the app is behind a proxy. On localhost in development, check the preview option on the login page to access the app without signing in (one-hour cookie); this option is unavailable in production. Without real credentials, production fails closed. Set `DB_MODE=local|postgres|supabase` if you need to force the data backend.

For existing Supabase projects apply `db/migrations/08_user_preferences.sql` (if not already applied), then `db/migrations/09_tracked_jobs.sql`, through the SQL editor or `node db/apply.mjs --file db/migrations/09_tracked_jobs.sql`. New installations use `db/schema_app.sql`. Account tracker data requires Supabase even when the shared job data uses local JSON or Postgres; it fails closed if auth or the migration is unavailable.

**Not ready for public deployment:** the legacy shared `companies`, `people`, `signals`, `scans`, `opportunities`, `settings`, `devops_jobs`, and `job_sources` tables retain `cw_anon_all` (anonymous read/write). The scanner currently depends on publishable-key writes. Move scanner ingestion to a server-side role and remove those anonymous grants/policies before exposing a real project to the public internet. Email delivery is opt-in and requires a configured scheduler/provider; there is no push or personal WhatsApp delivery. The CV PDF import is browser-only, not account-backed file storage.
