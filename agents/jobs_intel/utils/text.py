def clamp(s, n=240):
    if not s: return ""
    return s if len(s)<=n else s[:n]+"..."
