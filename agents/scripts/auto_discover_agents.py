#!/usr/bin/env python3
"""Automatically add new scan agents (ATS / Comeet companies) to the config.

Candidates come, in priority order, from companies seen in scanned jobs, the
`companies` table, agents/config/israel-companies.json and the roster in
agents/scripts/candidates_israel.txt. Each run probes up to --limit candidates
that are not configured yet and appends every confirmed live board with
Israeli postings to ats-companies.json / comeet-companies.json (merge, never
overwrite). Probed candidates are remembered in agents/config/.discovery-state.json
so consecutive runs keep advancing through the list.

Usage:
    python3 agents/scripts/auto_discover_agents.py --json
    python3 agents/scripts/auto_discover_agents.py --limit 10 --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "agents" / "scripts"))
sys.path.insert(0, str(REPO / "agents"))

from discover_ats_companies import evaluate, norm, parse_candidates  # noqa: E402
from discover_comeet_companies import discover as discover_comeet  # noqa: E402

CONFIG = REPO / "agents" / "config"
ATS_CONFIG = CONFIG / "ats-companies.json"
COMEET_CONFIG = CONFIG / "comeet-companies.json"
ISRAEL_CONFIG = CONFIG / "israel-companies.json"
STATE = CONFIG / ".discovery-state.json"
ROSTER = REPO / "agents" / "scripts" / "candidates_israel.txt"
RETRY_DAYS = 30


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return fallback


def write_json(path: Path, data: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def clean_domain(value: Any) -> str:
    domain = str(value or "").strip().lower()
    domain = domain.removeprefix("https://").removeprefix("http://").removeprefix("www.")
    domain = domain.split("/")[0]
    return domain if "." in domain and " " not in domain else ""


def gather_candidates(use_store: bool) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []

    def add(name: Any, domain: Any = "", explicit: Optional[List[str]] = None) -> None:
        name = " ".join(str(name or "").replace("\u200f", "").replace("\u200e", "").split())
        if not name or len(name) > 80 or not norm(name):
            return
        out.append({"name": name, "domain": clean_domain(domain), "explicit": explicit or []})

    if use_store:
        try:
            from jobs_intel.engine.store import make_store
            store = make_store()
            jobs = store.read("devops_jobs", limit=5000)
            jobs.sort(key=lambda j: (not j.get("is_devops"), -(float(j.get("score") or 0))))
            for job in jobs:
                if job.get("country") in (None, "", "IL"):
                    add(job.get("company"), job.get("company_domain"))
            for company in store.read("companies", limit=10000):
                add(company.get("name"), company.get("domain") or company.get("website"))
        except Exception as exc:  # noqa: BLE001 - the static lists still work
            log(f"store unavailable, using static candidate lists only: {exc}")

    israel = read_json(ISRAEL_CONFIG, {})
    rows = sorted(israel.get("companies") or [], key=lambda c: -int(c.get("devops_roles_israel") or 0))
    for company in rows:
        add(company.get("name"), company.get("domain"))
    if ROSTER.exists():
        for cand in parse_candidates(ROSTER):
            add(cand["name"], cand["domain"], cand["explicit"])
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Discover and add new ATS/Comeet scan agents.")
    ap.add_argument("--limit", type=int, default=30, help="max new candidates to probe this run")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--dry-run", action="store_true", help="probe but do not write config")
    ap.add_argument("--no-store", action="store_true", help="skip candidates from the data store")
    ap.add_argument("--json", action="store_true", help="print a JSON summary on the last line")
    args = ap.parse_args()
    started = time.time()

    ats_data = read_json(ATS_CONFIG, {"companies": []})
    comeet_data = read_json(COMEET_CONFIG, {"companies": []})
    ats_rows: List[Dict[str, Any]] = ats_data.get("companies") or []
    comeet_rows: List[Dict[str, Any]] = comeet_data.get("companies") or []

    known_names = {norm(c.get("name")) for c in ats_rows + comeet_rows}
    known_slugs = {str(c.get("slug") or "").lower() for c in ats_rows}
    known_uids = {str(c.get("uid") or "").upper() for c in comeet_rows}
    known_domains = {clean_domain(c.get("domain")) for c in ats_rows + comeet_rows} - {""}

    state = read_json(STATE, {"probed": {}})
    probed: Dict[str, float] = state.get("probed") or {}
    cutoff = time.time() - RETRY_DAYS * 86400

    queue: List[Dict[str, Any]] = []
    seen: set = set()
    for cand in gather_candidates(not args.no_store):
        key = norm(cand["name"])
        if (key in seen or key in known_names or (cand["domain"] and cand["domain"] in known_domains)
                or probed.get(key, 0) > cutoff):
            continue
        seen.add(key)
        queue.append(cand)
    remaining = max(0, len(queue) - args.limit)
    queue = queue[: max(0, args.limit)]
    log(f"probing {len(queue)} new candidates ({remaining} more waiting)")

    def probe(cand: Dict[str, Any]) -> Dict[str, Any]:
        ats = evaluate(cand)
        if ats and ats.get("israel_jobs") and ats["slug"] not in known_slugs:
            ats["israel_verified"] = True
            return {"cand": cand, "ats": ats}
        if cand["domain"]:
            comeet = discover_comeet(cand)
            if comeet and comeet.get("israel_positions") and comeet["uid"] not in known_uids:
                return {"cand": cand, "comeet": comeet}
        return {"cand": cand}

    added: List[Dict[str, str]] = []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        for res in pool.map(probe, queue):
            probed[norm(res["cand"]["name"])] = time.time()
            if "ats" in res and res["ats"]["slug"] not in known_slugs:
                row = res["ats"]
                known_slugs.add(row["slug"])
                ats_rows.append(row)
                added.append({"type": "ats", "id": f"ats:{row['slug']}", "name": row["name"]})
                log(f"  + ATS {row['name']} ({row['slug']}: {','.join(row['providers'])})")
            elif "comeet" in res and res["comeet"]["uid"] not in known_uids:
                row = res["comeet"]
                known_uids.add(row["uid"])
                comeet_rows.append(row)
                added.append({"type": "comeet", "id": f"comeet:{row['uid']}", "name": row["name"]})
                log(f"  + Comeet {row['name']} ({row['uid']})")

    if not args.dry_run:
        today = time.strftime("%Y-%m-%d")
        if any(a["type"] == "ats" for a in added):
            ats_data["companies"] = sorted(ats_rows, key=lambda r: str(r.get("name", "")).lower())
            ats_data["_verified_at"] = today
            write_json(ATS_CONFIG, ats_data)
        if any(a["type"] == "comeet" for a in added):
            comeet_data["companies"] = sorted(comeet_rows, key=lambda r: str(r.get("name", "")).lower())
            comeet_data["_verified_at"] = today
            write_json(COMEET_CONFIG, comeet_data)
        write_json(STATE, {"probed": probed})
        if added:
            from jobs_intel.engine import board_companies
            board_companies.remove_covered()

    summary = {
        "ok": True,
        "probed": len(queue),
        "added": added,
        "remaining": remaining,
        "dry_run": args.dry_run,
        "duration_ms": int((time.time() - started) * 1000),
    }
    if args.json:
        print(json.dumps(summary, ensure_ascii=False))
    else:
        log(f"added {len(added)} agents, {remaining} candidates left for the next run")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
