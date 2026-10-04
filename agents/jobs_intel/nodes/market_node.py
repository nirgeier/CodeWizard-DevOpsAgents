from jobs_intel.state import AgentState
from jobs_intel.tools.news import NewsTool
from jobs_intel.tools.funding import FundingTool
import structlog

logger = structlog.get_logger()

def market_node(state: AgentState) -> AgentState:
    keywords = ["devops","platform engineering","kubernetes","aws","gcp","azure","cloud migration","sre","ci/cd","internal developer platform"]
    items = NewsTool().fetch(keywords, since_days=30)
    items.extend(FundingTool().fetch(since_days=30))
    sigs = []
    for it in items[:60]:
        sigs.append({"source": it.get("source","web"),"type": it.get("type") or "news","headline": it.get("headline"),"summary": it.get("summary"),"url": it.get("url"),"occurred_at": it.get("occurred_at"),"confidence": 0.6,"tags": ["market"],"implication": it.get("implication"),"raw": it})
    state["market_signals"] = sigs
    logger.info("market.done", count=len(sigs))
    return state
