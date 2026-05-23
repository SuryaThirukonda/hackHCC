from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from schemas import SessionSummary


class SQLiteSessionStore:
    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or Path(__file__).parent / "data" / "physio_sessions.sqlite3"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def save_summary(self, summary: SessionSummary) -> None:
        payload = summary.model_dump_json()
        with sqlite3.connect(self.db_path) as connection:
            connection.execute(
                """
                INSERT INTO session_summaries (session_id, ended_at_ms, payload_json)
                VALUES (?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    ended_at_ms=excluded.ended_at_ms,
                    payload_json=excluded.payload_json
                """,
                (summary.session_id, summary.ended_at_ms, payload),
            )

    def list_summaries(self) -> list[SessionSummary]:
        with sqlite3.connect(self.db_path) as connection:
            rows = connection.execute(
                "SELECT payload_json FROM session_summaries ORDER BY ended_at_ms DESC"
            ).fetchall()

        summaries: list[SessionSummary] = []
        for (payload_json,) in rows:
            try:
                summaries.append(SessionSummary(**json.loads(payload_json)))
            except (json.JSONDecodeError, TypeError, ValueError):
                continue
        return summaries

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS session_summaries (
                    session_id TEXT PRIMARY KEY,
                    ended_at_ms INTEGER NOT NULL,
                    payload_json TEXT NOT NULL
                )
                """
            )
