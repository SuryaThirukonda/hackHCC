from __future__ import annotations

import os
from typing import Protocol

from schemas import SessionSummary
from session_store import LocalSessionStore
from sqLite_store import SQLiteSessionStore


class SessionStore(Protocol):
    def save_summary(self, summary: SessionSummary) -> None:
        ...

    def list_summaries(self) -> list[SessionSummary]:
        ...


def get_session_store() -> SessionStore:
    provider = os.getenv("STORAGE_PROVIDER", "local").lower()
    if provider in {"sqlite", "sqlite3", "sqllite"}:
        return SQLiteSessionStore()
    return LocalSessionStore()
