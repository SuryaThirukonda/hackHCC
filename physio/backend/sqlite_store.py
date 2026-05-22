from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from schemas import PhysioPacket, SessionSummary


class SQLitePhysioStore:
    def __init__(self, db_path: Path | None = None) -> None:
        data_dir = Path(__file__).parent / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = db_path or data_dir / "physio.sqlite3"
        self._lock = threading.Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_db(self) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    exercise TEXT NOT NULL,
                    side TEXT NOT NULL,
                    target_angle REAL NOT NULL,
                    started_at_ms INTEGER NOT NULL,
                    created_at_ms INTEGER NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS packets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    timestamp_ms INTEGER NOT NULL,
                    exercise TEXT NOT NULL,
                    side TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at_ms INTEGER NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_packets_session_timestamp
                ON packets(session_id, timestamp_ms)
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS session_summaries (
                    session_id TEXT PRIMARY KEY,
                    ended_at_ms INTEGER NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at_ms INTEGER NOT NULL
                )
                """
            )
            connection.commit()

    def save_session_start(
        self,
        *,
        session_id: str,
        user_id: str,
        exercise: str,
        side: str,
        target_angle: float,
        started_at_ms: int,
    ) -> None:
        now_ms = int(time.time() * 1000)
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO sessions
                (session_id, user_id, exercise, side, target_angle, started_at_ms, created_at_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (session_id, user_id, exercise, side, target_angle, started_at_ms, now_ms),
            )
            connection.commit()

    def save_packet(self, packet: PhysioPacket) -> None:
        now_ms = int(time.time() * 1000)
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO packets
                (session_id, source, timestamp_ms, exercise, side, payload_json, created_at_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    packet.session_id,
                    packet.source,
                    packet.timestamp_ms,
                    packet.exercise,
                    packet.side,
                    packet.model_dump_json(),
                    now_ms,
                ),
            )
            connection.commit()

    def save_summary(self, summary: SessionSummary) -> None:
        now_ms = int(time.time() * 1000)
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO session_summaries
                (session_id, ended_at_ms, payload_json, created_at_ms)
                VALUES (?, ?, ?, ?)
                """,
                (summary.session_id, summary.ended_at_ms, summary.model_dump_json(), now_ms),
            )
            connection.commit()

    def list_summaries(self) -> list[SessionSummary]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT payload_json
                FROM session_summaries
                ORDER BY ended_at_ms DESC
                """
            ).fetchall()

        summaries: list[SessionSummary] = []
        for row in rows:
            try:
                summaries.append(SessionSummary(**json.loads(row["payload_json"])))
            except (json.JSONDecodeError, TypeError, ValueError):
                continue
        return summaries

    def counts(self) -> dict[str, Any]:
        with self._lock, self._connect() as connection:
            sessions = connection.execute("SELECT COUNT(*) AS count FROM sessions").fetchone()["count"]
            packets = connection.execute("SELECT COUNT(*) AS count FROM packets").fetchone()["count"]
            summaries = connection.execute("SELECT COUNT(*) AS count FROM session_summaries").fetchone()["count"]
        return {"sessions": sessions, "packets": packets, "summaries": summaries, "db_path": str(self.db_path)}
