# Jobs Intelligence Agents

Rule-based, dependency-free pipeline that turns repo data into explainable
opportunities. Pure Python 3 stdlib - no `pip install`, no LangGraph, no API
keys required. LLM enrichment and external connectors can be layered on later.

## Run

```bash
cd Jobs/agents

python3 run.py                  # human-readable summary
python3 run.py --json           # JSON summary (used by the web apps)
python3 run.py --no-db          # force local JSON store (ignore Supabase)
python3 run.py --mode targeted  # label the scan
python3 run.py --limit 200      # cap signals
python3 run.py --no-persist     # analyse only
```

## What it does

```
sources  ->  signals  ->  companies  ->  people  ->  opportunities
```

| Stage | Module | Output |
|-------|--------|--------|
| Sources | `jobs_intel/engine/sources.py` | `agent/data/{jobs,leads,inbox}.json` (+ optional NewsAPI/GNews) |
| Signals | `jobs_intel/engine/signals.py` | one row per observable fact: hiring post / group intent / news, with `hash`, `url`, `occurred_at` |
| Companies | `jobs_intel/engine/companies.py` | employers merged by name **and alias**, with stacks, cloud, k8s, hiring volume |
| People | `jobs_intel/engine/people.py` | public hiring contacts (recruiter emails/links) - no scraping, no invented data |
| Scoring | `jobs_intel/engine/scoring.py` | explainable confidence: every point maps to a named factor |
| Opportunities | `jobs_intel/engine/opportunities.py` | WHO / WHAT / WHY NOW / PAIN / CONTEXT / APPROACH / QUESTION + evidence |
| Storage | `jobs_intel/engine/store.py` | Supabase (REST, `on_conflict=id`) or `Jobs/data/*.json` |

### Guardrails
- An opportunity is dropped unless **WHY NOW can be evidenced** (a dated signal).
- `REQUIRE_EVIDENCE=true` rejects unverified companies that have no source URL.
- Confidence threshold `MIN_OPPORTUNITY_CONFIDENCE=0.65`.
- Human decisions (approve/reject/notes) are **preserved** across re-runs.

## Discord notifications

Every completed scan can post its summary plus the top opportunities to a Discord
channel. Set one of these in `agents/.env` (or export it):

```bash
# Preferred - channel webhook, posting only, no bot to manage.
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>

# Alternative - bot token. Needs Send Messages in the channel.
DISCORD_BOT_TOKEN=<token>
DISCORD_CHANNEL_ID=<id>
```

| Var | Default | Purpose |
|-----|---------|---------|
| `DISCORD_NOTIFY` | `true` | master switch; `false` disables posting |
| `DISCORD_MIN_CONFIDENCE` | `MIN_OPPORTUNITY_CONFIDENCE` | only post opportunities at or above this |
| `DISCORD_MAX_OPPORTUNITIES` | `10` | embeds per message (Discord caps at 10) |
| `DISCORD_NOTIFY_ON_EMPTY` | `false` | also post when a scan finds nothing |

Verify the credential before wiring up a schedule:

```bash
python3 scripts/test_discord.py --dry-run   # show the payload, send nothing
python3 scripts/test_discord.py             # send one sample card
```

Behaviour worth knowing:

- **A Discord failure never fails a scan.** The notification runs after the rows are
  committed and is fully guarded; the run still exits 0 and the error is logged to stderr.
- **Quiet scans stay silent** unless `DISCORD_NOTIFY_ON_EMPTY=true`.
- Messages are in Hebrew (the pipeline's opportunities are Hebrew) with a green/amber/grey
  accent by confidence, plus up to 3 evidence links per opportunity.
- Secrets are redacted out of every error string before it is returned or printed.
- Do not commit `agents/.env`; it holds the webhook/token. See `.gitignore`.

## Persistence

`store.py` probes Supabase once; if the Jobs tables are missing it falls back
to `Jobs/data/*.json`. Rows carry **deterministic ids** (`uuid5`) so re-runs
upsert instead of duplicating. The local JSON mirror is always written, so the
Next.js viewer and the internal `web/` tab work before the SQL schema is applied.

To enable Supabase: run `Jobs/db/Jobs_schema.sql` (or `node Jobs/db/apply.mjs`).
Credentials are read from the process env, `Jobs/agents/.env`, then `web/.env`
(the internal app's `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` are reused).

## Env (all optional)

| Var | Default | Purpose |
|-----|---------|---------|
| `MIN_OPPORTUNITY_CONFIDENCE` | `0.65` | opportunity threshold |
| `CORRELATION_WINDOW_DAYS` | `14` | recorded in the scan row |
| `REQUIRE_EVIDENCE` / `REQUIRE_WHY_NOW` | `true` | guardrails |
| `JOBS_LOCAL_ONLY` | – | `1` forces the local store |
| `NEWSAPI_KEY` / `GNEWS_API_KEY` | – | enable news signals |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | from `web/.env` | persistence |

## Layout

```
agents/
  run.py                     CLI entrypoint (only file you need to run)
  jobs_intel/
    engine/                  the real pipeline (stdlib)
      settings.py util.py sources.py signals.py companies.py
      people.py scoring.py opportunities.py store.py pipeline.py
    config.py schemas.py state.py prompts/ tools/ nodes/ graphs/ runners/ ...
                             optional LangGraph scaffolding kept for reference;
                             NOT imported by run.py
  scripts/                   optional helpers / Dockerfiles
```

## Notes / next steps
- Add `OPENAI_API_KEY` to enable LLM-written outreach copy (rule-based text is
  used until then).
- Add Apify/Clay/Proxycurl/Ocean.io keys to enrich people/companies.
- Wire `Jobs/api/` (FastAPI) + `workflows/n8n/` for scheduled scans and the
  WhatsApp digest.
