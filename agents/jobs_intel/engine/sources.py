"""Input sources for the engine.

Primary (always available, already in the repo):
  * agent/data/jobs.json   - raw WhatsApp DevOps/IT job posts (parsed by agent/scripts)
  * agent/data/leads.json  - companies scored by agent/scripts/lib/score.mjs
  * agent/data/inbox.json  - raw messages (used for contacts / intent)

Optional (only when API keys are present): NewsAPI / GNews headlines.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List

from .settings import settings
from .util import sha16, parse_dt


def _read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def load_jobs(sources_list: List[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    jobs = []
    # Load from file (WhatsApp parsed jobs)
    try:
        data = _read_json(settings.jobs_file, {})
        if isinstance(data, dict):
            jobs.extend(list(data.get("jobs") or []))
        else:
            jobs.extend(list(data or []))
    except Exception:
        pass
    # Load from custom job sources if provided
    if sources_list:
        for src in sources_list:
            try:
                from .job_sources import scan_job_source
                jobs.extend(scan_job_source(src))
            except Exception:
                continue
    return jobs


def load_leads() -> List[Dict[str, Any]]:
    data = _read_json(settings.leads_file, {})
    if isinstance(data, dict):
        return list(data.get("leads") or [])
    return list(data or [])


def load_inbox_messages() -> List[Dict[str, Any]]:
    data = _read_json(settings.inbox_file, {})
    if isinstance(data, dict):
        return list(data.get("messages") or [])
    return list(data or [])


def load_news(keywords: List[str], since_days: int = 30) -> List[Dict[str, Any]]:
    """Optional: headline signals. Returns [] when no key is configured."""
    items: List[Dict[str, Any]] = []
    key = settings.newsapi_key
    if key:
        q = urllib.parse.quote(" OR ".join(keywords[:4]) or "devops")
        url = (
            "https://newsapi.org/v2/everything?q="
            f"{q}&language=en&sortBy=publishedAt&pageSize=50&apiKey={key}"
        )
        items += _fetch_newsapi(url, "newsapi")
    key2 = settings.gnews_api_key
    if key2 and len(items) < 40:
        q = urllib.parse.quote(" OR ".join(keywords[:4]) or "devops platform")
        url = f"https://gnews.io/api/v4/search?q={q}&lang=en&max=50&apikey={key2}"
        items += _fetch_newsapi(url, "gnews")
    return items


def _fetch_newsapi(url: str, source: str) -> List[Dict[str, Any]]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CodeWizard-JobsIntel/1.0"})
        with urllib.request.urlopen(req, timeout=25) as resp:
            payload = json.loads(resp.read().decode("utf-8", "replace"))
    except Exception:
        return []
    out = []
    for a in payload.get("articles", []):
        out.append({
            "source": source,
            "url": a.get("url"),
            "headline": a.get("title"),
            "summary": a.get("description"),
            "occurred_at": a.get("publishedAt"),
            "hash": sha16(source, a.get("title"), a.get("url")),
            "occurred_ts": (parse_dt(a.get("publishedAt")).timestamp() if parse_dt(a.get("publishedAt")) else None),
        })
    return out
