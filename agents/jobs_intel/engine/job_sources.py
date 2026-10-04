"""Public job-board scanners for the CodeWizard job agent (stdlib only).

The agent watches public job boards for DevOps / platform / cloud roles in
Israel and turns every posting into one normalized row that the internal app
renders under the "Agents" tab. Three sources ship out of the box:

  * linkedin - the public "jobs-guest" search endpoint (no login, no API key)
  * drushim  - Drushim, Israel's largest job board (public search HTML)
  * comeet   - the public Comeet careers API (per-company uid + token)
  * ats      - employer boards (Greenhouse / Lever / Ashby / Workable /
               SmartRecruiters) via ats_sources.py; alias "ats" = all

Each source degrades to "return what it could": a blocked or changed board
never aborts the scan. LLM enrichment and authenticated connectors (Apify,
Proxycurl, ...) slot in later without touching the persistence contract.

Run through agents/scan_jobs.py; import scan() for programmatic use.
"""
from __future__ import annotations

import gzip
import html as htmlmod
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .settings import settings
from .util import now_iso, stable_id

DEFAULT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

CONFIG_DIR = settings.agents_dir / "config"
SCAN_CONFIG = CONFIG_DIR / "job-scan.json"
COMEET_CONFIG = CONFIG_DIR / "comeet-companies.json"

DEFAULT_SCAN_CONFIG: Dict[str, Any] = {
    "location": "Israel",
    "country": "IL",
    "only_israel": True,
    "max_age_days": 30,
    "pages": 2,
    "min_score": 0.35,
    "sources": ["linkedin", "drushim", "comeet"],
    "linkedin_keywords": ["DevOps", "Platform Engineer", "SRE", "Cloud Engineer", "Kubernetes", "Infrastructure Engineer"],
    "drushim_keywords": ["devops", "cloud engineer", "sre", "kubernetes", "platform engineer"],
}

# --- relevance taxonomy ---------------------------------------------------- #
# (term, weight) - role terms describe the job itself; tool terms describe the
# stack. A DevOps/platform title alone already clears the 0.35 threshold.
ROLE_TERMS: List[Tuple[str, float]] = [
    ("devops", 0.55), ("dev ops", 0.55), ("devsecops", 0.55),
    ("site reliability", 0.50), ("sre", 0.50),
    ("platform engineer", 0.50), ("platform engineering", 0.45),
    ("infrastructure engineer", 0.45), ("cloud engineer", 0.45),
    ("cloud infrastructure", 0.40), ("release engineer", 0.35),
    ("systems engineer", 0.30), ("system administrator", 0.30), ("sysadmin", 0.30),
    ("build engineer", 0.30),
]
TOOL_TERMS: List[Tuple[str, float]] = [
    ("kubernetes", 0.25), ("k8s", 0.25), ("terraform", 0.22), ("gitops", 0.22),
    ("argocd", 0.20), ("ci/cd", 0.20), ("cicd", 0.20), ("observability", 0.20),
    ("prometheus", 0.20), ("grafana", 0.20), ("openshift", 0.20),
    ("docker", 0.18), ("ansible", 0.18), ("jenkins", 0.18), ("helm", 0.18),
    ("aws", 0.15), ("eks", 0.15), ("gke", 0.15), ("cloudformation", 0.15),
    ("pulumi", 0.15), ("datadog", 0.15), ("istio", 0.15), ("github actions", 0.15),
    ("gitlab ci", 0.15), ("azure", 0.12), ("gcp", 0.12), ("linux", 0.12),
    ("networking", 0.10), ("cloud", 0.10),
]

_SENIORITY_ORDER = [
    ("student", "student"), ("intern", "intern"), ("junior", "junior"),
    ("principal", "principal"), ("architect", "architect"),
    ("head of", "head"), ("director", "director"), ("vp ", "vp"),
    ("manager", "manager"), ("team lead", "lead"), ("tech lead", "lead"),
    ("lead ", "lead"), ("senior", "senior"), ("sr.", "senior"),
]


