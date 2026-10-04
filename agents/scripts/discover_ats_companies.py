#!/usr/bin/env python3
"""Probe Israeli employers against the public ATS APIs and rebuild ats-companies.json.

Why: agents/config/ats-companies.json is the scanner's company list, and its
contract is "only providers that actually return jobs are listed". Hand-editing
that file drifts - slugs get renamed, companies get acquired, boards go dark.
This script re-derives the whole file from a candidate list, so every row in the
output was confirmed live against the employer's own board.

Candidates live in agents/scripts/candidates_israel.txt (one per line):

    Name | domain | slug[,slug2]     # domain and slugs optional

For each candidate it tries the slug variants against the five providers the
scanner supports, keeps the provider/slug pairs that return > 0 postings, and
records how many of those postings are in Israel and how many look like DevOps.

Usage:
    python3 agents/scripts/discover_ats_companies.py                # full run
    python3 agents/scripts/discover_ats_companies.py --limit 50     # smoke test
    python3 agents/scripts/discover_ats_companies.py --dry-run      # no write
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

REPO = Path(__file__).resolve().parents[2]
CANDIDATES = REPO / "agents" / "scripts" / "candidates_israel.txt"
OUT = REPO / "agents" / "config" / "ats-companies.json"

UA = "Mozilla/5.0 (compatible; CodeWizard-JobsIntel/1.0)"
TIMEOUT = 20

PROVIDERS = ("greenhouse", "lever", "ashby", "smartrecruiters", "workable")

ISRAEL_MARKERS = (
    "israel", "israeli", "tel aviv", "tel-aviv", "telaviv", "jerusalem", "haifa",
    "beer sheva", "be'er sheva", "beersheba", "rishon", "petah tikva", "petach tikva",
    "netanya", "rehovot", "kiryat", "ashdod", "givat", "hod hasharon", "ra'anana",
    "raanana", "kfar saba", "modiin", "modi'in", "herzliya", "herzeliya", "ramat gan",
    "ramat-gan", "bnei brak", "yokneam", "yoqneam", "caesarea", "airport city",
    "holon", "bat yam", "nes ziona", "or yehuda", "migdal haemek", "karmiel",
    "ashkelon", "eilat", "ישראל", "תל אביב", "ירושלים", "חיפה",
)

DEVOPS_RE = re.compile(
    r"devops|dev\s?ops|devsecops|site\s?reliability|\bsre\b|platform\s?engineer"
    r"|infrastructure\s?engineer|cloud\s?engineer|kubernetes|release\s?engineer"
    r"|build\s?engineer|system\s?administrator|sysadmin|\bci/?cd\b|production\s?engineer",
    re.I,
)

_print_lock = threading.Lock()


def log(msg: str) -> None:
    with _print_lock:
        print(msg, file=sys.stderr, flush=True)


def http_json(url: str, retries: int = 2) -> Tuple[int, Any]:
    """(status, parsed) - never raises; a dead board is a skip, not a crash."""
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                raw = resp.read()
                try:
                    return resp.status, json.loads(raw.decode("utf-8", "replace"))
                except ValueError:
                    return resp.status, None
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < retries:
                time.sleep(2.0 * (attempt + 1))
                continue
            return exc.code, None
        except Exception:
            if attempt < retries:
                time.sleep(0.5 * (attempt + 1))
                continue
            return 0, None
    return 0, None


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text or "").lower())


def is_israel(location: str) -> bool:
    low = re.sub(r"\s+", " ", str(location or "")).strip().lower()
    return any(m in low for m in ISRAEL_MARKERS)


# --- one probe per provider; each returns ([(title, location)], board name) --- #
def _probe_greenhouse(slug: str):
    st, data = http_json(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs")
    if st != 200 or not isinstance(data, dict):
        return None
    rows, name = [], ""
    for j in data.get("jobs") or []:
        raw_loc = j.get("location")
        loc = raw_loc.get("name") if isinstance(raw_loc, dict) else ""
        offices = " ".join(
            str((o or {}).get("name") or "")
            for o in (j.get("offices") or []) if isinstance(o, dict)
        )
        rows.append((j.get("title") or "", f"{loc or ''} {offices}"))
        name = name or (j.get("company_name") or "")
    return rows, name


def _probe_lever(slug: str):
    st, data = http_json(f"https://api.lever.co/v0/postings/{slug}?mode=json")
    if st != 200 or not isinstance(data, list):
        return None
    rows = []
    for j in data:
        if not isinstance(j, dict):
            continue
        cat = j.get("categories") or {}
        extra = " ".join(str(x) for x in (j.get("workplaceType"), cat.get("allLocations")) if x)
        rows.append((j.get("text") or "", f"{cat.get('location') or ''} {extra}"))
    return rows, ""


def _probe_ashby(slug: str):
    st, data = http_json(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
    if st != 200 or not isinstance(data, dict):
        return None
    rows = []
    for j in data.get("jobs") or []:
        if not isinstance(j, dict):
            continue
        extra = " ".join(
            str((a or {}).get("value") or "")
            for a in (j.get("secondaryLocations") or []) if isinstance(a, dict)
        )
        rows.append((j.get("title") or "", f"{j.get('location') or ''} {extra}"))
    return rows, ""


def _probe_smartrecruiters(slug: str):
    st, data = http_json(
        f"https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100")
    if st != 200 or not isinstance(data, dict):
        return None
    rows, name = [], ""
    for j in data.get("content") or []:
        if not isinstance(j, dict):
            continue
        loc = j.get("location") or {}
        where = " ".join(str(loc.get(k) or "") for k in ("city", "region", "country"))
        rows.append((j.get("name") or "", where))
        name = name or ((j.get("company") or {}).get("name") or "")
    return rows, name


def _probe_workable(slug: str):
    st, data = http_json(f"https://apply.workable.com/api/v1/widget/accounts/{slug}")
    if st != 200 or not isinstance(data, dict):
        return None
    rows = []
    for j in data.get("jobs") or []:
        if not isinstance(j, dict):
            continue
        where = " ".join(str(j.get(k) or "") for k in ("city", "state", "country", "location"))
        rows.append((j.get("title") or "", where))
    return rows, str(data.get("name") or "")


PROBES = {
    "greenhouse": _probe_greenhouse,
    "lever": _probe_lever,
    "ashby": _probe_ashby,
    "smartrecruiters": _probe_smartrecruiters,
    "workable": _probe_workable,
}


def slug_variants(name: str, domain: str, explicit: List[str]) -> List[str]:
    """Slug guesses, most likely first. ATS slugs are the brand, not the FQDN."""
    out: List[str] = [s.strip().lower() for s in explicit if s.strip()]
    base = norm(name)
    if base:
        out.append(base)
    dashed = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    if dashed:
        out.append(dashed)
    if domain:
        root = re.sub(r"^www\.", "", domain.lower().split("/")[0])
        head = root.split(".")[0]
        if head:
            out.append(head)
            out.append(norm(head))
    seen: set = set()
    final: List[str] = []
    for s in out:
        s = s.strip().lower()
        if len(s) < 2 or s in seen:
            continue
        seen.add(s)
        final.append(s)
    return final[:4]


def parse_candidates(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    seen: set = set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#")[0].strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split("|")]
        name = parts[0]
        domain = parts[1] if len(parts) > 1 else ""
        explicit = [s for s in (parts[2].split(",") if len(parts) > 2 else []) if s]
        key = norm(name)
        if not name or key in seen:
            continue
        seen.add(key)
        rows.append({"name": name, "domain": domain, "explicit": explicit})
    return rows


def evaluate(cand: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return a config row if any provider/slug combination is live."""
    name, domain = cand["name"], cand["domain"]
    best: Optional[Dict[str, Any]] = None

    for slug in slug_variants(name, domain, cand["explicit"]):
        hits: Dict[str, Dict[str, int]] = {}
        total_il = total_devops = total_jobs = 0
        board_names: List[str] = []
        for prov in PROVIDERS:
            res = PROBES[prov](slug)
            if not res:
                continue
            rows, board_name = res
            if not rows:
                continue
            il = sum(1 for _t, loc in rows if is_israel(loc))
            dev = sum(1 for t, _l in rows if DEVOPS_RE.search(t or ""))
            dev_il = sum(1 for t, loc in rows if DEVOPS_RE.search(t or "") and is_israel(loc))
            hits[prov] = {"jobs": len(rows), "israel": il, "devops": dev, "devops_israel": dev_il}
            total_jobs += len(rows)
            total_il += il
            total_devops += dev
            if board_name:
                board_names.append(board_name)
        if not hits:
            continue

        # Guard against a generic slug landing on an unrelated company's board:
        # accept only if the board has Israeli postings, or names itself the same.
        named = [bn for bn in board_names if bn]
        name_ok = any(
            norm(bn).startswith(norm(name)[:6]) or norm(name).startswith(norm(bn)[:6])
            for bn in named
        )
        if total_il == 0 and named and not name_ok:
            continue

        row = {
            "name": name,
            "slug": slug,
            "domain": domain or f"{slug}.com",
            "providers": sorted(hits),
            "jobs": total_jobs,
            "israel_jobs": total_il,
            "devops_jobs": total_devops,
            "devops_israel_jobs": sum(h["devops_israel"] for h in hits.values()),
        }
        if best is None or (row["israel_jobs"], row["jobs"]) > (best["israel_jobs"], best["jobs"]):
            best = row
        if row["israel_jobs"]:
            break  # a slug with Israeli postings is the right one; stop guessing
    return best


