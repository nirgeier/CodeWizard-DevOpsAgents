"""Discord notifications for scan results.

Two supported transports, picked automatically:

  1. webhook  - DISCORD_WEBHOOK_URL. Posting only, no bot, no intents. Preferred.
  2. bot      - DISCORD_BOT_TOKEN + DISCORD_CHANNEL_ID. Needs the bot to share
                the channel and the Send Messages permission.

Stdlib only (urllib), matching store.py: every entry point returns a status
dict and never raises, so a Discord outage can never fail a scan. Secrets are
redacted out of error strings before they are returned or logged.

Delivery is fire-and-forget by design. Do not make the pipeline wait on it.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from .settings import settings

API = "https://discord.com/api/v10"

# Discord hard-caps a message at 10 embeds and 6000 characters of text.
MAX_EMBEDS_PER_MESSAGE = 10
MAX_EMBED_DESCRIPTION = 4096

# Confidence 0..1 -> a green/amber/red accent colour.
COLOR_HIGH = 0x2ECC71
COLOR_MED = 0xF1C40F
COLOR_LOW = 0x95A5A6


def _redact(text: str) -> str:
    """Strip credentials out of anything we return or print."""
    if not text:
        return ""
    for secret in (settings.discord_webhook_url, settings.discord_bot_token):
        if secret:
            text = text.replace(secret, "***")
    return text


def _clip(text: Any, limit: int = MAX_EMBED_DESCRIPTION) -> str:
    value = " ".join(str(text or "").split())
    if len(value) <= limit:
        return value
    return value[: limit - 1].rstrip() + "…"


def _conf_color(confidence: float) -> int:
    if confidence >= 0.8:
        return COLOR_HIGH
    if confidence >= 0.65:
        return COLOR_MED
    return COLOR_LOW


def _post(url: str, headers: Dict[str, str], body: Dict[str, Any]) -> Dict[str, Any]:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8", "replace")
            return {"ok": True, "status": resp.status, "body": raw or None}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        # 404 on a webhook is almost always a deleted webhook; 429 is rate limit.
        hint = {
            401: "bad token / webhook revoked",
            403: "bot lacks Send Messages in this channel",
            404: "webhook or channel not found (deleted?)",
            429: "rate limited",
        }.get(e.code, "")
        return {"ok": False, "status": e.code, "error": _redact(f"HTTP {e.code} {hint} {raw[:200]}")}
    except Exception as e:  # network error, DNS, timeout
        return {"ok": False, "status": 0, "error": _redact(f"{type(e).__name__}: {e}")}


def _send(payload: Dict[str, Any]) -> Dict[str, Any]:
    """POST one message via whichever transport is configured."""
    # Discord sits behind Cloudflare, which rejects the default
    # "Python-urllib/3.x" agent with error code 1010 - always send our own.
    headers = {
        "Content-Type": "application/json",
        "User-Agent": settings.user_agent or "CodeWizard-JobsIntel/1.0",
    }

    if settings.discord_webhook_url:
        url = settings.discord_webhook_url
        # wait=true makes Discord return the created message, so we can link it.
        sep = "&" if "?" in url else "?"
        return _post(f"{url}{sep}wait=true", headers, payload)

    if settings.discord_bot_token and settings.discord_channel_id:
        return _post(
            f"{API}/channels/{settings.discord_channel_id}/messages",
            {**headers, "Authorization": f"Bot {settings.discord_bot_token}"},
            payload,
        )

    return {"ok": False, "status": 0, "error": "no discord transport configured"}


def configured() -> bool:
    if not settings.discord_enabled:
        return False
    return bool(settings.discord_webhook_url) or bool(
        settings.discord_bot_token and settings.discord_channel_id
    )


def _transport() -> str:
    if settings.discord_webhook_url:
        return "webhook"
    if settings.discord_bot_token and settings.discord_channel_id:
        return "bot"
    return "none"


def _summary_embed(summary: Dict[str, Any], shown: int, total: int) -> Dict[str, Any]:
    store = summary.get("store") or {}
    fields = [
        {"name": "חברות", "value": str(summary.get("companies", 0)), "inline": True},
        {"name": "אותות", "value": str(summary.get("signals", 0)), "inline": True},
        {"name": "אנשי קשר", "value": str(summary.get("people", 0)), "inline": True},
        {"name": "הזדמנויות", "value": f"{total} (מעל הסף: {shown})", "inline": True},
        {"name": "אחסון", "value": str(store.get("mode") or "-"), "inline": True},
        {"name": "משך", "value": f"{summary.get('duration_ms', 0)} ms", "inline": True},
    ]
    return {
        "title": "סריקת מכירות CodeWizard הושלמה",
        "color": COLOR_MED if total else COLOR_LOW,
        "fields": fields,
        "footer": {"text": f"run {str(summary.get('run_id') or '')[:8]}"},
    }


def _opportunity_embed(opp: Dict[str, Any]) -> Dict[str, Any]:
    confidence = float(opp.get("confidence") or 0)
    name = opp.get("company_name") or "לא ידוע"
    title = f"{name} - ביטחון {confidence:.0%}"

    lines = []
    if opp.get("what_is_happening"):
        lines.append(f"**מה קורה:** {_clip(opp['what_is_happening'], 300)}")
    if opp.get("why_now"):
        lines.append(f"**למה עכשיו:** {_clip(opp['why_now'], 300)}")
    who = opp.get("target_person_name")
    if who:
        role = opp.get("target_title")
        lines.append(f"**איש קשר:** {who}{f' ({role})' if role else ''}")

    evidence = [e for e in (opp.get("evidence") or []) if e.get("url")][:3]
    if evidence:
        links = " · ".join(f"[{_clip(e.get('label') or 'מקור', 40)}]({e['url']})" for e in evidence)
        lines.append(f"**מקורות:** {links}")

    embed: Dict[str, Any] = {
        "title": title,
        "description": "\n".join(lines) or "ללא פרטים",
        "color": _conf_color(confidence),
    }
    if opp.get("linkedin_url"):
        embed["url"] = opp["linkedin_url"]
    return embed


def _select(opportunities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    threshold = settings.discord_min_confidence or settings.min_confidence
    picked = [o for o in opportunities if float(o.get("confidence") or 0) >= threshold]
    picked.sort(key=lambda o: -float(o.get("confidence") or 0))
    return picked[: settings.discord_max_opportunities]


def notify_scan(summary: Dict[str, Any], opportunities: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Post a scan summary plus the top opportunities to Discord.

    Returns {"sent": bool, ...}. Never raises - callers can ignore the result,
    but the pipeline logs it so a silently failing webhook is still visible.
    """
    if not configured():
        return {"sent": False, "skipped": True, "reason": "discord not configured"}

    hot = _select(opportunities or [])
    if not hot and not settings.discord_notify_on_empty:
        return {"sent": False, "skipped": True, "reason": "nothing above threshold"}

    embeds = [_summary_embed(summary, len(hot), len(opportunities or []))]
    embeds.extend(_opportunity_embed(o) for o in hot)

    result: Dict[str, Any] = {"sent": False, "transport": _transport(), "opportunities": len(hot)}
    # 10 embeds max per message; the summary always goes in the first one.
    for i in range(0, len(embeds), MAX_EMBEDS_PER_MESSAGE):
        chunk = embeds[i : i + MAX_EMBEDS_PER_MESSAGE]
        res = _send({"content": "" if i == 0 else "…", "embeds": chunk})
        if not res.get("ok"):
            return {**result, "sent": False, "error": res.get("error") or res.get("status")}
        result["sent"] = True
        if i == 0:
            body = res.get("body")
            try:
                parsed = json.loads(body) if isinstance(body, str) else None
                if isinstance(parsed, dict) and parsed.get("id"):
                    result["message_id"] = parsed["id"]
            except ValueError:
                pass
    return result