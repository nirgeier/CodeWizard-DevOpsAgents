from collections import defaultdict
from jobs_intel.state import AgentState
import structlog

logger = structlog.get_logger()

def fusion_node(state: AgentState) -> AgentState:
    groups = defaultdict(lambda: {"signals": []})
    def add(sig, key):
        groups[key or "unknown"]["signals"].append(sig)
    for s in state.get("market_signals", []):
        add(s, s.get("domain") or s.get("company_name"))
    for s in state.get("social_signals", []):
        add(s, s.get("domain") or s.get("company_name"))
    fused = [{"key": k, "signals": v["signals"], "company_key": k} for k, v in groups.items()]
    state["fused_groups"] = fused
    logger.info("fusion.done", groups=len(fused), total_sigs=sum(len(g["signals"]) for g in fused))
    return state
