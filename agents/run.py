#!/usr/bin/env python3
"""CodeWizard Jobs Intelligence - run the rule-based pipeline.

Usage:
  python3 run.py --json          # run, persist, print a JSON summary (used by the web apps)
  python3 run.py                 # same, human-readable summary
  python3 run.py --no-db         # force the local JSON store (no Supabase writes)
  python3 run.py --mode targeted

Data flow:
  agent/data/{jobs,leads,inbox}.json (+ optional news keys)
    -> signals (whatsapp-group / news)
    -> companies (aggregated, scored)
    -> people (public hiring contacts)
    -> opportunities (WHO / WHAT / WHY NOW / PAIN / CONTEXT / APPROACH / QUESTION)
    -> Supabase (Jobs tables) and/or Jobs/data/*.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def main() -> int:
    ap = argparse.ArgumentParser(description="Run the CodeWizard Jobs-intelligence pipeline")
    ap.add_argument("--mode", default="daily", help="scan mode label (daily|targeted|test|backfill)")
    ap.add_argument("--limit", type=int, default=None, help="cap the number of signals processed")
    ap.add_argument("--no-db", action="store_true", help="force local JSON storage (ignore Supabase)")
    ap.add_argument("--no-persist", action="store_true", help="analyse only, do not write anything")
    ap.add_argument("--no-notify", action="store_true", help="do not post the summary to Discord")
    ap.add_argument("--json", action="store_true", help="print the summary as JSON")
    args = ap.parse_args()

    if args.no_db:
        os.environ["JOBS_LOCAL_ONLY"] = "1"

    # Imported after env is set so the settings singleton picks up the override.
    from jobs_intel.engine.pipeline import run_pipeline

    summary = run_pipeline(mode=args.mode, limit=args.limit, persist=not args.no_persist,
                           notify=not args.no_notify)

    if args.json:
        print(json.dumps(summary, ensure_ascii=False))
    else:
        store = summary.get("store", {})
        print("CodeWizard Jobs Intelligence")
        print(f"  store        : {store.get('mode')} ({store.get('reason')})")
        print(f"  signals      : {summary.get('signals')}")
        print(f"  companies    : {summary.get('companies')}")
        print(f"  people       : {summary.get('people')}")
        print(f"  opportunities: {summary.get('opportunities')} (qualified {summary.get('qualified')})")
        print(f"  min conf     : {summary.get('min_confidence')}")
        print(f"  duration     : {summary.get('duration_ms')} ms")
        if summary.get("saved"):
            print(f"  saved        : {summary['saved']}")
        dc = summary.get("discord") or {}
        if dc.get("sent"):
            print(f"  discord      : sent via {dc.get('transport')} ({dc.get('opportunities', 0)} opportunities)")
        elif dc.get("skipped"):
            print(f"  discord      : skipped - {dc.get('reason')}")
        elif dc.get("error"):
            print(f"  discord      : FAILED - {dc['error']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
