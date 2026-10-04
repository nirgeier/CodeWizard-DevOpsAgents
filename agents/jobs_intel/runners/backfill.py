from jobs_intel.runners.daily_scan import run_daily_scan

async def run_backfill(days: int=30):
    return await run_daily_scan(mode="backfill", filters={"since_days": days})
