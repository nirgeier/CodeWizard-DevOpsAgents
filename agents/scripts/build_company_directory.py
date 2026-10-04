#!/usr/bin/env python3
"""Turn the Israeli employer roster into agents/config/israel-companies.json.

Why a directory as well as ats-companies.json: the ATS config is deliberately
narrow - it only lists employers whose board answers a public JSON API, because
that file drives a scanner. But plenty of the companies that hire the most
DevOps in Israel (Elbit, Rafael, IAI, the banks) never publish to Greenhouse or
Lever, so they can never appear there. The directory is the wider answer to
"who hires DevOps in Israel", and carries the ATS binding when one exists.

Inputs:
  agents/scripts/candidates_israel.txt   - the roster, grouped by "# --- Sector ---"
  agents/config/ats-companies.json       - the verified ATS rows (optional)

Outputs:
  agents/config/israel-companies.json    - the directory
  data/companies.json                    - with --seed-data, the runtime mirror
                                           the webapp's companies page reads

Usage:
    python3 agents/scripts/build_company_directory.py
    python3 agents/scripts/build_company_directory.py --seed-data
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "agents"))

from jobs_intel.engine.util import now_iso, stable_id  # noqa: E402

ROSTER = REPO / "agents" / "scripts" / "candidates_israel.txt"
ATS_CONFIG = REPO / "agents" / "config" / "ats-companies.json"
COMEET_CONFIG = REPO / "agents" / "config" / "comeet-companies.json"
OUT = REPO / "agents" / "config" / "israel-companies.json"
DATA_COMPANIES = REPO / "data" / "companies.json"

SECTION_RE = re.compile(r"^#\s*---\s*(.+?)\s*---\s*$")


def norm(text: str) -> str:
    return " ".join(str(text or "").split()).strip().lower()


def parse_roster(path: Path) -> List[Dict[str, Any]]:
    """Rows in file order, each tagged with the sector header above it."""
    rows: List[Dict[str, Any]] = []
    seen: set = set()
    sector = "Other"
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        header = SECTION_RE.match(line)
        if header:
            sector = header.group(1)
            continue
        line = line.split("#")[0].strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split("|")]
        name = parts[0]
        key = norm(name)
        if not name or key in seen:
            continue
        seen.add(key)
        rows.append({
            "name": name,
            "domain": parts[1] if len(parts) > 1 and parts[1] else None,
            "sector": sector,
        })
    return rows


def _rows(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return []
    rows = (data.get("companies") if isinstance(data, dict) else data) or []
    return [r for r in rows if isinstance(r, dict) and r.get("name")]


def load_ats() -> Dict[str, Dict[str, Any]]:
    """Verified board rows keyed by normalised company name.

    Both configs describe the same thing - a company whose postings the scanner
    can read - so they are flattened into one shape here: which providers, and
    how many of the live postings are Israeli / DevOps.
    """
    out: Dict[str, Dict[str, Any]] = {}
    for row in _rows(ATS_CONFIG):
        out[norm(row["name"])] = {
            "providers": row.get("providers") or [],
            "slug": row.get("slug"),
            "israel_jobs": row.get("israel_jobs") or 0,
            "devops_israel_jobs": row.get("devops_israel_jobs") or 0,
        }
    for row in _rows(COMEET_CONFIG):
        key = norm(row["name"])
        prev = out.get(key, {"providers": [], "slug": None, "israel_jobs": 0,
                             "devops_israel_jobs": 0})
        out[key] = {
            "providers": sorted(set((prev["providers"] or []) + ["comeet"])),
            "slug": prev["slug"] or row.get("uid"),
            "israel_jobs": max(prev["israel_jobs"], row.get("israel_positions") or 0),
            "devops_israel_jobs": max(prev["devops_israel_jobs"],
                                      row.get("devops_israel_positions") or 0),
        }
    return out


SECTOR_TAGS = {
    "Defense and Aerospace": ["defense"],
    "Semiconductors and Hardware": ["semiconductors"],
    "Cybersecurity": ["cyber"],
    "Cloud and DevOps Tooling": ["devops-vendor"],
    "Data and AI": ["ai"],
    "Fintech and Insurtech": ["fintech"],
    "Banks, Insurers and Financial Institutions": ["finance"],
    "Adtech, Martech and Media": ["adtech"],
    "E-commerce, Retail and Logistics": ["ecommerce"],
    "Gaming": ["gaming"],
    "Health, Bio and Medtech": ["healthtech"],
    "Mobility and Automotive": ["mobility"],
    "Agritech, Foodtech and Climate": ["climatetech"],
    "Telecom and Networking": ["telecom"],
    "Enterprise Software and IT Services": ["it-services"],
    "Multinational R&D Centres in Israel": ["multinational"],
}


def build() -> List[Dict[str, Any]]:
    ats = load_ats()
    out: List[Dict[str, Any]] = []
    for row in parse_roster(ROSTER):
        hit = ats.get(norm(row["name"]))
        tags = ["israel", "devops-employer"] + SECTOR_TAGS.get(row["sector"], [])
        if hit:
            tags.append("ats-verified")
        if hit and hit.get("devops_israel_jobs"):
            tags.append("devops-hiring-now")
        out.append({
            "id": stable_id("company", norm(row["name"])),
            "name": row["name"],
            "domain": row["domain"],
            "country": "IL",
            "sector": row["sector"],
            "ats": (
                {"providers": hit.get("providers") or [], "slug": hit.get("slug")}
                if hit else None
            ),
            "open_roles_israel": int(hit.get("israel_jobs") or 0) if hit else 0,
            "devops_roles_israel": int(hit.get("devops_israel_jobs") or 0) if hit else 0,
            "tags": sorted(set(tags)),
        })
    return out


def seed_data(companies: List[Dict[str, Any]]) -> int:
    """Merge the directory into data/companies.json (the webapp's local mirror).

    Existing rows win on every field they already have - the scanner's own
    numbers are richer than a static roster - so this only fills in companies
    the pipeline has not met yet.
    """
    existing: List[Dict[str, Any]] = []
    if DATA_COMPANIES.exists():
        try:
            parsed = json.loads(DATA_COMPANIES.read_text(encoding="utf-8"))
            if isinstance(parsed, list):
                existing = [r for r in parsed if isinstance(r, dict)]
        except ValueError:
            existing = []
    by_id = {r.get("id"): r for r in existing if r.get("id")}

    added = 0
    for c in companies:
        if c["id"] in by_id:
            row = by_id[c["id"]]
            row["tags"] = sorted(set((row.get("tags") or []) + c["tags"]))
            row.setdefault("domain", c["domain"])
            continue
        by_id[c["id"]] = {
            "id": c["id"],
            "name": c["name"],
            "domain": c["domain"],
            "website": f"https://{c['domain']}" if c["domain"] else None,
            "industry": c["sector"],
            "employees_range": None,
            "employees_est": None,
            "country": "IL",
            "hq_city": None,
            "location": "Israel",
            "linkedin_url": None,
            "tech_stack": [],
            "cloud": [],
            "k8s": False,
            "devops_hiring": bool(c["devops_roles_israel"]),
            "devops_hiring_count": c["devops_roles_israel"],
            "platform_fit": 0.0,
            "confidence": 0.6 if c["ats"] else 0.4,
            "score": min(100, 40 + c["devops_roles_israel"] * 10 + (10 if c["ats"] else 0)),
            "service": None,
            "status": "active",
            "tags": c["tags"],
            "notes": None,
            "last_seen_at": None,
            "updated_at": now_iso(),
            "created_at": now_iso(),
        }
        added += 1

    DATA_COMPANIES.parent.mkdir(parents=True, exist_ok=True)
    DATA_COMPANIES.write_text(
        json.dumps(list(by_id.values()), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    return added


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed-data", action="store_true",
                    help="also merge into data/companies.json for the webapp")
    args = ap.parse_args()

    companies = build()
    verified = sum(1 for c in companies if c["ats"])
    hiring = sum(1 for c in companies if c["devops_roles_israel"])

    payload = {
        "_comment": (
            "Israeli employers that hire DevOps / SRE / platform engineers. Generated "
            "by agents/scripts/build_company_directory.py from agents/scripts/"
            "candidates_israel.txt; the `ats` field is filled in from agents/config/"
            "ats-companies.json, which only ever contains boards verified live against "
            "a public ATS API. A null `ats` means the employer hires through its own "
            "careers site or a board the scanner does not read - the LinkedIn and "
            "Drushim sources still cover those."
        ),
        "_generated_by": "agents/scripts/build_company_directory.py",
        "_generated_at": now_iso(),
        "_counts": {
            "companies": len(companies),
            "ats_verified": verified,
            "devops_open_in_israel": hiring,
        },
        "companies": companies,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(companies)} companies to {OUT}")
    print(f"  ATS-verified: {verified}")
    print(f"  open DevOps role in Israel right now: {hiring}")

    if args.seed_data:
        added = seed_data(companies)
        print(f"  seeded {added} new rows into {DATA_COMPANIES}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
