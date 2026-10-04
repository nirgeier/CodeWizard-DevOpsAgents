import uuid
from datetime import datetime
from jobs_intel.graphs.daily_scan_graph import daily_graph
from jobs_intel.state import AgentState
from jobs_intel.tools.supabase_client import get_sb
import structlog

logger = structlog.get_logger()

async def run_daily_scan(mode: str="daily", filters=None, query=None) -> dict:
    run_id = str(uuid.uuid4())
    state: AgentState = {"run_id": run_id,"mode": mode,"filters": filters or {},"query": query,"started_at": datetime.utcnow(),"errors": []}
    sb = get_sb()
    try:
        sb.table("scans").insert({"id": run_id,"mode": mode,"status": "running","started_at": datetime.utcnow().isoformat()+"Z"}).execute()
    except Exception:
        pass
    try:
        res = daily_graph.invoke(state)
    except Exception as e:
        logger.error("scan.fail", err=str(e))
        try:
            sb.table("scans").update({"status": "failed","finished_at": datetime.utcnow().isoformat()+"Z","error": str(e)}).eq("id", run_id).execute()
        except Exception:
            pass
        raise
    opps = res.get("opportunities", [])
    saved = 0
    for o in opps:
        try:
            sb.table("opportunities").insert({
                "run_id": run_id,"company_name": o.get("company_name"),"domain": o.get("domain"),"target_person_name": o.get("target_person_name"),
                "target_title": o.get("target_title"),"persona": o.get("persona"),"linkedin_url": o.get("linkedin_url"),"location": o.get("location"),
                "country": o.get("country"),"employees": o.get("employees"),"what_is_happening": o.get("what_is_happening"),"why_now": o.get("why_now"),
                "potential_pain": o.get("potential_pain"),"context": o.get("context"),"recommended_approach": o.get("recommended_approach"),
                "opening_question": o.get("opening_question"),"confidence": o.get("confidence"),"status": o.get("status") or "review",
                "tags": o.get("tags") or [],"signals": o.get("signals") or [],"evidence": o.get("evidence") or [],
            }).execute()
            saved += 1
        except Exception as e:
            logger.warning("opp.save_fail", err=str(e))
    try:
        sb.table("scans").update({"status": "completed","finished_at": datetime.utcnow().isoformat()+"Z","opportunities_found": len(opps),"opportunities_saved": saved}).eq("id", run_id).execute()
    except Exception:
        pass
    return {"run_id": run_id,"opportunities": len(opps),"saved": saved}
