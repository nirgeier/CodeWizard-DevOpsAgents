"""Small helpers shared by the engine modules."""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

_NS = uuid.UUID("c0de1a2d-0000-4000-8000-000000000001")


def sha16(*parts: Any) -> str:
    raw = "|".join(str(p) for p in parts if p is not None)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def stable_id(kind: str, key: Any) -> str:
    """Deterministic UUID so re-runs update the same row instead of duplicating."""
    return str(uuid.uuid5(_NS, f"codewizard:{kind}:{key}"))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def age_days(value: Any) -> Optional[float]:
    dt = parse_dt(value)
    if not dt:
        return None
    return (datetime.now(timezone.utc) - dt).total_seconds() / 86400.0


def clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def domain_of_email(email: Optional[str]) -> Optional[str]:
    if not email or "@" not in email:
        return None
    dom = email.split("@", 1)[1].strip().lower().strip(".")
    if not dom or dom in {"gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "walla.co.il"}:
        return None
    return dom


def first(seq, default=None):
    for item in seq or []:
        if item:
            return item
    return default


def company_name(value: Any) -> str:
    """Normalise a company field that may be a string or a {name, source} object."""
    if isinstance(value, dict):
        value = value.get("name") or value.get("company") or ""
    return " ".join(str(value or "").split()).strip()
