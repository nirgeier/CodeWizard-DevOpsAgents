from langchain_openai import ChatOpenAI
from langchain_core.language_models.chat_models import BaseChatModel
from jobs_intel.config import settings

def get_llm() -> BaseChatModel:
    if settings.llm_provider == "openai" and settings.openai_api_key:
        return ChatOpenAI(model=settings.llm_model, temperature=settings.llm_temperature, max_tokens=settings.llm_max_tokens, api_key=settings.openai_api_key)
    return ChatOpenAI(model="gpt-4o-mini", temperature=0.1)
