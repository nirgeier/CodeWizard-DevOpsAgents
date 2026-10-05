"""Persistence via the db abstraction layer (db/python submodule).

Mode selection:
  1. STORAGE_MODE / DB_MODE env (or agents/.env): "local" | "json" |
     "postgres" | "supabase". `JOBS_LOCAL_ONLY=1` forces "local".
  2. The persisted `storage_mode` setting mirrored in <repo>/data/settings.json
     (chosen in the webapp Settings page).
  3. Supabase when creds exist, then Postgres when DATABASE_URL is set,
     otherwise local JSON.

Whatever the mode, the local mirror under <repo>/data/ is always written too,
so the Next.js viewer and the internal app can read results even before the
SQL schema is applied to Supabase/Postgres. Rows carry deterministic ids, so
`on_conflict=id` makes every run idempotent.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List

from .settings import settings
from .util import now_iso

# --- import the shared db abstraction (db/ submodule) -----------------------
try:  # pip-installed first
    import codewizard_db  # noqa: F401
except ImportError:  # fall back to the in-repo submodule
    _db_python = Path(settings.Jobs_dir) / "db" / "python"
    if _db_python.is_dir():
        sys.path.insert(0, str(_db_python))

from codewizard_db import BackendConfig, create_backend, normalize_mode  # noqa: E402
from codewizard_db.json_store import JsonBackend  # noqa: E402
from codewizard_db.base import DbBackend  # noqa: E402


def _persisted_mode() -> str | None:
    try:
        data = json.loads((settings.data_dir / "settings.json").read_text(encoding="utf-8"))
        items = data if isinstance(data, list) else data.get("items") or []
        row = next((s for s in items if s.get("key") == "storage_mode"), None)
        value = row and row.get("value")
        if isinstance(value, str):
            return normalize_mode(value)
        if isinstance(value, dict):
            return normalize_mode(value.get("mode") or value.get("storage_mode"))
    except Exception:  # noqa: BLE001
        pass
    return None


class Store:
    def __init__(self) -> None:
        self.data_dir = settings.data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.url = settings.supabase_url
        self.key = settings.supabase_key
        self._local = JsonBackend(self.data_dir)
        self._backend = self._make_backend()
        self.reason = self._backend.reason

    @property
    def mode(self) -> str:
        return self._backend.mode

    @mode.setter
    def mode(self, value: str) -> None:
        # scan_jobs.py flips this to "local" for --no-db; switching the
        # backend keeps save/read consistent with what the caller expects.
        if normalize_mode(value) == "local" and self._backend is not self._local:
            self._backend = self._local
            self.reason = "forced local JSON store"
        else:
            self.reason = self._backend.reason

    def _make_backend(self) -> DbBackend:
        if settings.local_only:
            return self._local
        mode = normalize_mode(getattr(settings, "storage_mode", "")) or _persisted_mode()
        if not mode:
            if settings.supabase_configured():
                mode = "supabase"
            elif getattr(settings, "postgres_url", ""):
                mode = "postgres"
            else:
                mode = "local"
        return create_backend(
            BackendConfig(
                mode=mode,
                data_dir=self.data_dir,
                supabase_url=settings.supabase_url,
                supabase_key=settings.supabase_key,
                postgres_url=getattr(settings, "postgres_url", ""),
            )
        )

    # --- public API ---------------------------------------------------------
    def info(self) -> Dict[str, Any]:
        info = dict(self._backend.info())
        info.setdefault("mode", self.mode)
        info.setdefault("reason", self.reason)
        info["data_dir"] = str(self.data_dir)
        return info

    def save(self, table: str, rows: List[Dict[str, Any]], conflict: str = "id", merge: bool = False) -> Dict[str, Any]:
        result = self._backend.save(table, rows, conflict=conflict, merge=merge)
        if self.mode != "local":
            # Always keep the local mirror in sync (the webapp can read it).
            self._local.save(table, rows, conflict=conflict, merge=merge)
        return result

    def count_local(self, table: str) -> int:
        return self._local.count(table)

    def read(self, table: str, select: str = "*", limit: int = 1000) -> List[Dict[str, Any]]:
        """Read rows (active backend or the local mirror). Never raises."""
        return self._backend.read(table, select=select, limit=limit)


def make_store() -> Store:
    return Store()
