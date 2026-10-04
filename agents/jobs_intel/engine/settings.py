"""Runtime settings for the Jobs-intelligence engine (stdlib only).

Resolution order for every value:
  1. process environment (wins)
  2. Jobs/agents/.env
  3. web/.env            (so the same Supabase creds the internal app uses are reused)
"""
from __future__ import annotations

import os
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent
JOBS_INTEL_DIR = ENGINE_DIR.parent          # .../Jobs/agents/jobs_intel
AGENTS_DIR = JOBS_INTEL_DIR.parent          # .../Jobs/agents
JOBS_DIR = AGENTS_DIR.parent                # .../Jobs
REPO_ROOT = JOBS_DIR.parent                 # repo root


def _parse_env_file(path: Path) -> dict:
    out: dict = {}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return out
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key:
            out[key] = val
    return out


def _first_existing_dir(*paths: Path) -> Path:
    """Return the first directory that exists (else the first candidate)."""
    for p in paths:
        if p.is_dir():
            return p
    return paths[0]


def _first_env(key: str, *files: Path) -> str:
    val = os.environ.get(key)
    if val:
        return val
    for f in files:
        data = _parse_env_file(f)
        if data.get(key):
            return data[key]
    return ""


class Settings:
    def __init__(self) -> None:
        self.repo_root = REPO_ROOT
        self.Jobs_dir = JOBS_DIR
        self.agents_dir = AGENTS_DIR

        # --- data locations -------------------------------------------------
        # The repo is split into internal-app/ (this bundle) + public-site/, with
        # the WhatsApp job data kept at <repo-root>/agent/data. Resolve the first
        # existing candidate so the pipeline runs from either root.
        self.data_dir = JOBS_DIR / "data"
        self.agent_data_dir = _first_existing_dir(
            REPO_ROOT / "agent" / "data",
            REPO_ROOT.parent / "agent" / "data",
            REPO_ROOT.parent.parent / "agent" / "data",
        )
        self.jobs_file = self.agent_data_dir / "jobs.json"
        self.leads_file = self.agent_data_dir / "leads.json"
        self.inbox_file = self.agent_data_dir / "inbox.json"

        # --- Supabase (reuse the internal app's creds) ----------------------
        env_files = (
            AGENTS_DIR / ".env",
            REPO_ROOT / "web" / ".env",
            REPO_ROOT.parent / "web" / ".env",
        )
        self.supabase_url = _first_env("SUPABASE_URL", *env_files).rstrip("/")
        self.supabase_key = (
            _first_env("SUPABASE_PUBLISHABLE_KEY", *env_files)
            or _first_env("SUPABASE_SECRET_KEY", *env_files)
        )
        self.local_only = os.environ.get("JOBS_LOCAL_ONLY", "") == "1"

        # --- optional external connectors -----------------------------------
        self.newsapi_key = _first_env("NEWSAPI_KEY", *env_files)
        self.gnews_api_key = _first_env("GNEWS_API_KEY", *env_files)
        # Discord's Cloudflare rejects the default urllib agent, so this is load-bearing.
        self.user_agent = _first_env("USER_AGENT", *env_files) or "CodeWizard-JobsIntel/1.0"

        # --- correlation / scoring ------------------------------------------
        self.correlation_window_days = int(os.environ.get("CORRELATION_WINDOW_DAYS", "14"))
        self.time_decay_days = int(os.environ.get("TIME_DECAY_DAYS", "30"))
        self.min_confidence = float(os.environ.get("MIN_OPPORTUNITY_CONFIDENCE", "0.65"))
        self.require_evidence = os.environ.get("REQUIRE_EVIDENCE", "true").lower() != "false"
        self.require_why_now = os.environ.get("REQUIRE_WHY_NOW", "true").lower() != "false"
        self.human_in_loop = os.environ.get("HUMAN_IN_LOOP", "true").lower() != "false"

        # --- Discord notifications -----------------------------------------
        # Either DISCORD_WEBHOOK_URL, or DISCORD_BOT_TOKEN + DISCORD_CHANNEL_ID.
        self.discord_webhook_url = _first_env("DISCORD_WEBHOOK_URL", *env_files)
        self.discord_bot_token = _first_env("DISCORD_BOT_TOKEN", *env_files)
        self.discord_channel_id = _first_env("DISCORD_CHANNEL_ID", *env_files)
        self.discord_enabled = os.environ.get("DISCORD_NOTIFY", "true").lower() != "false"
        # 0.0 disables posting (blank falls back to min_confidence at send time).
        self.discord_min_confidence = float(os.environ.get("DISCORD_MIN_CONFIDENCE", "") or 0)
        self.discord_max_opportunities = int(os.environ.get("DISCORD_MAX_OPPORTUNITIES", "10"))
        self.discord_notify_on_empty = os.environ.get("DISCORD_NOTIFY_ON_EMPTY", "false").lower() == "true"

    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_key) and not self.local_only


settings = Settings()
