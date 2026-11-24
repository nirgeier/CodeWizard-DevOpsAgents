#!/usr/bin/env python3
"""scan_jobs.py - scan public job boards for DevOps jobs in Israel.

The agent scans LinkedIn, Drushim, Comeet and company ATS boards (Greenhouse,
Lever, Ashby, Workable, SmartRecruiters - see engine/job_sources.py and
engine/ats_sources.py), normalizes every posting into one `devops_jobs` row,
and persists it to Supabase (when reachable) plus the local mirror
`Jobs/data/devops_jobs.json`. The internal app renders these rows under the
"Agents" tab.

Examples:
    python3 agents/scan_jobs.py --json
    python3 agents/scan_jobs.py --source linkedin --pages 1
    python3 agents/scan_jobs.py --source ats --pages 1     # ATS boards only
    python3 agents/scan_jobs.py --keywords "DevOps,SRE" --max-age-days 7
    python3 agents/scan_jobs.py --list           # print rows, don't save
    python3 agents/scan_jobs.py --comeet-discover <hosted-job-url>
    python3 agents/scan_jobs.py --ats-probe wiz  # which ATS a company uses

Environment: reuses web/.env (SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY) via
engine/settings.py. With no Supabase creds the run stays local-only.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from jobs_intel.engine import board_companies, job_sources  # noqa: E402
from jobs_intel.engine.store import make_store  # noqa: E402
from jobs_intel.engine.util import now_iso  # noqa: E402

TABLE = "devops_jobs"
# Exact column set of public.devops_jobs - PostgREST rejects unknown keys.
COLUMNS = [
    "id", "external_id", "source", "title", "company", "company_domain",
    "location", "city", "country", "work_mode", "employment", "seniority",
    "department", "url", "description", "posted_at", "posted_text",
    "keywords", "tags", "score", "is_devops", "raw",
    "first_seen_at", "last_seen_at", "ingested_at", "created_at", "updated_at",
]


def _csv(value: str):
    return [v.strip() for v in str(value or "").split(",") if v.strip()]


def _prepare_rows(jobs, existing):
    now = now_iso()
    rows = []
    for job in jobs:
        row = {k: job.get(k) for k in COLUMNS if k in job}
        prev = existing.get(job["id"]) or {}
        row["id"] = job["id"]
        row["first_seen_at"] = prev.get("first_seen_at") or now
        row["last_seen_at"] = now
        row["ingested_at"] = job.get("ingested_at") or now
        row["created_at"] = prev.get("created_at") or now
        row["updated_at"] = now
        # Coerce numerics that may arrive as strings.
        try:
            row["score"] = float(job.get("score") or 0)
        except (TypeError, ValueError):
            row["score"] = 0.0
        row["is_devops"] = bool(job.get("is_devops"))
        row["keywords"] = list(job.get("keywords") or [])
        row["tags"] = list(job.get("tags") or [])
        row["raw"] = job.get("raw") or {}
        rows.append(row)
    return rows


def _new_companies(jobs, existing):
    from jobs_intel.engine.util import stable_id

    def normalized_name(value):
        return " ".join(str(value or "").split()).casefold().removesuffix(" israel").removesuffix(" ישראל")

    names = {normalized_name(row.get("name")) for row in existing}
    domains = {str(row.get("domain") or "").strip().lower() for row in existing if row.get("domain")}
    added = []
    for job in jobs:
        name = " ".join(str(job.get("company") or "").split())
        domain = str(job.get("company_domain") or "").strip().lower()
        if (job.get("country") != "IL" or not name or len(name) > 120 or
                name.casefold() in {"unknown", "confidential", "undisclosed", "חסוי", "לא ידוע"} or
                normalized_name(name) in names or (domain and domain in domains)):
            continue
        added.append({"id": stable_id("company", domain or name.casefold()),
                      "name": name, "domain": domain or None, "country": "IL",
                      "hq_city": job.get("city") or None})
        names.add(normalized_name(name))
        if domain:
            domains.add(domain)
    return added


def main() -> int:
    ap = argparse.ArgumentParser(description="Scan public job boards for DevOps jobs in Israel.")
    ap.add_argument("--json", action="store_true", help="print a JSON summary on the last line")
    ap.add_argument("--list", action="store_true", help="print the scanned rows and exit (no persistence)")
    ap.add_argument("--source", default="",
                    help="comma list: linkedin,drushim,comeet,ats "
                         "(or greenhouse,lever,ashby,workable,smartrecruiters; default: config)")
    ap.add_argument("--ats-company", default="",
                    help="comma list of ATS companies as slug or name:slug (overrides config)")
    ap.add_argument("--comeet-company", default="",
                    help="scan only the Comeet company with this UID")
    ap.add_argument("--portal", default="", help="scan a configured public careers page by slug")
    ap.add_argument("--board-company", default="",
                    help="scan the job boards for one company from board-companies.json (by slug)")
    ap.add_argument("--sync-agents", action="store_true",
                    help="register every company in the stored jobs as an agent, then exit")
    ap.add_argument("--ats-probe", default="",
                    help="check which ATS a company uses and how many jobs are live, then exit")
    ap.add_argument("--include-non-israel", action="store_true",
                    help="keep ATS roles outside Israel (they are filtered by default)")
    ap.add_argument("--keywords", default="", help="override keywords (comma list)")
    ap.add_argument("--location", default="", help="location string (default Israel)")
    ap.add_argument("--pages", type=int, default=0, help="pages per source/keyword (default from config)")
    ap.add_argument("--max-age-days", type=int, default=0, help="only postings newer than N days")
    ap.add_argument("--limit", type=int, default=0, help="cap rows after filtering")
    ap.add_argument("--all", action="store_true", help="keep low-relevance / non-DevOps postings too")
    ap.add_argument("--no-db", action="store_true", help="write the local mirror only, skip Supabase")
    ap.add_argument("--comeet-discover", default="", help="extract a Comeet token from a public URL and print it")
    args = ap.parse_args()

    if args.comeet_discover:
        token = job_sources.discover_comeet_token(args.comeet_discover)
        print(json.dumps({"url": args.comeet_discover, "token": token}, ensure_ascii=False))
        return 0 if token else 1

    if args.ats_probe:
        from jobs_intel.engine import ats_sources
        print(json.dumps(ats_sources.probe(args.ats_probe), ensure_ascii=False))
        return 0

    if args.sync_agents:
        store = make_store()
        added = board_companies.register(store.read(TABLE, limit=10000))
        board_companies.remove_covered()
        print(json.dumps({"ok": True, "agents_added": len(added),
                          "names": [a["name"] for a in added]}, ensure_ascii=False))
        return 0

    overrides = {}
    if args.location:
        overrides["location"] = args.location
    if args.pages:
        overrides["pages"] = args.pages
    if args.max_age_days:
        overrides["max_age_days"] = args.max_age_days
    if args.source:
        overrides["sources"] = _csv(args.source)
    cfg = job_sources.load_scan_config(overrides)

    ats_overrides = {}
    if args.ats_company:
        from jobs_intel.engine import ats_sources as _ats
        configured = {str(c.get("slug")).lower(): c for c in _ats.load_ats_companies()}
        picked = []
        for item in _csv(args.ats_company):
            name, _, slug = item.rpartition(":")
            slug = slug.strip().lower()
            picked.append(configured.get(slug) or {"name": name.strip() or slug, "slug": slug})
        ats_overrides["ats_company"] = picked
        cfg["sources"] = ["ats"]
    if args.comeet_company:
        cfg["sources"] = ["comeet"]
    custom_sources = cfg.get("portals", []) if "custom" in cfg.get("sources", []) else None
    if args.portal:
        custom_sources = [portal for portal in cfg.get("portals", [])
                          if portal.get("slug") == args.portal]
        if not custom_sources:
            ap.error("Portal not found")
        cfg["sources"] = ["custom"]

    ats_companies = None
    if ats_overrides:
        from jobs_intel.engine import ats_sources as _ats
        ats_companies = _ats.load_ats_companies(ats_overrides)
    comeet_companies = None
    if args.comeet_company:
        comeet_companies = [company for company in job_sources.load_comeet_companies()
                            if str(company.get("uid")) == args.comeet_company]
        if not comeet_companies:
            ap.error("Comeet company UID not found")

    keywords = _csv(args.keywords)
    board_company = None
    if args.board_company:
        board_company = next((c for c in board_companies.load() if c.get("slug") == args.board_company), None)
        if not board_company:
            ap.error("Board company not found")
        board_company.setdefault("key", board_companies.name_key(board_company["name"]))
        cfg["sources"] = ["linkedin", "drushim"]
        keywords = [board_company["name"]]
        custom_sources = None
    started = time.time()
    jobs = job_sources.scan(
        sources=cfg.get("sources"),
        location=cfg.get("location", "Israel"),
        pages=int(cfg.get("pages") or 2),
        max_age_days=int(cfg.get("max_age_days") or 30),
        only_israel=bool(cfg.get("only_israel", True)) and not args.include_non_israel,
        only_devops=not args.all,
        min_score=0.0 if args.all else float(cfg.get("min_score") or 0),
        limit=args.limit,
        linkedin_keywords=keywords or cfg.get("linkedin_keywords"),
        drushim_keywords=keywords or cfg.get("drushim_keywords"),
        ats_companies=ats_companies,
        comeet_companies=comeet_companies,
        custom_sources=custom_sources,
    )
    if board_company:
        jobs = [j for j in jobs if board_companies.matches(j.get("company"), board_company)]

    if args.list:
        print(json.dumps(jobs, ensure_ascii=False, indent=2, default=str))
        return 0

    store = make_store()
    if args.no_db:
        store.mode = "local"
    existing = {}
    for row in store.read(TABLE, limit=5000):
        if isinstance(row, dict) and row.get("id"):
            existing[row["id"]] = row
    rows = _prepare_rows(jobs, existing)
    save = store.save(TABLE, rows, merge=True) if rows else {"saved": 0, "mode": store.mode}
    companies = _new_companies(jobs, store.read("companies", limit=10000)) if save.get("saved") else []
    company_save = store.save("companies", companies, merge=True) if companies else {"saved": 0}
    agents_added = board_companies.register(jobs) if jobs else []

    by_source = {}
    for job in jobs:
        by_source[job["source"]] = by_source.get(job["source"], 0) + 1

    summary = {
        "ok": True,
        "table": TABLE,
        "mode": store.mode,
        "scanned": len(jobs),
        "saved": save.get("saved", len(rows)),
        "companies_added": company_save.get("saved", 0),
        "agents_added": len(agents_added),
        "agents_added_names": [a["name"] for a in agents_added][:50],
        "by_source": by_source,
        "location": cfg.get("location"),
        "keywords": keywords or cfg.get("linkedin_keywords"),
        "duration_ms": int((time.time() - started) * 1000),
        "sample": [
            {"source": j["source"], "title": j["title"], "company": j["company"],
             "location": j["location"], "score": j["score"], "url": j["url"]}
            for j in jobs[:5]
        ],
    }
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, default=str))
    else:
        print(f"scanned {summary['scanned']} jobs  ({by_source})  mode={store.mode}  saved={summary['saved']}")
        for s in summary["sample"]:
            print(f"  [{s['source']:8}] {s['score']:.2f}  {s['title'][:50]:50}  {s['company'][:24]}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
