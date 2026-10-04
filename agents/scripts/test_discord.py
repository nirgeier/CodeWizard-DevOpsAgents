#!/usr/bin/env python3
"""Send a test message to Discord to verify the credentials.

  python3 scripts/test_discord.py            # posts a sample card
  python3 scripts/test_discord.py --dry-run  # build + print the payload, send nothing

The credential is read from DISCORD_WEBHOOK_URL or DISCORD_BOT_TOKEN +
DISCORD_CHANNEL_ID (process env, then agents/.env, then web/.env). Nothing
sensitive is printed.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from jobs_intel.engine import discord as discord_mod  # noqa: E402
from jobs_intel.engine.settings import settings  # noqa: E402

SAMPLE_OPPS = [
    {
        "company_name": "דוגמה טכנולוגיות",
        "confidence": 0.87,
        "what_is_happening": "דוגמה טכנולוגיות מגייסת 4 תפקידי Kubernetes, Terraform, CI/CD.",
        "why_now": "פרסום גיוס חדש מהיום · 4 תפקידים פתוחים במקביל.",
        "target_person_name": "דנה כהן",
        "target_title": "Head of DevOps",
        "linkedin_url": "https://www.linkedin.com/in/example",
        "evidence": [{"label": "משרת Kubernetes", "url": "https://example.com/job/1"}],
    },
    {
        "company_name": "סטארטאפ ירוק",
        "confidence": 0.71,
        "what_is_happening": "סטארטאפ ירוק מגייס 2 תפקידי AWS ו-Next.js.",
        "why_now": "הפרסום האחרון לפני 3 ימים · 2 תפקידים פתוחים במקביל.",
        "target_person_name": None,
        "evidence": [],
    },
]

SAMPLE_SUMMARY = {
    "run_id": "00000000-0000-4000-8000-000000000000",
    "signals": 128,
    "companies": 41,
    "people": 63,
    "opportunities": 2,
    "qualified": 2,
    "duration_ms": 1234,
    "store": {"mode": "test"},
}


def main() -> int:
    ap = argparse.ArgumentParser(description="Verify the Discord credentials")
    ap.add_argument("--dry-run", action="store_true", help="print the payload without sending")
    args = ap.parse_args()

    if not discord_mod.configured():
        print("Discord is not configured.\n", file=sys.stderr)
        print("Add one of these to agents/.env (or export it):", file=sys.stderr)
        print("  DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>", file=sys.stderr)
        print("  DISCORD_BOT_TOKEN=<token>  +  DISCORD_CHANNEL_ID=<id>", file=sys.stderr)
        print("\nChannel webhook steps: Discord > Server Settings > Integrations >", file=sys.stderr)
        print("Webhooks > New Webhook > pick a channel > Copy Webhook URL.", file=sys.stderr)
        return 1

    print(f"transport : {discord_mod._transport()}")
    print(f"threshold : {settings.discord_min_confidence or settings.min_confidence}")

    if args.dry_run:
        embeds = [
            discord_mod._summary_embed(SAMPLE_SUMMARY, 2, 2),
            *[discord_mod._opportunity_embed(o) for o in SAMPLE_OPPS],
        ]
        print(json.dumps({"embeds": embeds}, ensure_ascii=False, indent=2))
        return 0

    result = discord_mod.notify_scan(SAMPLE_SUMMARY, SAMPLE_OPPS)
    if result.get("sent"):
        print(f"OK - message sent via {result.get('transport')} (id={result.get('message_id')})")
        return 0
    print(f"FAILED - {result.get('error') or result.get('reason')}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())