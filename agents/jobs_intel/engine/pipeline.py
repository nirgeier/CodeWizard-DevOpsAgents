"""End-to-end pipeline: sources -> signals -> companies -> people -> opportunities."""
from __future__ import annotations

import sys
import time
import uuid
from typing import Any, Dict, List, Optional

from . import companies as companies_mod
from . import opportunities as opportunities_mod
from . import people as people_mod
from . import scoring as scoring_mod
from . import signals as signals_mod
from . import sources
from . import discord as discord_mod
from .settings import settings
from .store import Store, make_store
from .util import now_iso

# Job-board / ATS sources are optional and independent of the sales pipeline:
# they enrich the signal set with fresh hiring data, but a board being down or
# unreachable must never fail a sales scan.
try:
    from . import ats_sources as ats_mod
    from . import job_sources as jobs_mod
except Exception:  # noqa: BLE001 - a broken optional module disables the feature
    ats_mod = None
    jobs_mod = None

KEYWORDS = ["devops", "platform engineering", "kubernetes", "aws", "azure", "cloud", "sre", "ci/cd"]


def _key(name: Any) -> str:
    return " ".join(str(name or "").split()).strip().lower()


def _group(rows: List[Dict[str, Any]], field: str = "company_name") -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        k = _key(r.get(field))
        if not k:
            continue
        out.setdefault(k, []).append(r)
    return out


def _augment_jobs_with_boards(
    jobs: List[Dict[str, Any]],
    board_sources: List[str],
    keywords: List[str],
    pages: int,
    only_devops: bool,
) -> List[Dict[str, Any]]:
    """Merge live board/ATS postings into the jobs list used for signals.

    De-duplicated against the existing rows so a job already present in
    agent/data/jobs.json is not counted twice. Only *DevOps* postings are kept
    by default: the sales pipeline scores hiring intent, and generic roles
    dilute the signal without adding sales value.
    """
    if jobs_mod is None:
        return jobs

    live: List[Dict[str, Any]] = []
    wanted = {s.lower() for s in board_sources}

    if wanted & {"linkedin", "drushim", "comeet"}:
        live += jobs_mod.scan(
            sources=[s for s in board_sources if s in {"linkedin", "drushim", "comeet"}],
            keywords=keywords, pages=pages, only_devops=only_devops,
        )

    ats_wanted = [s for s in board_sources if s in ats_mod.ATS_PROVIDERS] or (["greenhouse", "lever"] if "ats" in wanted else [])
    if ats_mod and ats_wanted:
        live += ats_mod.scan_ats(providers=ats_wanted, only_israel=True)

    if not live:
        return jobs

    # Normalize to the shape signals.from_jobs expects, keyed by URL/title so a
    # posting already in the static file is not re-ingested.
    def _key(row: Dict[str, Any]) -> str:
        return (row.get("url") or f"{row.get('company','')}|{row.get('title','')}").lower()

    seen = {_key(j) for j in jobs}
    added = 0
    for row in live:
        if only_devops and not row.get("is_devops"):
            continue
        k = _key(row)
        if k in seen:
            continue
        seen.add(k)
        jobs.append({
            "company": row.get("company"),
            "title": row.get("title"),
            "url": row.get("url"),
            "location": row.get("location"),
            "description": row.get("description"),
            "posted_at": row.get("posted_at"),
            "source": row.get("source"),
            "domain": row.get("company_domain"),
            "score": row.get("score"),
        })
        added += 1
    if added:
        print(f"  board jobs  : +{added} from {', '.join(sorted({r.get('source','') for r in live}))}",
              file=sys.stderr)
    return jobs