def _unescape(text: str) -> str:
    return htmlmod.unescape(text or "")


def _ws(text: str) -> str:
    """Strip tags + entities + collapse whitespace into one clean line."""
    text = _unescape(re.sub(r"<[^>]+>", " ", text or ""))
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


_BOILERPLATE_MARKERS = re.compile(
    r"\b(we are|we're|we have|we've|at [A-Z]\w+|about (us|the company)|"
    r"the world's|leading|trusted by|we believe|our mission|our vision|"
    r"we build|we create|we develop|we help)\b", re.I)


def _is_boilerplate(text: str) -> bool:
    """True when a paragraph is company marketing rather than the role itself.

    Bounded at 120 words: an "About the company" blurb runs longer than a
    typical requirement bullet, but a genuine requirements paragraph that long
    would be very unusual as the *first* block of a posting.
    """
    words = text.split()
    if not words or len(words) > 120:
        return False
    return bool(_BOILERPLATE_MARKERS.search(text))


def strip_leading_boilerplate(html: str) -> str:
    """Drop a company-marketing paragraph from the front of a job description.

    Greenhouse/Lever descriptions open with an "About the company" paragraph
    ("At JFrog, we're reinventing DevOps to help the world's greatest
    companies..."). That is marketing copy, not role requirements, yet it
    mentions DevOps/Platform/SRE as often as the requirements do - which made
    *every* JFrog posting look like a DevOps hire.

    Only a leading paragraph is removed, and only when it reads as company
    boilerplate, so the actual requirements are never touched.
    """
    if not html:
        return ""
    # Some Greenboards double-encode the content field (real "<p>" arriving as
    # "&lt;p&gt;"). Decode once so the paragraph scan can see the structure.
    text = _unescape(str(html)).lstrip()
    changed = text != str(html)
    # Greenboards sometimes emit a stray leading tag, so search the first few
    # paragraphs rather than anchoring to offset 0.
    for _ in range(3):
        m = re.match(r"\s*(?:<[a-zA-Z][^>]*>\s*)*<p[^>]*>(.*?)</p>", text, re.S | re.I)
        if not m:
            break
        first = _ws(re.sub(r"<[^>]+>", " ", m.group(1)))
        if _is_boilerplate(first):
            text = text[m.end():]
            changed = True
            continue
        break
    return text


def _inner(block: str, cls: str) -> str:
    m = re.search(r'class="[^"]*' + re.escape(cls) + r'[^"]*"[^>]*>(.*?)</', block, re.S)
    return _ws(m.group(1)) if m else ""


