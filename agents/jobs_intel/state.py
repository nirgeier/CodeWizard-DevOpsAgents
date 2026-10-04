from typing import TypedDict, List, Optional, Dict, Any
from datetime import datetime

class AgentState(TypedDict, total=False):
    run_id: str
    mode: str
    filters: Dict[str, Any]
    query: Optional[str]
    started_at: datetime
    finished_at: Optional[datetime]
    errors: List[str]
    market_signals: List[Dict[str, Any]]
    company_profiles: List[Dict[str, Any]]
    people_profiles: List[Dict[str, Any]]
    social_signals: List[Dict[str, Any]]
    fused_groups: List[Dict[str, Any]]
    opportunities: List[Dict[str, Any]]
    stats: Dict[str, Any]
