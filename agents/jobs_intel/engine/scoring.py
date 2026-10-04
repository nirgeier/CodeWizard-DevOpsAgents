"""Explainable scoring for companies (correlation engine).

Every point of confidence is attributable to a named factor, so the
"WHY NOW" in the opportunity is never hand-waved.
"""
from __future__ import annotations

from typing import Any, Dict, List

from .util import clamp, age_days

CLOUD = {"aws", "azure", "gcp"}
K8S = {"kubernetes", "k8s", "openshift"}
DEVOPS_STACK = {
    "aws", "azure", "gcp", "kubernetes", "k8s", "docker", "terraform", "ansible",
    "jenkins", "gitlab", "linux", "vmware", "openshift", "prometheus", "grafana",
    "argocd", "helm", "sre", "ci/cd",
}
URGENCY = {"פתוח", "דחוף", "urgent", "asap", "immediately", "open", "hiring"}


def _label(signal: str, weight: int, label: str) -> Dict[str, Any]:
    return {"signal": signal, "weight": weight, "label": label}


def score_company(company: Dict[str, Any], signals: List[Dict[str, Any]]) -> Dict[str, Any]:
    reasons: List[Dict[str, Any]] = []
    conf = 0.15

    needs_verification = "needs-verification" in (company.get("tags") or [])
    if not needs_verification and company.get("name"):
        conf += 0.18
        reasons.append(_label("named", 18, "named company actively hiring"))
    elif company.get("domain"):
        conf += 0.10
        reasons.append(_label("domain", 10, "identified company domain"))

    stacks = [s.lower() for s in (company.get("tech_stack") or [])]
    if any(s in DEVOPS_STACK for s in stacks):
        conf += 0.14
        reasons.append(_label("devopsStack", 14, "DevOps/Cloud stack in open roles"))
    if any(s in CLOUD for s in stacks):
        conf += 0.05
        reasons.append(_label("cloud", 5, "cloud platform mentioned"))
    if company.get("k8s"):
        conf += 0.05
        reasons.append(_label("k8s", 5, "Kubernetes in stack"))

    count = int(company.get("devops_hiring_count") or 0)
    if count >= 3:
        conf += 0.16
        reasons.append(_label("hiringVolume", 16, f"{count} open DevOps/IT roles"))
    elif count == 2:
        conf += 0.12
        reasons.append(_label("hiringVolume", 12, "2 open roles at once"))
    elif count == 1:
        conf += 0.06
        reasons.append(_label("hiringVolume", 6, "open role"))

    senior = False
    recent_days = None
    urgent = False
    has_contact = False
    for s in signals:
        if (s.get("title") or "").lower() in ("senior", "lead", "head"):
            senior = True
        tags = [str(t).lower() for t in (s.get("tags") or [])]
        if any(t in ("senior", "lead", "head") for t in tags):
            senior = True
        text = f"{s.get('summary','')} {s.get('title','')} {s.get('content','')}".lower()
        if any(u in text for u in URGENCY):
            urgent = True
        if s.get("person_name") or s.get("contact"):
            has_contact = True
        age = age_days(s.get("occurred_at"))
        if age is not None and (recent_days is None or age < recent_days):
            recent_days = age

    if senior:
        conf += 0.14
        reasons.append(_label("seniorRole", 14, "senior/lead role - real budget"))
    if recent_days is not None and recent_days <= 7:
        conf += 0.14
        reasons.append(_label("recency", 14, f"posted {recent_days:.1f} days ago"))
    elif recent_days is not None and recent_days <= 21:
        conf += 0.06
        reasons.append(_label("recency", 6, f"posted {recent_days:.0f} days ago"))
    if urgent:
        conf += 0.08
        reasons.append(_label("urgency", 8, "urgent / open wording"))
    if has_contact:
        conf += 0.10
        reasons.append(_label("contact", 10, "public hiring contact available"))

    fit = 0.0
    if stacks:
        fit = len([s for s in stacks if s in DEVOPS_STACK]) / len(stacks)
    company["platform_fit"] = round(clamp(fit), 2)
    company["confidence"] = round(clamp(conf, 0.0, 0.97), 2)
    return {"confidence": company["confidence"], "reasons": reasons, "recent_days": recent_days, "urgent": urgent, "senior": senior}
