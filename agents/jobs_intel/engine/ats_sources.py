"""Company ATS boards: Greenhouse, Lever, Ashby, Workable, SmartRecruiters.

Why this exists: the public boards (LinkedIn/Drushim) mix every employer in
Israel into one feed, so the same DevOps req shows up from three boards and
generic roles crowd out the signal. An employer ATS is the employer's *own*
posting - one row per req, no cross-board duplicates, and the full description
so the classifier can see the stack.

Every one of these is a documented, public, unauthenticated JSON endpoint:
no API key, no login, no scraping of rendered HTML. Each returns
(200, real payload) or nothing; a board that is down or renamed is skipped
without aborting the scan, matching the degrade-gracefully rule in
job_sources.py.

Unlike the boards, ATS responses are *global* - a company publishes every
location it hires in. `only_israel` therefore filters on the location string
rather than a country code, and Israeli roles are what usually survives.

Config: config/ats-companies.json, or `job_sources` CLI flags.
Extend it with:  python3 agents/scan_jobs.py --ats-probe <company>
"""
from __future__ import annotations

import concurrent.futures as futures
import json
import re
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .job_sources import _ws, http_json, make_job, strip_leading_boilerplate
from .settings import settings
from .util import stable_id


def _desc_and_body(html_or_text: str) -> tuple:
    """(full description for display, body for relevance scoring).

    ATS descriptions lead with company marketing; scoring against it flags
    every role at the company as DevOps, so the boilerplate is removed before
    classification only.
    """
    text = strip_leading_boilerplate(html_or_text or "")
    return _ws(html_or_text or ""), _ws(re.sub(r"<[^>]+>", " ", text))[:6000]

CONFIG_DIR = settings.agents_dir / "config"
ATS_CONFIG = CONFIG_DIR / "ats-companies.json"

# Location strings that mean "this role is in Israel". Matched case-insensitively
# against the raw location/country text.
ISRAEL_MARKERS = (
    "israel", "israeli", "tel aviv", "telaviv", "jerusalem", "haifa",
    "be'er sheva", "beersheba", "rishon lezion", "petah tikva", "netanya",
    "rehovot", "kiryat", "ashdod", "givat", "hod hasharon", "raanana",
    "kfar saba", " Modiin", "מדינת", "ישראל", "תל אביב", "ירושלים", "חיפה",
    "באר שבע", "ראשון לציון", "פתח תקווה", "נתניה", "רעננה", "הרצליה",
)

ATS_PROVIDERS = ("greenhouse", "lever", "ashby", "workable", "smartrecruiters")

DEFAULT_ATS_COMPANIES: List[Dict[str, Any]] = [
    # Verified live 2026-10-03 (see README for the probe command).
    {"name": "JFrog",          "slug": "jfrog",      "domain": "jfrog.com"},
    {"name": "Similarweb",     "slug": "similarweb", "domain": "similarweb.com"},
    {"name": "WalkMe",         "slug": "walkme",     "domain": "walkme.com"},
    {"name": "Cloudinary",     "slug": "cloudinary", "domain": "cloudinary.com"},
]


