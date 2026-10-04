from supabase import create_client, Client
from jobs_intel.config import settings

def get_sb() -> Client:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase not configured")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
