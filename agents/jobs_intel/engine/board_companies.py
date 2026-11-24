"""Companies discovered on job boards, registered as scan agents.

Every company that shows up in a scanned job (LinkedIn, Drushim, portals...)
and is not already covered by an ATS / Comeet agent is added to
agents/config/board-companies.json, so the next run can scan it on its own
(a company-name search on the boards, filtered to that company).
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Dict, Iterable, List

from .settings import settings
from .util import now_iso

CONFIG_DIR = settings.agents_dir / "config"
BOARD_CONFIG = CONFIG_DIR / "board-companies.json"
ATS_CONFIG = CONFIG_DIR / "ats-companies.json"
COMEET_CONFIG = CONFIG_DIR / "comeet-companies.json"

JUNK_NAMES = {"unknown", "confidential", "undisclosed", "חסוי", "לא ידוע", "חברה חסויה", "stealth", "stealth startup"}
SUFFIX_RE = re.compile(r"\b(ltd|inc|llc|bv|gmbh|corp|corporation|limited|israel|technologies|בע\"?מ|ישראל)\b\.?", re.I)


def clean_name(value: Any) -> str:
    return " ".join(str(value or "").replace("\u200f", "").replace("\u200e", "").split())


def name_key(value: Any) -> str:
    """Comparable company key: 'Evoke Ltd.' == 'evoke' == 'EVOKE Israel'."""
    text = SUFFIX_RE.sub(" ", clean_name(value).casefold())
    return re.sub(r"[^\w]+", "", text)


def make_slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-")
    if len(slug) < 2:
        slug = "c-" + hashlib.sha1(name.encode("utf-8")).hexdigest()[:10]
    return slug[:60]


def _read(path) -> Dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"companies": data}
    except (OSError, ValueError):
        return {}


def load() -> List[Dict[str, Any]]:
    return [c for c in _read(BOARD_CONFIG).get("companies") or [] if isinstance(c, dict) and c.get("slug")]


def _covered_keys() -> set:
    keys = set()
    for path in (ATS_CONFIG, COMEET_CONFIG):
        for c in _read(path).get("companies") or []:
            if isinstance(c, dict):
                keys.add(name_key(c.get("name")))
    return keys - {""}


def matches(company: Any, target: Dict[str, Any]) -> bool:
    key = name_key(company)
    return bool(key) and key == target.get("key")


def register(jobs: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Add every new company seen in `jobs` as a board-company agent. Returns the added rows."""
    data = _read(BOARD_CONFIG)
    rows: List[Dict[str, Any]] = [c for c in data.get("companies") or [] if isinstance(c, dict)]
    by_key = {c.get("key") or name_key(c.get("name")): c for c in rows}
    covered = _covered_keys()
    slugs = {c.get("slug") for c in rows}
    now = now_iso()
    added: List[Dict[str, Any]] = []
    changed = False

    for job in jobs:
        # Portal rows carry the portal's (agency's) name, not the hiring company.
        if job.get("source") == "custom":
            continue
        name = clean_name(job.get("company"))
        key = name_key(name)
        if (not key or len(name) > 120 or name.casefold() in JUNK_NAMES or key in covered
                or "confidential" in key or "חסוי" in key
                or str(job.get("country") or "IL").upper() != "IL"):
            continue
        existing = by_key.get(key)
        if existing:
            existing["jobs_seen"] = int(existing.get("jobs_seen") or 0) + 1
            existing["last_seen_at"] = now
            if not existing.get("domain") and job.get("company_domain"):
                existing["domain"] = job["company_domain"]
            changed = True
            continue
        slug = make_slug(name)
        while slug in slugs:
            slug = f"{slug}-{hashlib.sha1(key.encode('utf-8')).hexdigest()[:4]}"
        row = {
            "name": name, "slug": slug, "key": key,
            "domain": job.get("company_domain") or None,
            "found_on": job.get("source"), "jobs_seen": 1,
            "first_seen_at": now, "last_seen_at": now,
        }
        rows.append(row)
        by_key[key] = row
        slugs.add(slug)
        added.append(row)
        changed = True

    if changed:
        data.setdefault("_comment", "Companies found on job boards (LinkedIn, Drushim, ...) that are scanned "
                                    "as their own agent. Maintained automatically by scan_jobs.py.")
        data["companies"] = sorted(rows, key=lambda r: r["name"].casefold())
        tmp = BOARD_CONFIG.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(BOARD_CONFIG)
    return added


def remove_covered() -> int:
    """Drop board companies that now have a real ATS / Comeet agent."""
    data = _read(BOARD_CONFIG)
    rows = [c for c in data.get("companies") or [] if isinstance(c, dict)]
    covered = _covered_keys()
    kept = [c for c in rows if (c.get("key") or name_key(c.get("name"))) not in covered]
    if len(kept) != len(rows):
        data["companies"] = kept
        tmp = BOARD_CONFIG.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(BOARD_CONFIG)
    return len(rows) - len(kept)
