import hashlib
from rapidfuzz import fuzz

def key_text(*parts) -> str:
    s = " | ".join(p.strip().lower() for p in parts if p)
    return hashlib.sha256(s.encode()).hexdigest()[:16]

def similar(a, b, thr=90) -> bool:
    if not a or not b: return False
    return fuzz.token_set_ratio(a, b) >= thr