def _iso(value: Any) -> Optional[str]:
    """Best-effort ISO-8601 UTC string from a datetime / epoch / string."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat().replace("+00:00", "Z")
        except (OverflowError, OSError, ValueError):
            return None
    text = str(value).strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except ValueError:
        return parse_relative_date(text)


# --- HTTP helpers ---------------------------------------------------------- #
def http_get(url: str, timeout: int = 25, retries: int = 2) -> Optional[str]:
    """GET a public page as text. Retries transient errors; never raises."""
    headers = {
        "User-Agent": DEFAULT_UA,
        "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
    }
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                if raw[:2] == b"\x1f\x8b" or (resp.headers.get("Content-Encoding") or "").lower() == "gzip":
                    raw = gzip.decompress(raw)
                return raw.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
            return None
        except Exception:
            if attempt < retries:
                time.sleep(1.0 * (attempt + 1))
                continue
            return None
    return None


def http_json(url: str, timeout: int = 25) -> Tuple[int, Any]:
    """GET a JSON endpoint. Returns (status, parsed). status 0 = network error."""
    headers = {"User-Agent": DEFAULT_UA, "Accept": "application/json"}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            return resp.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, (json.loads(raw) if raw.strip() else None)
        except ValueError:
            return e.code, raw
    except Exception as e:  # noqa: BLE001 - network failures are expected
        return 0, str(e)


# --- classification -------------------------------------------------------- #
# Body-only evidence is discounted (a term in a JD's stack list is weaker
# evidence than the role's own name), and the gate for body-only promotion is
# stricter than the combined score.
BODY_DISCOUNT = 0.4
BODY_ROLE_THRESHOLD = 0.70


def classify(title: str, description: str = "") -> Tuple[bool, float, List[str]]:
    """DevOps relevance for a posting -> (is_devops, score 0..0.99, matched terms).

    A posting qualifies when the *title* names a DevOps/platform/cloud role, or
    when the body carries a strong cluster of *role* language on its own.

    Tool names alone never qualify a posting. A generic "Senior Software
    Engineer" whose JD lists aws + azure + gcp + kubernetes + ci/cd must not be
    reported as DevOps, even though the naive sum of its body matches crosses
    0.60 - that is the common case on ATS boards, where every JD ends with a
    boilerplate tech-stack list. So the promotion gate reads `role_body`, not
    the combined score; the combined score still drives ranking.
    """
    t = (title or "").lower()
    d = (description or "").lower()
    score = 0.0
    role_body = 0.0
    hits: List[str] = []
    title_role = False
    for term, weight in ROLE_TERMS:
        if term in t:
            score += weight
            hits.append(term)
            title_role = True
        elif d and term in d:
            score += weight * BODY_DISCOUNT
            role_body += weight * BODY_DISCOUNT
            hits.append(term)
    for term, weight in TOOL_TERMS:
        if term in t:
            score += weight
            hits.append(term)
        elif d and term in d:
            # Tool mentions inform ranking only; they cannot promote a row.
            score += weight * BODY_DISCOUNT
            hits.append(term)
    score = min(score, 0.99)
    is_devops = title_role or role_body >= BODY_ROLE_THRESHOLD
    return is_devops, round(score, 2), sorted(set(hits))


def seniority_of(text: str) -> str:
    t = (text or "").lower()
    for kw, val in _SENIORITY_ORDER:
        if kw in t:
            return val
    return ""


def work_mode(text: str) -> str:
    t = (text or "").lower()
    if "hybrid" in t or "היברידי" in t:
        return "hybrid"
    if "remote" in t or "מרחוק" in t or "מהבית" in t or "עבודה מהבית" in t:
        return "remote"
    if "on-site" in t or "onsite" in t or "on site" in t or "מהמשרד" in t:
        return "onsite"
    return ""


def employment_of(text: str) -> str:
    t = (text or "").lower()
    if "part-time" in t or "part time" in t or "משרה חלקית" in t:
        return "part-time"
    if "full-time" in t or "full time" in t or "משרה מלאה" in t:
        return "full-time"
    if "contract" in t or "freelance" in t or "פרילנס" in t:
        return "contract"
    if "intern" in t or "סטודנט" in t or "התמחות" in t:
        return "internship"
    return ""


def parse_relative_date(text: str, now: Optional[datetime] = None) -> Optional[str]:
    """Parse LinkedIn's "3 weeks ago" / Drushim's "לפני 2 שעות" into ISO UTC."""
    if not text:
        return None
    now = now or datetime.now(timezone.utc)
    t = str(text).strip().lower()

    def iso(dt: datetime) -> str:
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    if any(k in t for k in ("היום", "today", "just now", "just posted")) or t in ("now", "הרגע"):
        return iso(now)
    if "אתחול" in t:
        return None
    if "אתמול" in t or "yesterday" in t:
        return iso(now - timedelta(days=1))

    m = re.search(r"(\d+)\+?\s*(minute|min|hour|day|week|month|year)", t)
    if m:
        n, unit = int(m.group(1)), m.group(2)
        unit = {"min": "minute", "minute": "minute"}.get(unit, unit)
        if unit == "month":
            return iso(now - timedelta(days=30 * n))
        if unit == "year":
            return iso(now - timedelta(days=365 * n))
        return iso(now - timedelta(**{unit + "s": n}))

    num = re.search(r"(\d+)", t)
    n = int(num.group(1)) if num else 1
    if "דקות" in t or "דקה" in t:
        return iso(now - timedelta(minutes=n))
    if "שעות" in t or "שעה" in t:
        return iso(now - timedelta(hours=n))
    if "ימים" in t or ("יום" in t and "אתמול" not in t):
        return iso(now - timedelta(days=n))
    if "שבועיים" in t:
        return iso(now - timedelta(weeks=2))
    if "שבועות" in t or "שבוע" in t:
        return iso(now - timedelta(weeks=n))
    if "חודשיים" in t:
        return iso(now - timedelta(days=60))
    if "חודשים" in t or "חודש" in t:
        return iso(now - timedelta(days=30 * n))
    if "שנים" in t or "שנה" in t:
        return iso(now - timedelta(days=365 * n))
    return None


# --- normalized job row ---------------------------------------------------- #
def make_job(
    *,
    source: str,
    external_id: Any,
    title: str,
    company: str,
    location: str = "",
    city: str = "",
    country: str = "IL",
    url: str = "",
    description: str = "",
    posted_at: Any = None,
    posted_text: str = "",
    workplace: str = "",
    employment_raw: str = "",
    experience_raw: str = "",
    department: str = "",
    company_domain: str = "",
    keywords_seed: Optional[List[str]] = None,
    raw: Optional[Dict[str, Any]] = None,
    classify_body: Optional[str] = None,
) -> Dict[str, Any]:
    """Normalize one posting into the shared job row.

    `classify_body` lets a caller strip company marketing copy before
    relevance scoring while `description` keeps the full text for display.
    Defaults to `description`.
    """
    title = _ws(title)
    description = _ws(description)
    is_devops, score, hits = classify(title, classify_body if classify_body is not None else description)
    blob = " ".join([workplace or "", title, description])
    wm = work_mode(blob)
    emp = employment_of(" ".join([employment_raw or "", title, description]))
    sen = seniority_of(" ".join([experience_raw or "", title, description]))
    kw = sorted(set([str(k).lower() for k in (keywords_seed or [])] + hits))
    tags = list(dict.fromkeys(hits + [x for x in (wm, sen, emp) if x]))
    return {
        "id": stable_id("job", f"{source}:{external_id}"),
        "external_id": str(external_id),
        "source": source,
        "title": title or "(ללא כותרת)",
        "company": _ws(company),
        "company_domain": company_domain or None,
        "location": _ws(location),
        "city": _ws(city) or None,
        "country": country or "IL",
        "work_mode": wm or None,
        "employment": emp or None,
        "seniority": sen or None,
        "department": _ws(department) or None,
        "url": url or None,
        "description": description[:6000] or None,
        "posted_at": _iso(posted_at),
        "posted_text": _ws(posted_text) or None,
        "keywords": kw,
        "tags": tags,
        "score": score,
        "is_devops": is_devops,
        "raw": raw or {},
        "ingested_at": now_iso(),
    }


# --- source: LinkedIn ------------------------------------------------------ #
def scan_linkedin(
    keywords: List[str],
    location: str = "Israel",
    pages: int = 2,
    max_age_days: int = 30,
    sleep: float = 1.0,
) -> List[Dict[str, Any]]:
    """Public LinkedIn jobs-guest search (no auth). One row per posting."""
    jobs: List[Dict[str, Any]] = []
    seen: set = set()
    for kw in keywords:
        for page in range(max(1, pages)):
            qs = urllib.parse.urlencode({
                "keywords": kw,
                "location": location,
                "start": page * 10,
                "f_TPR": f"r{max(1, max_age_days) * 86400}",
            })
            html = http_get("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?" + qs)
            if not html:
                break
            cards = [c for c in re.findall(r"<li>.*?</li>", html, re.S) if "urn:li:jobPosting:" in c]
            fresh = 0
            for card in cards:
                urn = re.search(r"urn:li:jobPosting:(\d+)", card)
                if not urn:
                    continue
                jid = urn.group(1)
                if jid in seen:
                    continue
                seen.add(jid)
                fresh += 1
                href = re.search(r'href="([^"]*linkedin\.com/jobs/view/[^"]+)"', card)
                url = _unescape(href.group(1)).split("?")[0] if href else f"https://www.linkedin.com/jobs/view/{jid}"
                dt = re.search(r'<time[^>]*class="[^"]*job-search-card__listdate[^"]*"[^>]*datetime="([^"]+)"', card)
                posted_text = _inner(card, "job-search-card__listdate")
                posted_at = dt.group(1) if dt else parse_relative_date(posted_text)
                jobs.append(make_job(
                    source="linkedin",
                    external_id=jid,
                    title=_inner(card, "base-search-card__title"),
                    company=_inner(card, "base-search-card__subtitle"),
                    location=_inner(card, "job-search-card__location"),
                    country="IL",
                    url=url,
                    posted_at=posted_at,
                    posted_text=posted_text,
                    keywords_seed=[kw],
                    raw={"query": kw, "urn": f"urn:li:jobPosting:{jid}"},
                ))
            if fresh == 0:
                break
            time.sleep(sleep)
    return jobs


# --- source: Drushim ------------------------------------------------------- #
def scan_drushim(keywords: List[str], pages: int = 1, sleep: float = 1.0) -> List[Dict[str, Any]]:
    """Drushim (Israeli board) public search. Hebrew + English postings."""
    jobs: List[Dict[str, Any]] = []
    seen: set = set()
    for kw in keywords:
        for page in range(1, max(1, pages) + 1):
            url = f"https://www.drushim.co.il/jobs/search/{urllib.parse.quote(kw)}/"
            if page > 1:
                url += f"?page={page}"
            html = http_get(url)
            if not html:
                break
            articles = re.findall(r'<article[^>]*data-nagish="job-card-item".*?</article>', html, re.S)
            if not articles:
                break
            for art in articles:
                href = re.search(r'href="(/job/[^"]+)"', art)
                if not href:
                    continue
                path = _unescape(href.group(1))
                ext = path.strip("/").replace("/", "-")
                if ext in seen:
                    continue
                seen.add(ext)
                rows = [_ws(x) for x in re.findall(r'<div[^>]*class="[^"]*__row[^"]*"[^>]*>(.*?)</div>', art, re.S)]
                posted_text = next((r for r in rows if "לפני" in r or "היום" in r or "אתמול" in r), "")
                meta = " ".join(rows)
                jobs.append(make_job(
                    source="drushim",
                    external_id=ext,
                    title=_inner_first(art, r"<h3[^>]*class=\"[^\"]*__title[^\"]*\"[^>]*>(.*?)</h3>"),
                    company=_inner_first(art, r"<span[^>]*class=\"[^\"]*__companyName[^\"]*\"[^>]*>(.*?)</span>"),
                    location=_inner_first(art, r"<div[^>]*class=\"[^\"]*__body[^\"]*\"[^>]*>(.*?)</div>"),
                    country="IL",
                    url="https://www.drushim.co.il" + path,
                    posted_at=parse_relative_date(posted_text),
                    posted_text=posted_text,
                    employment_raw=meta,
                    experience_raw=meta,
                    keywords_seed=[kw],
                    raw={"query": kw, "meta": meta, "path": path},
                ))
            time.sleep(sleep)
    return jobs


def _inner_first(block: str, pattern: str) -> str:
    m = re.search(pattern, block, re.S)
    return _ws(m.group(1)) if m else ""


# --- source: Comeet -------------------------------------------------------- #
def load_comeet_companies() -> List[Dict[str, Any]]:
    try:
        data = json.loads(COMEET_CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if isinstance(data, dict):
        data = data.get("companies") or []
    return [c for c in data if isinstance(c, dict) and c.get("uid")]


def discover_comeet_token(page_url: str) -> Optional[str]:
    """The company token is embedded in every public Comeet-hosted page."""
    html = http_get(page_url)
    if not html:
        return None
    m = re.search(r'"token"\s*:\s*"([0-9A-Za-z]{16,})"', html)
    return m.group(1) if m else None


def _comeet_positions(uid: str, token: str) -> Tuple[int, Any]:
    url = (
        "https://www.comeet.co/careers-api/2.0/company/"
        f"{urllib.parse.quote(uid)}/positions?token={urllib.parse.quote(token)}&details=true"
    )
    return http_json(url)


def scan_comeet(
    companies: Optional[List[Dict[str, Any]]] = None,
    only_israel: bool = True,
    sleep: float = 0.5,
) -> List[Dict[str, Any]]:
    """Public Comeet careers API, one row per published position."""
    companies = companies if companies is not None else load_comeet_companies()
    jobs: List[Dict[str, Any]] = []
    for comp in companies:
        uid = str(comp.get("uid") or "").strip()
        token = str(comp.get("token") or "").strip()
        name = comp.get("name") or uid
        discover_from = comp.get("discover_from") or ""
        positions: Optional[List[Dict[str, Any]]] = None
        status, data = (0, None)
        if uid and token:
            status, data = _comeet_positions(uid, token)
            if status in (200, 206) and isinstance(data, list):
                positions = data
        if positions is None and discover_from:
            fresh = discover_comeet_token(discover_from)
            if fresh and fresh != token:
                status, data = _comeet_positions(uid, fresh)
                if status in (200, 206) and isinstance(data, list):
                    positions = data
        if positions is None:
            continue
        for pos in positions:
            loc = pos.get("location") or {}
            if only_israel and str(loc.get("country") or "").upper() != "IL":
                continue
            details = pos.get("details") or []
            desc = " ".join(_ws(d.get("value") or "") for d in details if isinstance(d, dict))
            jobs.append(make_job(
                source="comeet",
                external_id=pos.get("uid") or stable_id("comeet-pos", f"{uid}:{pos.get('name')}"),
                title=pos.get("name") or "",
                company=pos.get("company_name") or name,
                location=loc.get("name") or "",
                city=loc.get("city") or "",
                country=str(loc.get("country") or "IL").upper(),
                url=pos.get("url_comeet_hosted_page") or pos.get("position_url") or "",
                description=desc,
                posted_at=pos.get("time_updated"),
                workplace=pos.get("workplace_type") or "",
                employment_raw=pos.get("employment_type") or "",
                experience_raw=pos.get("experience_level") or "",
                department=pos.get("department") or "",
                company_domain=comp.get("domain") or "",
                raw={
                    "company_uid": uid,
                    "position_uid": pos.get("uid"),
                    "department": pos.get("department"),
                    "workplace_type": pos.get("workplace_type"),
                    "location": loc,
                },
            ))
        time.sleep(sleep)
    return jobs


# --- orchestration --------------------------------------------------------- #
def load_scan_config(overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    cfg = dict(DEFAULT_SCAN_CONFIG)
    try:
        disk = json.loads(SCAN_CONFIG.read_text(encoding="utf-8"))
        if isinstance(disk, dict):
            cfg.update({k: v for k, v in disk.items() if not k.startswith("_")})
    except (OSError, ValueError):
        pass
    if overrides:
        cfg.update({k: v for k, v in overrides.items() if v not in (None, "", [], 0)})
    return cfg


def scan_job_source(src: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Scan a custom job source (stored in job_sources table).

    Stdlib only: the generic path has no schema to lean on, so we harvest
    anchors from the HTML and keep the ones whose href or text looks like a job
    posting. Good enough for a company careers page that has no public API;
    prefer the ATS providers when the employer uses one.
    """
    url = str(src.get("url") or "").strip()
    if not url:
        return []
    keywords = src.get("keywords") or DEFAULT_SCAN_CONFIG.get("linkedin_keywords", [])
    html = http_get(url, timeout=30, retries=1)
    if not html:
        return []

    base = urllib.parse.urlparse(url)
    jobs: List[Dict[str, Any]] = []
    seen: set = set()
    # <a href="...">text</a> - both quote styles, single or double.
    for m in re.finditer(r'<a\b[^>]*href=["\']([^"\'#]+)["\'][^>]*>(.*?)</a>', html, re.S | re.I):
        href, inner = m.group(1), m.group(2)
        href = urllib.parse.urljoin(url, _unescape(href))
        if not href.startswith(("http://", "https://")):
            continue
        host = urllib.parse.urlparse(href).netloc.lower()
        if base.netloc and host != base.netloc:
            continue
        if href in seen:
            continue
        low = (href + " " + _ws(inner)).lower()
        if not ("job" in low or "career" in low or "position" in low or "משרה" in low):
            continue
        title = _ws(inner)
        if len(title) < 8:
            # Anchors are often icon-only; fall back to the slug.
            slug = [p for p in urllib.parse.urlparse(href).path.split("/") if p]
            title = _ws(slug[-1].replace("-", " ").replace("_", " ")) if slug else ""
        if len(title) < 8:
            continue
        seen.add(href)
        jobs.append(make_job(
            source="custom",
            external_id=stable_id("custom", href),
            title=title[:200],
            company="",
            location="Israel",
            country="IL",
            url=href,
            description="",
            keywords_seed=keywords if isinstance(keywords, list) else [],
            raw={"discovered_from": url},
        ))
    return jobs


