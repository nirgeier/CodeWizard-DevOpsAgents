#!/usr/bin/env python3
"""Find the Israeli employers in the roster whose careers page runs on Comeet.

Comeet is the ATS a large slice of Israeli companies use, but unlike Greenhouse
or Lever its public positions API is addressed by an opaque company uid and a
per-company token rather than a guessable slug - so a company cannot be probed,
it has to be discovered. Both values are published: they are embedded in the
employer's own careers page and in every Comeet-hosted job page, which is why
job_sources.discover_comeet_token() can read them out of plain HTML.

This script automates the manual flow in agents/README-jobs.md:

  1. fetch the employer's careers page and look for a Comeet embed
  2. pull the uid (from a comeet.com/jobs/<slug>/<uid> link) and the token
  3. confirm the pair against the public positions API
  4. merge the confirmed rows into agents/config/comeet-companies.json

Usage:
    python3 agents/scripts/discover_comeet_companies.py
    python3 agents/scripts/discover_comeet_companies.py --limit 40 --dry-run
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
from typing import Any, Dict, List, Optional

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "agents" / "scripts"))

from discover_ats_companies import DEVOPS_RE, is_israel, parse_candidates  # noqa: E402

ROSTER = REPO / "agents" / "scripts" / "candidates_israel.txt"
OUT = REPO / "agents" / "config" / "comeet-companies.json"

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
TIMEOUT = 15

CAREERS_PATHS = ("/careers", "/career", "/jobs", "/about/careers", "/company/careers", "/comeet/")

JOB_LINK_RE = re.compile(r"comeet\.com/jobs/([A-Za-z0-9_-]+)/([0-9A-Fa-f]{2}\.[0-9A-Fa-f]{3})")
UID_API_RE = re.compile(r"company/([0-9A-Fa-f]{2}\.[0-9A-Fa-f]{3})")
# Embeds spell these differently per integration - the WordPress plugin emits
# "comeet_uid"/"comeet_token", the JS widget plain "uid"/"token".
UID_FIELD_RE = re.compile(r'"[a-z_]{0,16}uid"\s*:\s*"([0-9A-Fa-f]{2}\.[0-9A-Fa-f]{3})"')
TOKEN_RE = re.compile(r'"[a-z_]{0,16}token"\s*:\s*"?\s*([0-9A-Za-z]{16,})')

_lock = threading.Lock()


def log(msg: str) -> None:
    with _lock:
        print(msg, file=sys.stderr, flush=True)


def http_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.read(1_500_000).decode("utf-8", "replace")
    except Exception:
        return ""


def positions(uid: str, token: str) -> Optional[List[Dict[str, Any]]]:
    url = f"https://www.comeet.co/careers-api/2.0/company/{uid}/positions?token={token}"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
    except Exception:
        return None
    return data if isinstance(data, list) else None


def discover(cand: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    domain = (cand.get("domain") or "").strip().lower()
    if not domain or "/" in domain:
        return None

    # A page carries the company uid alongside one uid per open position, and
    # nothing in the markup reliably distinguishes them - so collect every
    # candidate and let the positions API say which one is the company. The API
    # only answers for a matching (uid, token) pair, so this cannot guess wrong.
    slug = token = ""
    uids: List[str] = []

    def remember(html: str) -> None:
        nonlocal slug, token
        m = JOB_LINK_RE.search(html)
        if m:
            slug = slug or m.group(1)
            uids.insert(0, m.group(2).upper())
        for rx in (UID_API_RE, UID_FIELD_RE):
            for hit in rx.findall(html)[:8]:
                uids.append(hit.upper())
        t = TOKEN_RE.search(html)
        if t and not token:
            token = t.group(1)

    for host in (f"https://www.{domain}", f"https://{domain}"):
        # One cheap request decides whether the host is worth six more: most
        # roster domains are perfectly alive but simply are not on Comeet, and
        # a dead host would otherwise burn the full timeout once per path.
        first = http_text(host + CAREERS_PATHS[0])
        if not first and not http_text(host):
            continue
        for path in CAREERS_PATHS:
            html = first if path == CAREERS_PATHS[0] else http_text(host + path)
            if not html or "comeet" not in html.lower():
                continue
            remember(html)
            if uids and token:
                break
        if uids and token:
            break

    # The token is always present on the Comeet-hosted page, even when the
    # employer's own site only links to it.
    if uids and not token and slug:
        remember(http_text(f"https://www.comeet.com/jobs/{slug}/{uids[0]}"))
    if not (uids and token):
        return None

    uid, rows = "", None
    seen: set = set()
    for candidate in uids:
        if candidate in seen:
            continue
        seen.add(candidate)
        rows = positions(candidate, token)
        if rows is not None:
            uid = candidate
            break
        if len(seen) >= 12:
            break
    if not uid or rows is None:
        return None

    il = sum(1 for r in rows if is_israel(((r.get("location") or {}) or {}).get("name") or ""))
    dev_il = sum(
        1 for r in rows
        if DEVOPS_RE.search(r.get("name") or "")
        and is_israel(((r.get("location") or {}) or {}).get("name") or "")
    )
    return {
        "name": cand["name"],
        "uid": uid,
        "token": token,
        "domain": domain,
        "discover_from": f"https://www.comeet.com/jobs/{slug}/{uid}" if slug else f"https://{domain}/careers",
        "positions": len(rows),
        "israel_positions": il,
        "devops_israel_positions": dev_il,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cands = parse_candidates(ROSTER)
    if args.limit:
        cands = cands[: args.limit]
    log(f"checking {len(cands)} careers pages for a Comeet embed")

    found: List[Dict[str, Any]] = []
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for row in pool.map(discover, cands):
            done += 1
            if done % 100 == 0:
                log(f"  {done}/{len(cands)} checked, {len(found)} on Comeet")
            if row:
                found.append(row)

    log(f"done: {len(found)} companies on Comeet")
    log(f"  with Israeli positions: {sum(1 for r in found if r['israel_positions'])}")
    log(f"  hiring DevOps in Israel: {sum(1 for r in found if r['devops_israel_positions'])}")

    if args.dry_run:
        print(json.dumps(found, ensure_ascii=False, indent=2))
        return 0

    existing: List[Dict[str, Any]] = []
    comment = ""
    if OUT.exists():
        try:
            data = json.loads(OUT.read_text(encoding="utf-8"))
            comment = data.get("_comment", "") if isinstance(data, dict) else ""
            existing = (data.get("companies") if isinstance(data, dict) else data) or []
        except ValueError:
            existing = []

    by_uid = {r["uid"]: r for r in existing if isinstance(r, dict) and r.get("uid")}
    for row in found:
        by_uid[row["uid"]] = {**by_uid.get(row["uid"], {}), **row}

    merged = sorted(by_uid.values(), key=lambda r: str(r.get("name", "")).lower())
    OUT.write_text(
        json.dumps(
            {
                "_comment": comment,
                "_generated_by": "agents/scripts/discover_comeet_companies.py",
                "_verified_at": time.strftime("%Y-%m-%d"),
                "companies": merged,
            },
            ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    log(f"wrote {len(merged)} companies to {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
