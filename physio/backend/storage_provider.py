from __future__ import annotations

import os
from typing import Protocol

from schemas import PhysioPacket, SessionSummary
from session_store import LocalSessionStore
from sqLite_store import SQLiteSessionStore


class SessionStore(Protocol):
    def save_session_start(self, session_id: str, user_id: str, exercise: str, side: str, target_angle: float, started_at_ms: int) -> None:
        ...

    def save_packet(self, packet: PhysioPacket) -> None:
        ...

    def save_summary(self, summary: SessionSummary) -> None:
        ...

    def save_session_result(self, session_id: str, result_json: str) -> None:
        ...

    def list_summaries(self) -> list[SessionSummary]:
        ...

    def list_session_results(self) -> list[dict]:
        ...

    def counts(self) -> dict[str, int | str]:
        ...


def get_session_store() -> SessionStore:
    provider = os.getenv("STORAGE_PROVIDER", "sqlite").lower()
    if provider in {"sqlite", "sqlite3", "sqllite"}:
        return SQLiteSessionStore()
    return LocalSessionStore()
