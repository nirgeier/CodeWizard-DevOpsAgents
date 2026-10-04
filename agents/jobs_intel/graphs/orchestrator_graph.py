from langgraph.graph import StateGraph, END
from jobs_intel.state import AgentState
from jobs_intel.nodes.market_node import market_node
from jobs_intel.nodes.company_node import company_node
from jobs_intel.nodes.people_node import people_node
from jobs_intel.nodes.social_node import social_node
from jobs_intel.nodes.fusion_node import fusion_node
from jobs_intel.nodes.scoring_node import scoring_node
from jobs_intel.nodes.opportunity_node import opportunity_node

def build_graph():
    g = StateGraph(AgentState)
    g.add_node("market", market_node)
    g.add_node("company", company_node)
    g.add_node("people", people_node)
    g.add_node("social", social_node)
    g.add_node("fusion", fusion_node)
    g.add_node("scoring", scoring_node)
    g.add_node("opportunity", opportunity_node)
    g.set_entry_point("market")
    g.add_edge("market", "company")
    g.add_edge("company", "people")
    g.add_edge("people", "social")
    g.add_edge("social", "fusion")
    g.add_edge("fusion", "scoring")
    g.add_edge("scoring", "opportunity")
    g.add_edge("opportunity", END)
    return g.compile()
