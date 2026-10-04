from jobs_intel.state import AgentState
import structlog

logger = structlog.get_logger()

def scoring_node(state: AgentState) -> AgentState:
    logger.info("scoring.done")
    return state
