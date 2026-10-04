"""Aggregate signals into `companies` rows (company intelligence layer).

Two passes:
  1. companies that the scoring pipeline already named (leads.json) - richest.
  2. companies that only appear in raw job posts (jobs.json) - merged in.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List

from .util import domain_of_email, first, stable_id, parse_dt, sha16, company_name

CLOUD = {"aws", "azure", "gcp"}
K8S = {"kubernetes", "k8s", "openshift"}
DEVOPS_STACK = {
    "aws", "azure", "gcp", "kubernetes", "k8s", "docker", "terraform", "ansible",
    "jenkins", "gitlab", "linux", "vmware", "openshift", "prometheus", "grafana",
    "argocd", "helm", "sre", "ci/cd",
}


def _norm(name: Any) -> str:
    return " ".join(str(name or "").split()).strip().lower()


def _company_id(name: str) -> str:
    return stable_id("company", _norm(name))


def _stack_of(role: Dict[str, Any]) -> List[str]:
    return [str(s).lower() for s in (role.get("stack") or []) if s]


def _base_row(name: str, key: str | None = None) -> Dict[str, Any]:
    return {
        "id": _company_id(key or name),
        "name": name,
        "domain": None,
        "website": None,
        "industry": "technology",
        "employees_range": None,
        "employees_est": None,
        "country": "IL",
        "hq_city": None,
        "location": None,
        "linkedin_url": None,
        "tech_stack": [],
        "cloud": [],
        "k8s": False,
        "devops_hiring": False,
        "devops_hiring_count": 0,
        "platform_fit": 0.0,
        "confidence": 0.5,
        "score": 0,
        "service": None,
        "status": "active",
        "tags": [],
        "notes": None,
    }


def from_leads(leads: Iterable[Dict[str, Any]], alias_map: Dict[str, str] | None = None) -> Dict[str, Dict[str, Any]]:
    alias_map = alias_map or {}
    out: Dict[str, Dict[str, Any]] = {}
    for lead in leads:
        name = company_name(lead.get("company"))
        if not name:
            continue
        key = alias_map.get(_norm(name), _norm(name))
        row = out.get(key) or _base_row(name, key)
        contacts = lead.get("contact") or []
        emails = [str(c).lower() for c in contacts if isinstance(c, str) and "@" in c and not c.startswith("http")]
        links = [str(c) for c in contacts if isinstance(c, str) and c.startswith("http")]
        role_stacks: List[str] = []
        seniorities: List[str] = []
        posted: List[Any] = []
        for role in lead.get("roles") or []:
            role_stacks += _stack_of(role)
            if role.get("seniority"):
                seniorities.append(str(role["seniority"]))
            if role.get("postedAt"):
                posted.append(role["postedAt"])
        stack = sorted(set(role_stacks))
        row["tech_stack"] = stack
        row["cloud"] = sorted({s for s in stack if s in CLOUD})
        row["k8s"] = any(s in K8S for s in stack)
        row["devops_hiring"] = True
        row["devops_hiring_count"] = int(lead.get("openRoles") or len(lead.get("roles") or []) or 0)
        row["score"] = int(lead.get("score") or 0)
        row["service"] = lead.get("service")
        row["tags"] = sorted(set(
            (row.get("tags") or [])
            + [g for g in (lead.get("groups") or [])]
            + [s for s in seniorities if s]
            + (["needs-verification"] if lead.get("needsVerification") else [])
            + (["named-company"] if not lead.get("needsVerification") else [])
        ))
        for e in emails:
            d = domain_of_email(e)
            if d:
                row["domain"] = d
                row["website"] = row["website"] or f"https://{d}"
                break
        row["linkedin_url"] = row["linkedin_url"] or first(links)
        if posted:
            _first = min((parse_dt(p) for p in posted if parse_dt(p)), default=None)
            row["first_seen_at"] = _first.isoformat() if _first else None
        _last = parse_dt(lead.get("lastPostAt"))
        row["last_seen_at"] = _last.isoformat() if _last else row.get("last_seen_at")
        reasons = lead.get("reasons") or []
        row["notes"] = "; ".join(str(r.get("label")) for r in reasons if r.get("label")) or None
        out[key] = row
    return out


def from_jobs(jobs: Iterable[Dict[str, Any]], existing: Dict[str, Dict[str, Any]], alias_map: Dict[str, str] | None = None) -> Dict[str, Dict[str, Any]]:
    alias_map = alias_map or {}
    out = dict(existing)
    for job in jobs:
        name = company_name(job.get("company"))
        if not name:
            continue
        key = alias_map.get(_norm(name), _norm(name))
        row = out.get(key)
        if row is None:
            row = _base_row(name, key)
            out[key] = row
        stack = _stack_of(job)
        row["tech_stack"] = sorted(set(row.get("tech_stack") or []) | set(stack))
        row["cloud"] = sorted(set(row.get("cloud") or []) | {s for s in stack if s in CLOUD})
        row["k8s"] = bool(row.get("k8s")) or any(s in K8S for s in stack)
        row["devops_hiring"] = True
        if job.get("company"):
            row["devops_hiring_count"] = int(row.get("devops_hiring_count") or 0) + 1
        if not row.get("domain"):
            for e in (job.get("contact") or {}).get("emails", []) if isinstance(job.get("contact"), dict) else []:
                d = domain_of_email(str(e))
                if d:
                    row["domain"] = d
                    break
        row["last_seen_at"] = job.get("postedAt") or row.get("last_seen_at")
        row["tags"] = sorted(set((row.get("tags") or []) + ["named-company"]))
    return out


def build(leads: Iterable[Dict[str, Any]], jobs: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    leads = list(leads)
    jobs = list(jobs)
    alias_map: Dict[str, str] = {}
    for lead in leads:
        name = company_name(lead.get("company"))
        if not name:
            continue
        key = _norm(name)
        for alias in [name] + list(lead.get("aliases") or []):
            a = _norm(alias)
            if a:
                alias_map[a] = key
    rows = from_leads(leads, alias_map)
    rows = from_jobs(jobs, rows, alias_map)
    return list(rows.values())
