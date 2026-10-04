from pydantic_settings import BaseSettings
from typing import Optional, List

class Settings(BaseSettings):
    llm_provider: str = "openai"
    llm_model: str = "gpt-4o-mini"
    llm_temperature: float = 0.1
    llm_max_tokens: int = 2000
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None

    supabase_url: str = ""
    supabase_service_role_key: str = ""

    newsapi_key: Optional[str] = None
    gnews_api_key: Optional[str] = None
    apify_api_token: Optional[str] = None
    clay_api_key: Optional[str] = None
    proxycurl_api_key: Optional[str] = None
    ocean_api_key: Optional[str] = None
    apollo_api_key: Optional[str] = None
    builtwith_api_key: Optional[str] = None

    user_agent: str = "CodeWizard-JobsIntel/1.0"
    http_timeout_sec: int = 30
    http_max_retries: int = 3
    rate_limit_per_sec: float = 5.0

    correlation_window_days: int = 14
    time_decay_days: int = 30
    min_opportunity_confidence: float = 0.70
    require_evidence: bool = True
    require_why_now: bool = True
    human_in_loop: bool = True

    embeddings_provider: str = "openai"
    embeddings_model: str = "text-embedding-3-small"
    embedding_dim: int = 1536

    port: int = 8001
    api_key: str = "change-me"

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
