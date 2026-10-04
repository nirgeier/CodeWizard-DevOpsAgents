"""CodeWizard Jobs Intelligence - deterministic engine (stdlib only).

This is the runnable core behind `Jobs/agents/run.py`. It deliberately avoids
LangGraph / pydantic / supabase SDK so it runs anywhere python3 exists. LLM
enrichment and external connectors can be layered on later; the correlation and
opportunity generation here are rule-based and fully explainable.
"""

from .settings import settings
from .pipeline import run_pipeline

__all__ = ["settings", "run_pipeline"]