def run_pipeline(mode: str = "daily", limit: int | None = None, persist: bool = True,
                 notify: bool = True, scan_jobs_enabled: bool = False,
                 board_sources: Optional[List[str]] = None,
                 board_keywords: Optional[List[str]] = None,
                 board_pages: int = 1, board_only_devops: bool = True) -> Dict[str, Any]:
    started = time.time()
    run_id = str(uuid.uuid4())
    store: Store = make_store()

    leads = sources.load_leads()
    jobs = sources.load_jobs()
    sources.load_inbox_messages()  # currently used only for demand context
    news = sources.load_news(KEYWORDS) if (settings.newsapi_key or settings.gnews_api_key) else []

    # Optional: fresh DevOps hiring from public boards + employer ATS pages.
    # Failures here are swallowed - the scan continues with whatever we got.
    if scan_jobs_enabled:
        try:
            jobs = _augment_jobs_with_boards(jobs, board_sources, board_keywords,
                                             board_pages, board_only_devops)
        except Exception:  # noqa: BLE001
            pass

    known = [lead.get("company") for lead in leads]
    raw_signals = (
        signals_mod.from_leads(leads)
        + signals_mod.from_jobs(jobs, known)
        + signals_mod.from_news(news)
    )
    sigs = signals_mod.dedupe(raw_signals)
    if limit:
        sigs = sigs[:limit]

    comps = companies_mod.build(leads, jobs)
    sigs_by_company = _group(sigs)

    scored: List[Dict[str, Any]] = []
    for c in comps:
        res = scoring_mod.score_company(c, sigs_by_company.get(_key(c.get("name")), []))
        c["score"] = int(round(float(c.get("confidence") or 0) * 100))
        c["_reasons"] = res.get("reasons")
        scored.append(c)

    people = people_mod.build(comps, leads, jobs)
    people_by_company = _group(people)

    opps = opportunities_mod.build(scored, sigs_by_company, people_by_company)

    # Preserve human decisions (approve/reject/notes) across re-runs.
    try:
        prior = {r.get("id"): r for r in store.read("opportunities", "id,status,outreach_status,owner_notes")}
        for o in opps:
            prev = prior.get(o.get("id"))
            if prev:
                for field in ("status", "outreach_status", "owner_notes"):
                    if prev.get(field):
                        o[field] = prev[field]
    except Exception:
        pass

    # --- link foreign keys --------------------------------------------------
    company_ids = {_key(c.get("name")): c.get("id") for c in scored}
    person_ids = {p.get("id"): p for p in people}
    for s in sigs:
        s["company_id"] = company_ids.get(_key(s.get("company_name")))
    for o in opps:
        o["run_id"] = run_id
        o["company_id"] = company_ids.get(_key(o.get("company_name")))
        tgt = people_by_company.get(_key(o.get("company_name"))) or []
        if tgt:
            best = sorted(tgt, key=lambda p: -(float(p.get("relevance") or 0)))[0]
            o["target_person_id"] = best.get("id")

    # strip internal-only fields before persisting companies
    companies_out = []
    for c in scored:
        c = dict(c)
        c.pop("_reasons", None)
        companies_out.append(c)

    duration_ms = int((time.time() - started) * 1000)
    qualified = [o for o in opps if float(o.get("confidence") or 0) >= settings.min_confidence]
    scan = {
        "id": run_id,
        "mode": mode,
        "status": "completed",
        "started_at": now_iso(),
        "finished_at": now_iso(),
        "filters": {"since_days": settings.correlation_window_days},
        "query": None,
        "market_signals": len([s for s in sigs if s.get("type") == "news"]),
        "company_profiles": len(companies_out),
        "people_profiles": len(people),
        "social_signals": 0,
        "opportunities_found": len(qualified),
        "opportunities_saved": len(opps),
        "error": None,
        "duration_ms": duration_ms,
    }

    summary: Dict[str, Any] = {
        "run_id": run_id,
        "store": store.info(),
        "signals": len(sigs),
        "companies": len(companies_out),
        "people": len(people),
        "opportunities": len(opps),
        "qualified": len(qualified),
        "min_confidence": settings.min_confidence,
        "duration_ms": duration_ms,
    }

    if persist:
        # FK-safe order: companies -> people -> scans -> signals -> opportunities
        # (opportunities.run_id references scans(id), so the scan must exist first).
        summary["saved"] = {
            "companies": store.save("companies", companies_out)["saved"],
            "people": store.save("people", people)["saved"],
            "scans": store.save("scans", [scan])["saved"],
            "signals": store.save("signals", sigs)["saved"],
            "opportunities": store.save("opportunities", opps)["saved"],
        }

    # Discord last, and fully guarded: the scan above is already committed, so a
    # notification problem must never turn a good run into a failed one.
    if notify:
        try:
            result = discord_mod.notify_scan(summary, qualified)
        except Exception as e:  # defence in depth - notify_scan already swallows
            result = {"sent": False, "error": f"{type(e).__name__}: {e}"}
        summary["discord"] = result
        if result.get("sent"):
            print(f"  discord      : sent ({result.get('transport')}, "
                  f"{result.get('opportunities', 0)} opportunities)", file=sys.stderr)
        elif result.get("error"):
            print(f"  discord      : FAILED - {result['error']}", file=sys.stderr)

    return summary
