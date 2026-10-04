from pydantic import BaseModel, Field
from typing import Optional, List, Literal, Dict, Any
from datetime import datetime

SignalType = Literal["funding","growth","m_and_a","product_launch","market_expansion","rd_expansion","org_change","layoffs","tech_shift","regulation","partnership","hiring","role_change","post","job_posting","other"]

class Signal(BaseModel):
    source: str
    type: SignalType
    company_name: Optional[str] = None
    domain: Optional[str] = None
    url: Optional[str] = None
    headline: Optional[str] = None
    summary: Optional[str] = None
    occurred_at: Optional[datetime] = None
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)
    tags: List[str] = []
    implication: Optional[str] = None

class OpportunityOut(BaseModel):
    company_name: str
    domain: Optional[str] = None
    target_person_name: Optional[str] = None
    target_title: Optional[str] = None
    persona: Optional[str] = None
    linkedin_url: Optional[str] = None
    location: Optional[str] = None
    country: Optional[str] = None
    employees: Optional[str] = None
    what_is_happening: str
    why_now: str
    potential_pain: str
    context: str
    recommended_approach: str
    opening_question: str
    confidence: float = Field(ge=0,le=1)
    status: Literal["new","review","approved","rejected"] = "review"
    tags: List[str] = []
    signals: List[Dict[str, Any]] = []
    evidence: List[Dict[str, Any]] = []
