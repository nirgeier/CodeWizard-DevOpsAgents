"""Opportunity Orchestrator.

Fuses a company + its people + its signals into an explainable opportunity with
the WHO / WHAT / WHY NOW / PAIN / CONTEXT / APPROACH / QUESTION contract. An
opportunity is only emitted when the "why now" can be evidenced (dated signal)
and the confidence clears the threshold - otherwise it is dropped.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .util import clamp, sha16, stable_id, first
from .settings import settings

SERVICE_PLAYBOOK = {
    "devops-consulting": {
        "approach": "להציע אבחון DevOps/ענן קצר (2-3 ימים) ואחריו ליווי/הטמעה - להתחבר לכשל הגיוס או לפער התפעול.",
        "pain": "פער יכולות DevOps/ענן, עומס תפעולי, וקושי לגייס בזמן - אולי כדאי לחזק את הצוות הקיים.",
        "service": "devops-consulting",
    },
    "devops-training": {
        "approach": "להציע מסלול הכשרה ממוקד לצוות (Kubernetes/CI-CD/Terraform) שיסגור את פער הידע ויפחית תלות בגיוס.",
        "pain": "הצוות הקיים צריך להתחזק ב-Kubernetes/CI-CD/Terraform - הכשרה מהירה עשויה להיות יעילה יותר מגיוס.",
        "service": "devops-training",
    },
    "devops-placement": {
        "approach": "להציע סורסינג/השמה של אנשי DevOps מנוסים ולקצר את זמן הגיוס.",
        "pain": "קושי למצוא ולגייס אנשי DevOps בזמן - אפשר לעזור בסורסינג ממוקד.",
        "service": "devops-placement",
    },
}


def _service_playbook(company: Dict[str, Any]) -> Dict[str, str]:
    key = company.get("service") or "devops-consulting"
    return SERVICE_PLAYBOOK.get(key, SERVICE_PLAYBOOK["devops-consulting"])


def _pick_target(people: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not people:
        return None
    return sorted(people, key=lambda p: -(float(p.get("relevance") or 0)))[0]


def build(
    companies: List[Dict[str, Any]],
    signals_by_company: Dict[str, List[Dict[str, Any]]],
    people_by_company: Dict[str, List[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for company in companies:
        name = company.get("name")
        if not name:
            continue
        key = name.lower()
        sigs = signals_by_company.get(key) or []
        if not sigs:
            continue
        confidence = float(company.get("confidence") or 0)
        if confidence < settings.min_confidence:
            continue

        # WHY NOW must be evidenced: need at least one dated signal.
        dated = [s for s in sigs if s.get("occurred_at")]
        if settings.require_why_now and not dated:
            continue
        if settings.require_evidence and not any(s.get("url") for s in sigs):
            # No URL anywhere - only allow when it is a named company with a contact.
            if "needs-verification" in (company.get("tags") or []):
                continue

        people = people_by_company.get(key) or []
        target = _pick_target(people)
        playbook = _service_playbook(company)

        stacks = [s for s in (company.get("tech_stack") or [])][:6]
        stack_txt = ", ".join(stacks) if stacks else "DevOps/IT"
        count = int(company.get("devops_hiring_count") or len(sigs) or 1)
        groups = ", ".join([t for t in (company.get("tags") or []) if "משרות" in str(t)]) or None
        recent = None
        for s in sorted(dated, key=lambda x: x.get("occurred_at") or "", reverse=True):
            recent = s
            break
        domains = sorted({s.get("domain") for s in sigs if s.get("domain")})
        domain = company.get("domain") or first(domains)

        who = name
        if target:
            who = f"{target.get('full_name')} ({target.get('title') or 'איש קשר לגיוס'}) ב-{name}"

        what = f"{name} מגייסת {count} תפקידי {stack_txt}."
        why_now = _why_now(name, count, stack_txt, dated, company)
        pain = playbook["pain"]
        context = _context(company, groups, target, domain)
        approach = playbook["approach"]
        question = _question(name, stack_txt, target, company)

        evid: List[Dict[str, Any]] = []
        for s in sigs:
            if s.get("url") and len(evid) < 6:
                evid.append({
                    "label": (s.get("headline") or s.get("title") or "מקור"),
                    "url": s.get("url"),
                    "source": s.get("source"),
                    "quote": (s.get("summary") or "")[:240],
                })
        sig_refs = [{
            "type": s.get("type"),
            "headline": s.get("headline") or s.get("title"),
            "source": s.get("source"),
            "url": s.get("url"),
            "occurred_at": s.get("occurred_at"),
            "company_name": s.get("company_name"),
        } for s in sigs[:10]]

        dedupe_key = sha16("opportunity", name.lower())
        priority = int(round(confidence * 100))
        row = {
            "id": stable_id("opportunity", dedupe_key),
            "dedupe_key": dedupe_key,
            "company_name": name,
            "domain": domain,
            "target_person_name": target.get("full_name") if target else None,
            "target_title": target.get("title") if target else None,
            "persona": (target.get("persona") if target else "recruiter"),
            "linkedin_url": (target or {}).get("linkedin_url"),
            "location": company.get("location") or company.get("hq_city"),
            "country": company.get("country") or "IL",
            "employees": company.get("employees_range"),
            "what_is_happening": what,
            "why_now": why_now,
            "potential_pain": pain,
            "context": context,
            "recommended_approach": approach,
            "opening_question": question,
            "confidence": round(confidence, 2),
            "status": "review",
            "outreach_status": "pending",
            "priority": priority,
            "tags": sorted(set((company.get("tags") or []) + ([playbook["service"]] if playbook.get("service") else []))),
            "signals": sig_refs,
            "evidence": evid,
        }
        out.append(row)

    out.sort(key=lambda o: -float(o.get("confidence") or 0))
    return out


def _why_now(name: str, count: int, stack_txt: str, dated: List[Dict[str, Any]], company: Dict[str, Any]) -> str:
    from .util import age_days

    newest = None
    for s in dated:
        a = age_days(s.get("occurred_at"))
        if a is not None and (newest is None or a < newest):
            newest = a
    parts: List[str] = []
    if newest is not None:
        if newest < 1:
            parts.append("פרסום גיוס חדש מהיום")
        else:
            parts.append(f"הפרסום האחרון לפני {newest:.0f} ימים")
    parts.append(f"{count} תפקידי {stack_txt} פתוחים במקביל")
    if company.get("k8s"):
        parts.append("Kubernetes מוזכר במשרות")
    if "needs-verification" not in (company.get("tags") or []):
        parts.append("חברה מזוהה ומגייסת באופן פעיל")
    return " · ".join(parts) + "."


def _context(company: Dict[str, Any], groups: Optional[str], target: Optional[Dict[str, Any]], domain: Optional[str]) -> str:
    bits: List[str] = []
    if domain:
        bits.append(f"דומיין: {domain}")
    if groups:
        bits.append(f"מקור: קבוצות {groups}")
    if target:
        bits.append(f"איש קשר: {target.get('full_name')} ({target.get('email') or target.get('linkedin_url') or 'ללא פרטי קשר ישירים'})")
    if "needs-verification" in (company.get("tags") or []):
        bits.append("שם החברה דורש אימות")
    if company.get("notes"):
        bits.append(f"אותות: {company.get('notes')}")
    return ". ".join(bits) + "." if bits else "חברה מגייסת DevOps/IT מהשוק הישראלי."


def _question(name: str, stack_txt: str, target: Optional[Dict[str, Any]], company: Dict[str, Any]) -> str:
    if company.get("k8s"):
        return f"ראיתי שאתם מגייסים כמה תפקידי {stack_txt} ב-{name} - האם הצוות כבר עובד עם Kubernetes בפרודקשן, או שזה חלק מהאתגר?"
    return f"ראיתי ש-{name} מגייסת תפקידי {stack_txt} - האם הקושי הוא בעומס תפעולי או בפער ידע בצוות הקיים?"
