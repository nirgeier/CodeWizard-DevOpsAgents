"""People intelligence: contacts attached to hiring companies.

We only ever surface people who are already public in the job posts (recruiter
emails / application links) - no scraping, no invented contact details.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List

from .util import domain_of_email, stable_id, clamp, company_name


def _norm_name(name: Any) -> str:
    return " ".join(str(name or "").split()).strip()


def _person_from_email(email: str, company: str, service: str, relevance: float, link: str | None) -> Dict[str, Any]:
    email = email.strip().lower()
    local = email.split("@", 1)[0]
    pretty = local.replace(".", " ").replace("_", " ").strip()
    full = pretty.title() if pretty else f"Recruiter @ {company}"
    return {
        "id": stable_id("person", f"email:{email}"),
        "full_name": full,
        "title": "Recruiter / Hiring contact",
        "persona": "recruiter",
        "seniority": "mid",
        "company_name": company or None,
        "domain": domain_of_email(email),
        "email": email,
        "phone": None,
        "linkedin_url": link,
        "location": None,
        "country": "IL",
        "city": None,
        "background_excerpt": f"Hiring contact for {company}" if company else "Hiring contact",
        "decision_power": 0.55,
        "relevance": clamp(relevance),
        "confidence": 0.7,
        "source": "whatsapp-job-post",
        "tags": ["recruiter"] + ([service] if service else []),
    }


def build(companies: Iterable[Dict[str, Any]], leads: Iterable[Dict[str, Any]], jobs: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_name = {_norm_name(c.get("name")).lower(): c for c in companies if c.get("name")}
    out: Dict[str, Dict[str, Any]] = {}

    # 1) leads carry the cleanest contacts
    for lead in leads:
        company = company_name(lead.get("company"))
        comp = by_name.get(company.lower())
        relevance = clamp((float(comp.get("score") or lead.get("score") or 0)) / 60.0) if comp else 0.5
        service = lead.get("service")
        contacts = lead.get("contact") or []
        link = next((str(c) for c in contacts if isinstance(c, str) and c.startswith("http")), None)
        for c in contacts:
            if isinstance(c, str) and "@" in c and not c.startswith("http"):
                p = _person_from_email(c, company, service, relevance, link)
                out[p["id"]] = p

    # 2) raw job posts add emails for companies not covered by leads
    for job in jobs:
        company = company_name(job.get("company"))
        if not company:
            continue
        comp = by_name.get(company.lower())
        relevance = clamp((float(comp.get("score") or 0)) / 60.0) if comp else 0.4
        contact = job.get("contact") if isinstance(job.get("contact"), dict) else {}
        emails = [str(e) for e in (contact.get("emails") or []) if e]
        links = [str(l) for l in (contact.get("links") or []) if str(l).startswith("http")]
        for c in emails:
            if "@" in c:
                p = _person_from_email(c, company, (comp or {}).get("service"), relevance, next(iter(links), None))
                out.setdefault(p["id"], p)

    return list(out.values())
