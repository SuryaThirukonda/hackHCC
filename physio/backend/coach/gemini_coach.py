from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from coach.base import CoachCue, CoachProvider, clean_coach_text, packet_metrics_for_ai
from coach.http_errors import env_secret, provider_http_error
from coach.mock_coach import MockCoachProvider
from schemas import PhysioPacket, SessionSummary


class GeminiCoachProvider(CoachProvider):
    """Gemini adapter with a local fallback when keys or network are unavailable."""

    def __init__(self) -> None:
        self.api_key = env_secret("GEMINI_API_KEY")
        self.model = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
        self.timeout_sec = float(os.getenv("GEMINI_TIMEOUT_SEC", "3"))
        self.fallback = MockCoachProvider()

    def generate_cue(self, packet: PhysioPacket) -> CoachCue:
        if not self.api_key:
            cue = self.fallback.generate_cue(packet)
            cue.source = "mock"
            return cue

        prompt = (
            "You are Physio, a physical therapy exercise coach. "
            "Return one short, safe, non-diagnostic coaching cue under 14 words. "
            "Be concrete. Do not mention medical diagnosis. "
            f"Use only these scalar metrics: {json.dumps(packet_metrics_for_ai(packet), sort_keys=True)}"
        )
        try:
            text = self._generate_text(prompt)
            return CoachCue(packet.coach_state, clean_coach_text(text, packet.local_coach_message), "gemini")
        except Exception as exc:
            cue = self.fallback.generate_cue(packet)
            cue.source = "local"
            cue.error_message = f"gemini_fallback: {exc}"
            return cue

    def summarize_session(self, packets: list[PhysioPacket], fallback: SessionSummary) -> tuple[str, str, str]:
        if not self.api_key:
            return fallback.summary_text, fallback.recommendation_text, "local"

        metrics = self._session_metrics(packets, fallback)
        prompt = (
            "Summarize this physical therapy session for a dashboard. "
            "Return JSON with summary_text and recommendation_text. "
            "Keep each value under 24 words, safe, non-diagnostic, and concrete. "
            f"Metrics: {json.dumps(metrics, sort_keys=True)}"
        )
        try:
            text = self._generate_text(prompt)
            parsed = json.loads(self._extract_json(text))
            return (
                clean_coach_text(parsed.get("summary_text", fallback.summary_text), fallback.summary_text),
                clean_coach_text(parsed.get("recommendation_text", fallback.recommendation_text), fallback.recommendation_text),
                "gemini",
            )
        except Exception:
            return fallback.summary_text, fallback.recommendation_text, "local"

    def _generate_text(self, prompt: str) -> str:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.api_key}"
        body = json.dumps({
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.25,
                "maxOutputTokens": 80,
            },
        }).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_sec) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise ValueError(provider_http_error(exc, "gemini")) from exc

        try:
            return payload["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ValueError("gemini_response_missing_text") from exc

    @staticmethod
    def _extract_json(text: str) -> str:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("gemini_response_missing_json")
        return text[start:end + 1]

    @staticmethod
    def _session_metrics(packets: list[PhysioPacket], fallback: SessionSummary) -> dict[str, int | float | str]:
        states: dict[str, int] = {}
        for packet in packets:
            states[packet.coach_state] = states.get(packet.coach_state, 0) + 1
        return {
            "exercise": fallback.exercise,
            "side": fallback.side,
            "duration_sec": fallback.duration_sec,
            "total_reps": fallback.total_reps,
            "clean_reps": fallback.clean_reps,
            "best_angle": fallback.best_angle,
            "average_angle": fallback.average_angle,
            "average_physio_score": fallback.average_physio_score,
            "max_jitter_score": fallback.max_jitter_score,
            "average_jitter_score": fallback.average_jitter_score,
            "pain_level": fallback.pain_level,
            "fatigue_level": fallback.fatigue_level,
            "coach_state_counts": json.dumps(states, sort_keys=True),
        }
