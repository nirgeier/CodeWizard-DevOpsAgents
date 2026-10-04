from jobs_intel.state import AgentState
from jobs_intel.tools.people import PeopleTool
import structlog

logger = structlog.get_logger()

def people_node(state: AgentState) -> AgentState:
    pt = PeopleTool()
    ppl = []
    seen = set()
    for c in state.get("company_profiles", []):
        d = c.get("domain")
        k = d or c.get("name")
        if not k or k in seen: continue
        seen.add(k)
        for pr in pt.search(company_domain=d):
            ppl.append(pr)
    state["people_profiles"] = ppl
    logger.info("people.done", count=len(ppl))
    return state