def scan(
    sources: Optional[List[str]] = None,
    location: str = "Israel",
    pages: int = 2,
    max_age_days: int = 30,
    only_israel: bool = True,
    only_devops: bool = True,
    min_score: float = 0.0,
    limit: int = 0,
    linkedin_keywords: Optional[List[str]] = None,
    drushim_keywords: Optional[List[str]] = None,
    custom_sources: Optional[List[Dict[str, Any]]] = None,
    keywords: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Run the requested sources, normalize, dedupe and filter the results.

    `sources` accepts the boards (linkedin, drushim, comeet), the ATS aliases
    ("ats" = every provider, or a specific one), and "custom" for the
    generic-URL scanner. `keywords` overrides both keyword lists at once.
    """
    sources = sources or ["linkedin", "drushim", "comeet"]
    lk = keywords or linkedin_keywords
    dk = keywords or drushim_keywords
    jobs: List[Dict[str, Any]] = []

    if "linkedin" in sources:
        jobs += scan_linkedin(lk or DEFAULT_SCAN_CONFIG["linkedin_keywords"],
                              location=location, pages=pages, max_age_days=max_age_days)
    if "drushim" in sources:
        jobs += scan_drushim(dk or DEFAULT_SCAN_CONFIG["drushim_keywords"], pages=pages)
    if "comeet" in sources:
        jobs += scan_comeet(only_israel=only_israel)

    # --- ATS (employer's own boards) --------------------------------------
    try:
        from . import ats_sources
    except Exception:  # noqa: BLE001 - ATS support is optional
        ats_sources = None
    if ats_sources:
        ats_wanted: List[str] = []
        for s in sources:
            if s == "ats":
                ats_wanted.extend(ats_sources.ATS_PROVIDERS)
            elif s in ats_sources.ATS_PROVIDERS:
                ats_wanted.append(s)
        if ats_wanted:
            jobs += ats_sources.scan_ats(
                providers=list(dict.fromkeys(ats_wanted)), only_israel=only_israel)

    if custom_sources or "custom" in sources:
        for cs in (custom_sources or []):
            jobs += scan_job_source(cs)

    by_id: Dict[str, Dict[str, Any]] = {}
    for job in jobs:
        by_id.setdefault(job["id"], job)
    merged = list(by_id.values())
    if only_devops:
        merged = [j for j in merged if j.get("is_devops")]
    if min_score:
        merged = [j for j in merged if float(j.get("score") or 0) >= float(min_score)]
    merged.sort(key=lambda j: (str(j.get("posted_at") or ""), float(j.get("score") or 0)), reverse=True)
    return merged[:limit] if limit else merged
