from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

from schemas import PhysioPacket, SessionSummary


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

    def save_session_start(self, session_id: str, user_id: str, exercise: str, side: str, target_angle: float, started_at_ms: int) -> None:
        with sqlite3.connect(self.db_path) as connection:
            connection.execute(
                """
                INSERT INTO sessions (session_id, user_id, exercise, side, target_angle, started_at_ms)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    user_id=excluded.user_id,
                    exercise=excluded.exercise,
                    side=excluded.side,
                    target_angle=excluded.target_angle,
                    started_at_ms=excluded.started_at_ms
                """,
                (session_id, user_id, exercise, side, target_angle, started_at_ms),
            )

    def save_packet(self, packet: PhysioPacket) -> None:
        with sqlite3.connect(self.db_path) as connection:
            connection.execute(
                """
                INSERT INTO packets (session_id, timestamp_ms, source, exercise, rep_count, coach_state, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    packet.session_id,
                    packet.timestamp_ms,
                    packet.source,
                    packet.exercise,
                    packet.rep_count,
                    packet.coach_state,
                    packet.model_dump_json(),
                ),
            )

    def save_session_result(self, session_id: str, result_json: str) -> None:
        with sqlite3.connect(self.db_path) as connection:
            connection.execute(
                """
                INSERT INTO session_results (session_id, saved_at_ms, result_json)
                VALUES (?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    saved_at_ms=excluded.saved_at_ms,
                    result_json=excluded.result_json
                """,
                (session_id, int(time.time() * 1000), result_json),
            )

    def list_session_results(self) -> list[dict]:
        with sqlite3.connect(self.db_path) as connection:
            rows = connection.execute(
                "SELECT result_json FROM session_results ORDER BY saved_at_ms DESC"
            ).fetchall()
        results: list[dict] = []
        for (result_json,) in rows:
            try:
                results.append(json.loads(result_json))
            except (json.JSONDecodeError, TypeError, ValueError):
                continue
        return results

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

    def counts(self) -> dict[str, int | str]:
        with sqlite3.connect(self.db_path) as connection:
            sessions = connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
            packets = connection.execute("SELECT COUNT(*) FROM packets").fetchone()[0]
            summaries = connection.execute("SELECT COUNT(*) FROM session_summaries").fetchone()[0]
            results = connection.execute("SELECT COUNT(*) FROM session_results").fetchone()[0]
        return {
            "provider": "sqlite",
            "db_path": str(self.db_path),
            "sessions": sessions,
            "packets": packets,
            "summaries": summaries,
            "results": results,
        }

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
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    exercise TEXT NOT NULL,
                    side TEXT NOT NULL,
                    target_angle REAL NOT NULL,
                    started_at_ms INTEGER NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS session_results (
                    session_id TEXT PRIMARY KEY,
                    saved_at_ms INTEGER NOT NULL,
                    result_json TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS packets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    timestamp_ms INTEGER NOT NULL,
                    source TEXT NOT NULL,
                    exercise TEXT NOT NULL,
                    rep_count INTEGER NOT NULL,
                    coach_state TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                )
                """
            )
