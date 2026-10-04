"""Persistence: Supabase REST when available, local JSON otherwise.

Both backends receive the same rows. Rows carry deterministic ids, so
`on_conflict=id` makes every run idempotent (re-runs update, never duplicate).
The local JSON mirror under Jobs/data/ is always written, so the Next.js
viewer and the internal app can read results even before the SQL schema is
applied to Supabase.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List

from .settings import settings
from .util import now_iso


class Store:
    def __init__(self) -> None:
        self.mode = "local"
        self.reason = "Supabase not configured"
        self.url = settings.supabase_url
        self.key = settings.supabase_key
        self.data_dir = settings.data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        if settings.supabase_configured():
            ok, reason = self._probe()
            self.mode = "supabase" if ok else "local"
            self.reason = reason

    # --- Supabase ----------------------------------------------------------
    def _request(self, method: str, path: str, body: Any = None, prefer: str | None = None):
        url = f"{self.url}/rest/v1/{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8", "replace")
                return resp.status, (json.loads(raw) if raw.strip() else None)
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            try:
                parsed = json.loads(raw) if raw.strip() else None
            except ValueError:
                parsed = raw
            return e.code, parsed
        except Exception as e:  # network error
            return 0, str(e)

    def _probe(self):
        status, payload = self._request("GET", "opportunities?select=id&limit=1")
        if status in (200, 206):
            return True, "supabase reachable"
        code = ""
        if isinstance(payload, dict):
            code = str(payload.get("code") or payload.get("message") or "")
        if "PGRST205" in code or "does not exist" in code or status == 404:
            return False, "Jobs tables missing - run Jobs/db/Jobs_schema.sql"
        return False, f"supabase unavailable ({status}: {code})"

    # --- public API --------------------------------------------------------
    def info(self) -> Dict[str, Any]:
        return {"mode": self.mode, "reason": self.reason, "data_dir": str(self.data_dir)}

    def save(self, table: str, rows: List[Dict[str, Any]], conflict: str = "id", merge: bool = False) -> Dict[str, Any]:
        rows = [r for r in rows if r]
        if not rows:
            return {"table": table, "mode": self.mode, "saved": 0}
        if self.mode == "supabase":
            q = urllib.parse.urlencode({"on_conflict": conflict})
            status, payload = self._request(
                "POST", f"{table}?{q}", body=rows,
                prefer="resolution=merge-duplicates,return=minimal",
            )
            ok = status in (200, 201, 204)
            if not ok:
                # fall back to a row-by-row insert so one bad row can't drop them all
                saved = 0
                for row in rows:
                    s2, _ = self._request("POST", f"{table}?on_conflict={conflict}", body=[row],
                                          prefer="resolution=merge-duplicates,return=minimal")
                    if s2 in (200, 201, 204):
                        saved += 1
                self._write_local(table, rows, merge=merge)
                return {"table": table, "mode": "supabase", "saved": saved, "bulk_error": str(payload)[:200]}
            self._write_local(table, rows, merge=merge)
            return {"table": table, "mode": "supabase", "saved": len(rows)}
        self._write_local(table, rows, merge=merge)
        return {"table": table, "mode": "local", "saved": len(rows)}

    def count_local(self, table: str) -> int:
        return len(self._read_local(table))

    def read(self, table: str, select: str = "*", limit: int = 1000) -> List[Dict[str, Any]]:
        """Read rows (Supabase GET or the local mirror). Never raises."""
        if self.mode == "supabase":
            status, payload = self._request("GET", f"{table}?select={select}&limit={limit}")
            if status in (200, 206) and isinstance(payload, list):
                return payload
            return []
        return self._read_local(table)

    # --- local mirror ------------------------------------------------------
    def _local_path(self, table: str) -> Path:
        return self.data_dir / f"{table}.json"

    def _read_local(self, table: str) -> List[Dict[str, Any]]:
        try:
            data = json.loads(self._local_path(table).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        if isinstance(data, dict):
            return list(data.get("items") or [])
        return list(data or [])

    def _write_local(self, table: str, rows: List[Dict[str, Any]], merge: bool = False) -> None:
        """Write the local table snapshot.

        The pipeline fully recomputes every entity with deterministic ids, so a
        replace is idempotent and prevents stale rows from lingering. Scanners
        that accumulate over time (e.g. devops_jobs) pass merge=True so rows
        discovered in earlier runs are kept.
        """
        payload: List[Dict[str, Any]] = []
        seen: set = set()
        for row in rows:
            rid = row.get("id") or row.get("dedupe_key") or row.get("hash")
            if not rid or rid in seen:
                continue
            seen.add(rid)
            merged = dict(row)
            merged.setdefault("updated_at", now_iso())
            merged.setdefault("created_at", now_iso())
            payload.append(merged)
        if merge:
            by_id: Dict[Any, Dict[str, Any]] = {}
            for row in self._read_local(table):
                rid = row.get("id") or row.get("dedupe_key") or row.get("hash")
                if rid:
                    by_id[rid] = row
            for row in payload:
                rid = row.get("id") or row.get("dedupe_key") or row.get("hash")
                by_id[rid] = {**by_id.get(rid, {}), **row}
            payload = list(by_id.values())
        self._local_path(table).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
        )


def make_store() -> Store:
    return Store()