def _ws(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def is_israel(location: str) -> bool:
    low = _ws(location).lower()
    return any(m in low for m in ISRAEL_MARKERS)


def _company_domain(slug: str) -> str:
    # ATS slugs are almost always the bare domain ("cloudinary"), but a few use
    # "co.il" / dashes. Normalise so the domain column stays useful.
    s = slug.strip().lower()
    if not s:
        return ""
    if "." in s:
        return s
    return f"{s}.com"


# --- Greenhouse ------------------------------------------------------------ #
def scan_greenhouse(companies: Iterable[Dict[str, Any]], only_israel: bool = True,
                    sleep: float = 0.0) -> List[Dict[str, Any]]:
    """boards-api.greenhouse.io/v1/boards/{slug}/jobs - full description."""
    out: List[Dict[str, Any]] = []
    for comp in companies:
        slug = str(comp.get("slug") or "").strip().lower()
        if not slug:
            continue
        status, data = http_json(
            f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true")
        if status != 200 or not isinstance(data, dict):
            continue
        for j in data.get("jobs") or []:
            loc = ((j.get("location") or {}).get("name")) or ""
            offices = ", ".join(
                _ws((o or {}).get("name")) for o in (j.get("offices") or []) if isinstance(o, dict)
            )
            location = _ws(f"{loc} {offices}".strip())
            if only_israel and not is_israel(location):
                continue
            desc, body = _desc_and_body(j.get("content") or "")
            out.append(make_job(
                source="greenhouse",
                external_id=str(j.get("id") or stable_id("gh", slug + (j.get("title") or ""))),
                title=j.get("title") or "",
                company=j.get("company_name") or comp.get("name") or slug,
                company_domain=comp.get("domain") or _company_domain(slug),
                location=location,
                city=loc,
                country="IL",
                url=j.get("absolute_url") or "",
                description=desc[:6000],
                classify_body=body,
                posted_at=j.get("updated_at") or j.get("first_published"),
                workplace=_ws(" ".join((j.get("metadata") or [{}])[0].get("value", ""))),
                department=comp.get("name") or "",
                keywords_seed=[],
                raw={"slug": slug, "provider": "greenhouse", "offices": offices},
            ))
        if sleep:
            time.sleep(sleep)
    return out


# --- Lever ----------------------------------------------------------------- #
def scan_lever(companies: Iterable[Dict[str, Any]], only_israel: bool = True,
               sleep: float = 0.0) -> List[Dict[str, Any]]:
    """api.lever.co/v0/postings/{slug}?mode=json - descriptionPlain is ready to use."""
    out: List[Dict[str, Any]] = []
    for comp in companies:
        slug = str(comp.get("slug") or "").strip().lower()
        if not slug:
            continue
        status, data = http_json(f"https://api.lever.co/v0/postings/{slug}?mode=json")
        if status != 200 or not isinstance(data, list):
            continue
        for j in data:
            cats = j.get("categories") or {}
            loc = cats.get("location") or j.get("country") or ""
            if only_israel and not is_israel(loc):
                continue
            extra = " ".join(
                _ws(x) for x in (j.get("lists") or [])
                if isinstance(x, str)
            )
            desc, body = _desc_and_body(
                (j.get("descriptionHtml") or "") + " " + (j.get("additionalHtml") or ""))
            out.append(make_job(
                source="lever",
                external_id=str(j.get("id") or stable_id("lever", slug + (j.get("text") or ""))),
                title=j.get("text") or "",
                company=comp.get("name") or slug,
                company_domain=comp.get("domain") or _company_domain(slug),
                location=loc,
                city=loc,
                country="IL",
                url=j.get("hostedUrl") or j.get("applyUrl") or "",
                description=desc[:6000],
                classify_body=body,
                posted_at=j.get("createdAt"),  # epoch ms -> ISO via _iso
                workplace=_ws(j.get("workplaceType") or ""),
                employment_raw=_ws(cats.get("commitment") or ""),
                experience_raw=_ws(cats.get("team") or ""),
                department=_ws(cats.get("department") or ""),
                keywords_seed=[],
                raw={"slug": slug, "provider": "lever", "categories": cats, "extra": extra},
            ))
        if sleep:
            time.sleep(sleep)
    return out


# --- Ashby ----------------------------------------------------------------- #
def scan_ashby(companies: Iterable[Dict[str, Any]], only_israel: bool = True,
               sleep: float = 0.0) -> List[Dict[str, Any]]:
    """api.ashbyhq.com/posting-api/job-board/{slug} - used by many newer startups."""
    out: List[Dict[str, Any]] = []
    for comp in companies:
        slug = str(comp.get("slug") or "").strip().lower()
        if not slug:
            continue
        status, data = http_json(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
        if status != 200 or not isinstance(data, dict):
            continue
        for j in data.get("jobs") or []:
            loc = j.get("location") or ""
            secondary = ", ".join(_ws(s) for s in (j.get("secondaryLocations") or []) if isinstance(s, str))
            location = _ws(f"{loc} {secondary}".strip())
            if only_israel and not is_israel(location):
                continue
            desc, body = _desc_and_body(j.get("descriptionHtml") or j.get("descriptionPlain") or "")
            out.append(make_job(
                source="ashby",
                external_id=str(j.get("id") or stable_id("ashby", slug + (j.get("title") or ""))),
                title=j.get("title") or "",
                company=comp.get("name") or slug,
                company_domain=comp.get("domain") or _company_domain(slug),
                location=location,
                city=loc,
                country="IL",
                url=j.get("jobUrl") or j.get("applyUrl") or "",
                description=desc[:6000],
                classify_body=body,
                posted_at=j.get("publishedAt"),
                workplace=_ws(j.get("workplaceType") or ""),
                employment_raw=_ws(j.get("employmentType") or ""),
                department=_ws(j.get("department") or j.get("team") or ""),
                keywords_seed=[],
                raw={"slug": slug, "provider": "ashby", "team": j.get("team"),
                     "isRemote": j.get("isRemote"), "secondary": secondary},
            ))
        if sleep:
            time.sleep(sleep)
    return out


# --- Workable -------------------------------------------------------------- #
def scan_workable(companies: Iterable[Dict[str, Any]], only_israel: bool = True,
                  sleep: float = 0.0) -> List[Dict[str, Any]]:
    """apply.workable.com/api/v1/widget/accounts/{slug}?details=true"""
    out: List[Dict[str, Any]] = []
    for comp in companies:
        slug = str(comp.get("slug") or "").strip().lower()
        if not slug:
            continue
        status, data = http_json(
            f"https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true")
        if status != 200 or not isinstance(data, dict):
            continue
        for j in data.get("jobs") or []:
            loc = _ws(j.get("location") or "")
            if only_israel and not is_israel(loc):
                continue
            desc, body = _desc_and_body(j.get("description") or "")
            out.append(make_job(
                source="workable",
                external_id=str(j.get("id") or stable_id("wrk", slug + (j.get("title") or ""))),
                title=j.get("title") or "",
                company=_ws(j.get("company") or comp.get("name") or slug),
                company_domain=comp.get("domain") or _company_domain(slug),
                location=loc,
                city=loc,
                country="IL",
                url=j.get("url") or j.get("application_url") or "",
                description=desc[:6000],
                classify_body=body,
                posted_at=j.get("published") or j.get("created_at") or j.get("date"),
                workplace=_ws(j.get("workplace") or ""),
                employment_raw=_ws(j.get("employment_type") or ""),
                department=_ws(j.get("department") or ""),
                keywords_seed=[],
                raw={"slug": slug, "provider": "workable",
                     "requirements": _ws(str(j.get("requirements") or ""))[:400]},
            ))
        if sleep:
            time.sleep(sleep)
    return out


# --- SmartRecruiters ------------------------------------------------------- #
def scan_smartrecruiters(companies: Iterable[Dict[str, Any]], only_israel: bool = True,
                         sleep: float = 0.0) -> List[Dict[str, Any]]:
    """api.smartrecruiters.com/v1/companies/{slug}/postings.

    Note: this API returns HTTP 200 with totalFound=0 for unknown companies
    (no 404), so an "ok" status alone means nothing - we require content.
    """
    out: List[Dict[str, Any]] = []
    for comp in companies:
        slug = str(comp.get("slug") or "").strip().lower()
        if not slug:
            continue
        status, data = http_json(
            f"https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100")
        if status != 200 or not isinstance(data, dict):
            continue
        for j in data.get("content") or []:
            loc = (j.get("location") or {})
            country = _ws(loc.get("country") or "")
            if only_israel and not is_israel(f"{country} {loc.get('city','')}"):
                continue
            cats = j.get("categories") or {}
            desc, body = _desc_and_body(j.get("description") or "")
            out.append(make_job(
                source="smartrecruiters",
                external_id=str(j.get("id") or stable_id("sr", slug + (j.get("name") or ""))),
                title=j.get("name") or "",
                company=_ws(j.get("companyName") or comp.get("name") or slug),
                company_domain=comp.get("domain") or _company_domain(slug),
                location=_ws(f"{loc.get('city','')} {country}".strip()),
                city=_ws(loc.get("city") or ""),
                country=country or "IL",
                url=j.get("ref") or j.get("absolute_url") or "",
                description=desc[:6000],
                classify_body=body,
                posted_at=j.get("releasedDate") or j.get("createdDate"),
                department=_ws(cats.get("department") or ""),
                experience_raw=_ws(cats.get("experienceLevel") or ""),
                keywords_seed=[],
                raw={"slug": slug, "provider": "smartrecruiters", "categories": cats},
            ))
        if sleep:
            time.sleep(sleep)
    return out


# --- orchestration --------------------------------------------------------- #
_SCANNERS = {
    "greenhouse": scan_greenhouse,
    "lever": scan_lever,
    "ashby": scan_ashby,
    "workable": scan_workable,
    "smartrecruiters": scan_smartrecruiters,
}


def load_ats_companies(overrides: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    companies: List[Dict[str, Any]] = []
    try:
        data = json.loads(ATS_CONFIG.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            for entry in data.get("companies") or []:
                if isinstance(entry, dict):
                    companies.append(entry)
    except (OSError, ValueError):
        companies = [dict(c) for c in DEFAULT_ATS_COMPANIES]
    if overrides:
        # Explicit CLI company wins: --ats-company "wiz:wiz,cloudinary:cloudinary"
        picked = [c for c in overrides.get("ats_company", []) if isinstance(c, dict)]
        if picked:
            companies = picked
    return [c for c in companies if c.get("slug")]


def scan_ats(
    providers: Optional[List[str]] = None,
    companies: Optional[List[Dict[str, Any]]] = None,
    only_israel: bool = True,
    max_workers: int = 6,
) -> List[Dict[str, Any]]:
    """Run the requested ATS providers across `companies`, in parallel.

    Returns normalized rows from every provider; a provider that errors is
    dropped so one bad board cannot fail the scan.
    """
    providers = [p for p in (providers or ATS_PROVIDERS) if p in _SCANNERS]
    companies = companies if companies is not None else load_ats_companies()
    if not providers or not companies:
        return []

    def run(provider: str) -> Tuple[str, List[Dict[str, Any]]]:
        try:
            return provider, _SCANNERS[provider](companies, only_israel=only_israel)
        except Exception:  # noqa: BLE001 - one board must not kill the scan
            return provider, []

    jobs: List[Dict[str, Any]] = []
    with futures.ThreadPoolExecutor(max_workers=max(1, max_workers)) as ex:
        for provider, rows in ex.map(run, providers):
            jobs.extend(rows)
    return jobs


def probe(slug: str, providers: Optional[List[str]] = None) -> Dict[str, Any]:
    """Which ATS (if any) a company uses, and how many jobs it has live."""
    slug = str(slug or "").strip().lower()
    providers = providers or list(ATS_PROVIDERS)
    found: Dict[str, Any] = {}
    for p in providers:
        scanner = _SCANNERS.get(p)
        if not scanner:
            continue
        try:
            rows = scanner([{"name": slug, "slug": slug}], only_israel=False)
            found[p] = {"total": len(rows), "devops": sum(1 for r in rows if r.get("is_devops"))}
        except Exception:
            found[p] = {"total": 0, "devops": 0}
    return {"slug": slug, "providers": {k: v for k, v in found.items() if v["total"] > 0}}