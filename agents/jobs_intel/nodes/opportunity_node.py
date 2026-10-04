import json
from langchain_core.messages import SystemMessage, HumanMessage
from jobs_intel.state import AgentState
from jobs_intel.config import settings
from jobs_intel.prompts.base import SYSTEM_BASE
from jobs_intel.prompts.orchestrator import ORCHESTRATOR_PROMPT
from jobs_intel.utils.llm import get_llm
import structlog

logger = structlog.get_logger()

def opportunity_node(state: AgentState) -> AgentState:
    llm = get_llm()
    payload = {
        "run_id": state.get("run_id"),
        "mode": state.get("mode"),
        "market_signals": state.get("market_signals", [])[:80],
        "company_profiles": state.get("company_profiles", [])[:40],
        "people_profiles": state.get("people_profiles", [])[:40],
        "social_signals": state.get("social_signals", [])[:60],
        "fused_groups": state.get("fused_groups", [])[:40],
        "min_conf": settings.min_opportunity_confidence,
        "require_why_now": settings.require_why_now,
        "require_evidence": settings.require_evidence,
        "human_in_loop": settings.human_in_loop,
    }
    sys = SystemMessage(content=f"{SYSTEM_BASE}\n\n{ORCHESTRATOR_PROMPT}")
    hum = HumanMessage(content=json.dumps(payload, default=str))
    try:
        resp = llm.invoke([sys, hum])
        txt = resp.content if hasattr(resp, "content") else str(resp)
        s = txt.strip()
        if s.startswith("```"):
            s = s.strip("`")
        start, end = s.find("["), s.rfind("]")
        s2 = s[start:end+1] if start >= 0 and end > start else s
        opps = json.loads(s2)
    except Exception as e:
        logger.error("opportunity.llm_fail", err=str(e))
        opps = []
    norm = []
    for o in opps:
        if not o.get("why_now"):
            o["status"] = "rejected"
        if settings.require_evidence and not o.get("evidence"):
            o["evidence"] = []
        if o.get("confidence", 0) < settings.min_opportunity_confidence and o.get("status") != "rejected":
            o["status"] = "review"
        norm.append(o)
    state["opportunities"] = norm
    logger.info("opportunity.done", count=len(norm))
    return state
