from __future__ import annotations

import json
from pathlib import Path

from schemas import PhysioPacket, SessionSummary


class LocalSessionStore:
    def __init__(self, base_dir: Path | None = None) -> None:
        self.base_dir = base_dir or Path(__file__).parent / "data" / "sessions"
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def save_session_start(self, session_id: str, user_id: str, exercise: str, side: str, target_angle: float, started_at_ms: int) -> None:
        return None

    def save_packet(self, packet: PhysioPacket) -> None:
        return None

    def save_summary(self, summary: SessionSummary) -> None:
        path = self.base_dir / f"{summary.session_id}.json"
        path.write_text(summary.model_dump_json(indent=2), encoding="utf-8")

    def save_session_result(self, session_id: str, result_json: str) -> None:
        path = self.base_dir / f"{session_id}.result.json"
        path.write_text(result_json, encoding="utf-8")

    def list_session_results(self) -> list[dict]:
        results: list[dict] = []
        for path in sorted(self.base_dir.glob("*.result.json"), reverse=True):
            try:
                results.append(json.loads(path.read_text(encoding="utf-8")))
            except (json.JSONDecodeError, TypeError, ValueError):
                continue
        return results

    def list_summaries(self) -> list[SessionSummary]:
        summaries: list[SessionSummary] = []
        for path in sorted(self.base_dir.glob("*.json"), reverse=True):
            try:
                summaries.append(SessionSummary(**json.loads(path.read_text(encoding="utf-8"))))
            except (json.JSONDecodeError, TypeError, ValueError):
                continue
        return summaries

    def counts(self) -> dict[str, int | str]:
        return {
            "provider": "local_json",
            "summaries": len(list(self.base_dir.glob("*.json"))),
            "packets": 0,
        }
