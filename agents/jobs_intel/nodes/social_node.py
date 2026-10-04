from jobs_intel.state import AgentState
from jobs_intel.tools.linkedin import LinkedInTool
import structlog

logger = structlog.get_logger()

def social_node(state: AgentState) -> AgentState:
    lt = LinkedInTool()
    soc = []
    domains = list({c.get("domain") for c in state.get("company_profiles", []) if c.get("domain")})
    soc.extend(lt.company_posts(domains))
    soc.extend(lt.job_posts_devops(["devops","platform","sre","kubernetes"]))
    state["social_signals"] = soc
    logger.info("social.done", count=len(soc))
    return state
