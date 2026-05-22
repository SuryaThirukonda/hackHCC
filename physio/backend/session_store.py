from __future__ import annotations

import json
from pathlib import Path

from schemas import SessionSummary


class LocalSessionStore:
    def __init__(self, base_dir: Path | None = None) -> None:
        self.base_dir = base_dir or Path(__file__).parent / "data" / "sessions"
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def save_summary(self, summary: SessionSummary) -> None:
        path = self.base_dir / f"{summary.session_id}.json"
        path.write_text(summary.model_dump_json(indent=2), encoding="utf-8")

    def list_summaries(self) -> list[SessionSummary]:
        summaries: list[SessionSummary] = []
        for path in sorted(self.base_dir.glob("*.json"), reverse=True):
            try:
                summaries.append(SessionSummary(**json.loads(path.read_text(encoding="utf-8"))))
            except (json.JSONDecodeError, TypeError, ValueError):
                continue
        return summaries
