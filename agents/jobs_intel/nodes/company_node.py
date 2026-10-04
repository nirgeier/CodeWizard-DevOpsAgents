from jobs_intel.state import AgentState
from jobs_intel.tools.company import CompanyTool
import structlog

logger = structlog.get_logger()

def company_node(state: AgentState) -> AgentState:
    ct = CompanyTool()
    profs = []
    seen = set()
    for s in state.get("market_signals", []):
        d, nm = s.get("domain"), s.get("company_name")
        key = d or nm
        if not key or key in seen: continue
        seen.add(key)
        p = ct.enrich(domain=d, name=nm)
        profs.append({**p, "confidence": p.get("confidence", 0.5)})
    state["company_profiles"] = profs
    logger.info("company.done", count=len(profs))
    return state
