"""Turn raw sources into normalised, deduplicated `signals` rows.

A signal is one observable fact with evidence: a job posting, a group message
with intent, or a news headline. Every signal carries `hash` (dedupe key),
`url` (evidence) and `occurred_at` (recency -> "why now").
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

from .util import sha16, domain_of_email, first, clamp, stable_id, parse_dt, company_name

KNOWN_STACK = {
    "aws", "azure", "gcp", "kubernetes", "k8s", "docker", "terraform", "ansible",
    "jenkins", "gitlab", "github", "linux", "vmware", "openshift", "prometheus",
    "grafana", "python", "bash", "ci/cd", "argocd", "helm", "on-prem", "sre",
}


def _clean(text: Any, limit: int = 400) -> str:
    if not text:
        return ""
    out = " ".join(str(text).split())
    return out[:limit]


def _links(contact: Any) -> List[str]:
    links: List[str] = []
    if isinstance(contact, dict):
        links += [str(x) for x in (contact.get("links") or [])]
        links += [str(x) for x in (contact.get("handles") or [])]
    elif isinstance(contact, list):
        links += [str(x) for x in contact if isinstance(x, str) and str(x).startswith("http")]
        for x in contact:
            if isinstance(x, str) and not x.startswith("http") and "@" in x:
                pass
    return [l for l in links if l.startswith("http")]


def _emails(contact: Any) -> List[str]:
    out: List[str] = []
    if isinstance(contact, dict):
        out += [str(x) for x in (contact.get("emails") or []) if x]
    elif isinstance(contact, list):
        out += [str(x) for x in contact if isinstance(x, str) and "@" in x and not x.startswith("http")]
    return [e.strip().lower() for e in out if "@" in e]


def signal_row(**kw: Any) -> Dict[str, Any]:
    sig = {
        "source": kw.get("source") or "unknown",
        "type": kw.get("type") or "other",
        "company_name": kw.get("company_name") or None,
        "domain": kw.get("domain") or None,
        "person_name": kw.get("person_name") or None,
        "title": kw.get("title") or None,
        "url": kw.get("url") or None,
        "headline": kw.get("headline") or None,
        "summary": kw.get("summary") or None,
        "content": kw.get("content") or None,
        "occurred_at": (parse_dt(kw.get("occurred_at")).isoformat() if parse_dt(kw.get("occurred_at")) else None),
        "confidence": float(kw.get("confidence", 0.6)),
        "relevance": float(kw.get("relevance", 0.5)),
        "tags": list({t for t in (kw.get("tags") or []) if t}),
        "location": kw.get("location") or None,
        "country": kw.get("country") or None,
        "implication": kw.get("implication") or None,
        "intent": kw.get("intent") or None,
        "topics": list({t for t in (kw.get("topics") or []) if t}),
        "hash": kw.get("hash") or None,
        "raw": kw.get("raw"),
    }
    sig["id"] = stable_id("signal", sig["hash"] or sha16(sig.get("source"), sig.get("title"), sig.get("occurred_at")))
    return sig


def from_leads(leads: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for lead in leads:
        company = _clean(lead.get("company"), 120)
        if not company:
            continue
        contacts = lead.get("contact") or []
        emails = _emails(contacts)
        links = _links(contacts)
        domain = None
        for e in emails:
            domain = domain_of_email(e)
            if domain:
                break
        groups = lead.get("groups") or []
        score = float(lead.get("score") or 0)
        for role in lead.get("roles") or []:
            title = _clean(role.get("title"), 160)
            stack = [str(s).lower() for s in (role.get("stack") or [])]
            posted = role.get("postedAt")
            h = sha16("lead", company, title, posted, role.get("source"), role.get("seniority"))
            out.append(signal_row(
                source="whatsapp-group",
                type="hiring",
                company_name=company,
                domain=domain,
                title=title,
                url=first(links),
                headline=title,
                summary=f"{company} is hiring: {title}" + (f" [{', '.join(stack)}]" if stack else ""),
                occurred_at=posted,
                confidence=0.72,
                relevance=clamp(score / 60.0),
                tags=stack + [role.get("seniority") or "", role.get("source") or "", "devops-hiring"],
                location=first(role.get("cities") or []) if isinstance(role.get("cities"), list) else role.get("city"),
                implication="Open DevOps/IT role -> capacity or skills gap",
                intent="hiring",
                topics=["devops", "hiring"],
                hash=h,
                raw=role,
            ))
        # group-level context signal (kept, low relevance)
        if groups:
            h = sha16("lead-groups", company, ",".join(groups), lead.get("lastPostAt"))
            out.append(signal_row(
                source="whatsapp-group", type="hiring", company_name=company, domain=domain,
                title=f"{company}: {len(lead.get('roles') or [])} open role(s)",
                url=first(links), headline=f"{company} active in {', '.join(groups)}",
                summary=f"Seen hiring across {', '.join(groups)}", occurred_at=lead.get("lastPostAt"),
                confidence=0.6, relevance=clamp(score / 60.0), tags=["devops-hiring", "named-company"],
                intent="hiring", hash=h, raw={"groups": groups},
            ))
    return out


def from_jobs(jobs: Iterable[Dict[str, Any]], known_companies: Iterable[str]) -> List[Dict[str, Any]]:
    known = {str(c).strip().lower() for c in known_companies if c}
    out: List[Dict[str, Any]] = []
    for job in jobs:
        company = _clean(company_name(job.get("company")), 120)
        if company and company.lower() in known:
            continue  # already covered by the richer lead-level signal
        title = _clean(job.get("title"), 160)
        if not title:
            continue
        stack = [str(s).lower() for s in (job.get("stack") or [])]
        source = job.get("source") or {}
        posted = job.get("postedAt")
        h = sha16("job", company, title, posted, source.get("messageId"))
        out.append(signal_row(
            source="whatsapp-group",
            type="hiring",
            company_name=company or None,
            title=title,
            url=job.get("jobBoard") or first(_links(job.get("contact"))),
            headline=title,
            summary=_clean(job.get("raw"), 400) or f"{title} ({job.get('seniority')})",
            content=_clean(job.get("raw"), 2000),
            occurred_at=posted,
            confidence=0.6,
            relevance=0.55 if job.get("seniority") in ("senior", "lead", "head") else 0.45,
            tags=stack + [job.get("seniority") or "", source.get("groupKind") or "", "whatsapp-demand"],
            location=first(job.get("cities") or []),
            implication="Market demand for DevOps/Cloud skills",
            intent="hiring",
            topics=["devops", "hiring", "market-demand"],
            hash=h,
            raw={"title": title, "seniority": job.get("seniority"), "group": source.get("group")},
        ))
    return out


def from_news(items: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for it in items:
        h = it.get("hash") or sha16(it.get("source"), it.get("headline"), it.get("url"))
        out.append(signal_row(
            source=it.get("source") or "news",
            type="news",
            headline=_clean(it.get("headline"), 300),
            title=_clean(it.get("headline"), 200),
            summary=_clean(it.get("summary"), 400),
            url=it.get("url"),
            occurred_at=it.get("occurred_at"),
            confidence=0.55,
            relevance=0.5,
            tags=["news", "market"],
            intent="market",
            topics=["market"],
            hash=h,
            raw=it,
        ))
    return out


def dedupe(signals: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: Dict[str, Dict[str, Any]] = {}
    for s in signals:
        key = s.get("hash") or s.get("id")
        if key in seen:
            # prefer the signal with a URL / lower (more specific) confidence
            if not seen[key].get("url") and s.get("url"):
                seen[key] = s
            continue
        seen[key] = s
    return list(seen.values())
