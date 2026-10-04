#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
source .venv/bin/activate
python -c "
import asyncio
from jobs_intel.runners.daily_scan import run_daily_scan
async def main(): r=await run_daily_scan(); print(r)
asyncio.run(main())
"
