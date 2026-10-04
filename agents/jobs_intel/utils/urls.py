from urllib.parse import urlparse

def domain_of(u):
    if not u: return None
    try:
        return urlparse(u).netloc.replace("www.","")
    except Exception:
        return None