def finalize(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Drop the matches that are probably a different company, and de-duplicate.

    A board with at least one Israeli posting has proved whose it is. One with
    none has not, so a *shortened* slug there is treated as a collision: "aim"
    for Aim Security is far more likely to be some other company's board than
    the real one. "<Brand> Israel" rows are exempt - their slug is meant to be
    the parent brand's global board.
    """
    kept: List[Dict[str, Any]] = []
    for row in rows:
        name_n, slug = norm(row["name"]), row["slug"]
        truncated = (
            name_n.startswith(slug) and len(slug) < len(name_n)
            and not row["name"].lower().rstrip().endswith("israel")
        )
        if not row.get("israel_jobs") and truncated:
            log(f"  dropped {row['name']}: slug '{slug}' has no Israeli postings "
                f"and does not spell the company")
            continue
        row["israel_verified"] = bool(row.get("israel_jobs"))
        kept.append(row)

    # Two roster rows can land on one board ("Redis" and "Redis Israel"); keep
    # the one that names the company most plainly.
    by_slug: Dict[str, Dict[str, Any]] = {}
    for row in sorted(kept, key=lambda r: (-int(r.get("israel_jobs") or 0), len(r["name"]))):
        by_slug.setdefault(f"{row['slug']}|{','.join(row['providers'])}", row)
    return sorted(by_slug.values(), key=lambda r: r["name"].lower())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="probe only the first N candidates")
    ap.add_argument("--workers", type=int, default=24)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--candidates", default=str(CANDIDATES))
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--report", default="", help="write the full probe result as JSON here")
    ap.add_argument("--from-report", default="",
                    help="rebuild the config from an earlier --report instead of re-probing")
    args = ap.parse_args()

    found: List[Dict[str, Any]] = []
    if args.from_report:
        found = json.loads(Path(args.from_report).read_text(encoding="utf-8"))
        log(f"reusing {len(found)} probed rows from {args.from_report}")
    else:
        cands = parse_candidates(Path(args.candidates))
        if args.limit:
            cands = cands[: args.limit]
        log(f"probing {len(cands)} candidates with {args.workers} workers")

        done = 0
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for row in pool.map(evaluate, cands):
                done += 1
                if done % 100 == 0:
                    log(f"  {done}/{len(cands)} probed, {len(found)} live")
                if row:
                    found.append(row)

    found = finalize(found)
    log(f"done: {len(found)} live boards")
    log(f"  with Israeli postings: {sum(1 for r in found if r['israel_jobs'])}")
    log(f"  with an open DevOps req in Israel: {sum(1 for r in found if r['devops_israel_jobs'])}")

    if args.report:
        Path(args.report).write_text(
            json.dumps(found, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.dry_run:
        return 0

    out_path = Path(args.out)
    payload = {
        "_comment": (
            "Israeli employers whose jobs are readable from a public, unauthenticated "
            "ATS JSON API - the employer's own postings, with full descriptions, so the "
            "classifier sees the real stack. Every row here was confirmed live on the "
            "date below: the board answered and returned at least one posting, and "
            "`israel_jobs` counts how many of those are in Israel. Regenerate with "
            "`python3 agents/scripts/discover_ats_companies.py`, which re-probes the "
            "roster in agents/scripts/candidates_israel.txt. The wider list of Israeli "
            "DevOps employers - including the ones with no public ATS, such as Elbit, "
            "Rafael and the banks - lives in agents/config/israel-companies.json."
        ),
        "_generated_by": "agents/scripts/discover_ats_companies.py",
        "_verified_at": time.strftime("%Y-%m-%d"),
        "companies": found,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log(f"wrote {len(found)} companies to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
