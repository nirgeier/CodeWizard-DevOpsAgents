import asyncio
from jobs_intel.runners.daily_scan import run_daily_scan

async def main():
    r = await run_daily_scan(mode="test")
    print(r)

if __name__ == "__main__":
    asyncio.run(main())
