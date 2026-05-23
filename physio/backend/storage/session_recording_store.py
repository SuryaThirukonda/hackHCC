from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any


class SessionRecordingStore:
    """SQLite-backed store for full session recordings (samples, events, reps)."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or Path(__file__).parent.parent / "data" / "physio_sessions.sqlite3"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def save_recording(self, session_id: str, recording: dict[str, Any]) -> None:
        payload = json.dumps(recording)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO session_recordings (session_id, saved_at_ms, recording_json)
                VALUES (?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    saved_at_ms = excluded.saved_at_ms,
                    recording_json = excluded.recording_json
                """,
                (session_id, int(time.time() * 1000), payload),
            )

    def get_recording(self, session_id: str) -> dict[str, Any] | None:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT recording_json FROM session_recordings WHERE session_id = ?",
                (session_id,),
            ).fetchone()
        if not row:
            return None
        try:
            return json.loads(row[0])
        except (json.JSONDecodeError, TypeError):
            return None

    def get_recording_timeline(self, session_id: str) -> list[dict[str, Any]]:
        recording = self.get_recording(session_id)
        if not recording:
            return []
        return recording.get("samples", [])

    def list_recordings(self, limit: int = 20) -> list[dict[str, Any]]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT session_id, saved_at_ms FROM session_recordings ORDER BY saved_at_ms DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [{"session_id": row[0], "saved_at_ms": row[1]} for row in rows]

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS session_recordings (
                    session_id TEXT PRIMARY KEY,
                    saved_at_ms INTEGER NOT NULL,
                    recording_json TEXT NOT NULL
                )
                """
            )


_store: SessionRecordingStore | None = None


def get_recording_store() -> SessionRecordingStore:
    global _store
    if _store is None:
        _store = SessionRecordingStore()
    return _store
