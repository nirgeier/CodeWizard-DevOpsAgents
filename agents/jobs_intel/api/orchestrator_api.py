from fastapi import FastAPI, Header, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict, Any
from jobs_intel.runners.daily_scan import run_daily_scan
from jobs_intel.config import settings
import structlog

logger = structlog.get_logger()
app = FastAPI(title="Jobs Intel Orchestrator", version="1.0.0")

class ScanReq(BaseModel):
    mode: str = "daily"
    filters: Optional[Dict[str, Any]] = None
    query: Optional[str] = None
    limit: int = 50

async def verify_key(x_api_key: Optional[str] = Header(default=None, alias="x-api-key")):
    if settings.api_key and x_api_key != settings.api_key:
        raise HTTPException(401, "invalid api key")
    return True

@app.get("/health")
async def health():
    return {"ok": True}

@app.post("/scans/daily")
async def scans_daily(req: ScanReq = ScanReq(), _=Depends(verify_key)):
    r = await run_daily_scan(mode=req.mode, filters=req.filters, query=req.query)
    return {"ok": True, **r}

@app.post("/scans/targeted")
async def scans_targeted(req: ScanReq, _=Depends(verify_key)):
    r = await run_daily_scan(mode="targeted", filters=req.filters, query=req.query)
    return {"ok": True, **r}
