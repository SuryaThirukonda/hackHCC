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
                    sensor_status TEXT,
                    camera_status TEXT,
                    distance_cm REAL,
                    sensor_jitter_score REAL,
                    opencv_jitter_score REAL,
                    combined_jitter_score REAL,
                    rep_count INTEGER,
                    coach_state TEXT,
                    physio_score INTEGER,
                    voice_status TEXT,
                    avatar_status TEXT,
                    payload_json TEXT NOT NULL,
                    created_at_ms INTEGER NOT NULL
                )
                """
            )
            self._ensure_packet_columns(connection)
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_packets_session_timestamp
                ON packets(session_id, timestamp_ms)
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_packets_exercise_source
                ON packets(exercise, source)
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_packets_sensor_status
                ON packets(sensor_status)
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

    def _ensure_packet_columns(self, connection: sqlite3.Connection) -> None:
        existing = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(packets)").fetchall()
        }
        columns = {
            "sensor_status": "TEXT",
            "camera_status": "TEXT",
            "distance_cm": "REAL",
            "sensor_jitter_score": "REAL",
            "opencv_jitter_score": "REAL",
            "combined_jitter_score": "REAL",
            "rep_count": "INTEGER",
            "coach_state": "TEXT",
            "physio_score": "INTEGER",
            "voice_status": "TEXT",
            "avatar_status": "TEXT",
        }
        for name, sql_type in columns.items():
            if name not in existing:
                connection.execute(f"ALTER TABLE packets ADD COLUMN {name} {sql_type}")

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
                (
                    session_id,
                    source,
                    timestamp_ms,
                    exercise,
                    side,
                    sensor_status,
                    camera_status,
                    distance_cm,
                    sensor_jitter_score,
                    opencv_jitter_score,
                    combined_jitter_score,
                    rep_count,
                    coach_state,
                    physio_score,
                    voice_status,
                    avatar_status,
                    payload_json,
                    created_at_ms
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    packet.session_id,
                    packet.source,
                    packet.timestamp_ms,
                    packet.exercise,
                    packet.side,
                    packet.sensor_status,
                    packet.camera_status,
                    packet.distance_cm,
                    packet.sensor_jitter_score,
                    packet.opencv_jitter_score,
                    packet.combined_jitter_score,
                    packet.rep_count,
                    packet.coach_state,
                    packet.physio_score,
                    packet.voice_status,
                    packet.avatar_status,
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
