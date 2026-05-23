from __future__ import annotations

import json
import os
import re
from typing import Any

from google import genai
from google.genai.types import GenerateContentConfig, HttpOptions

from coach.base import CoachCue, CoachProvider, clean_coach_text, packet_metrics_for_ai
from coach.mock_coach import MockCoachProvider
from schemas import PhysioPacket, SessionSummary

DEFAULT_PROJECT = "project-f3192730-7603-48b5-a64"
DEFAULT_LOCATION = "us-central1"
DEFAULT_MODEL = "gemini-2.5-flash"
VERTEX_IMPLEMENTATION = "vertex-google-genai-v1"

# Prevent the SDK from preferring AI Studio when these are set in .env.
_AI_STUDIO_ENV_KEYS = (
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
)


def sanitize_gemini_error(exc: BaseException) -> str:
    """Return a short, UI-safe error string without huge Google payloads."""
    text = str(exc).strip()
    if "generativelanguage.googleapis.com" in text or "ai.google.dev" in text:
        return (
            "AI Studio endpoint was used instead of Vertex. "
            "Remove GEMINI_API_KEY from .env and restart the backend."
        )
    text = re.sub(r"\{[^{}]{80,}\}", "{...}", text)
    text = re.sub(r"gemini_http_\d+:\s*", "", text)
    text = " ".join(text.split())
    if len(text) > 220:
        text = text[:217].rstrip() + "..."
    return text or exc.__class__.__name__


def _text_only_config(*, max_output_tokens: int) -> GenerateContentConfig:
    return GenerateContentConfig(
        temperature=0.25,
        max_output_tokens=max_output_tokens,
        response_modalities=["TEXT"],
    )


def _response_text(response: Any) -> str | None:
    text = getattr(response, "text", None)
    if text and str(text).strip():
        return str(text).strip()
    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None) or []
        chunks: list[str] = []
        for part in parts:
            part_text = getattr(part, "text", None)
            if part_text:
                chunks.append(str(part_text))
        if chunks:
            return " ".join(chunks).strip()
    return None


class GeminiCoachProvider(CoachProvider):
    """Gemini via Vertex AI (Application Default Credentials) with local fallback."""

    _last_status: str = "not_initialized"
    _last_error: str | None = None

    def __init__(self) -> None:
        self.project = (os.getenv("GOOGLE_CLOUD_PROJECT") or DEFAULT_PROJECT).strip()
        self.location = (os.getenv("GOOGLE_CLOUD_LOCATION") or DEFAULT_LOCATION).strip()
        self.model = os.getenv("GEMINI_MODEL", DEFAULT_MODEL).strip()
        self.timeout_sec = float(os.getenv("GEMINI_TIMEOUT_SEC", "30"))
        self.fallback = MockCoachProvider()
        self._client: genai.Client | None = None
        self._vertex_enabled = False
        self._init_vertex_client()

    @property
    def vertex_enabled(self) -> bool:
        return self._vertex_enabled

    def _init_vertex_client(self) -> None:
        if not self.project:
            GeminiCoachProvider._last_status = "vertex_disabled_no_project"
            GeminiCoachProvider._last_error = "GOOGLE_CLOUD_PROJECT is not set"
            return

        for key in _AI_STUDIO_ENV_KEYS:
            os.environ.pop(key, None)

        try:
            self._client = genai.Client(
                vertexai=True,
                project=self.project,
                location=self.location,
                http_options=HttpOptions(api_version="v1"),
            )
            self._vertex_enabled = True
            GeminiCoachProvider._last_status = "vertex_ready"
            GeminiCoachProvider._last_error = None
        except Exception as exc:
            self._vertex_enabled = False
            GeminiCoachProvider._last_status = "vertex_init_error"
            GeminiCoachProvider._last_error = sanitize_gemini_error(exc)

    @classmethod
    def debug_status(cls) -> dict[str, Any]:
        probe = cls()
        return {
            "implementation": VERTEX_IMPLEMENTATION,
            "vertex_enabled": probe.vertex_enabled,
            "project": probe.project,
            "location": probe.location,
            "model": probe.model,
            "last_status": cls._last_status,
            "last_error": cls._last_error,
        }

    def generate_cue(self, packet: PhysioPacket) -> CoachCue:
        if not self._vertex_enabled:
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
            text = self._generate_text(prompt, max_output_tokens=96)
            return CoachCue(packet.coach_state, clean_coach_text(text, packet.local_coach_message), "gemini")
        except Exception as exc:
            cue = self.fallback.generate_cue(packet)
            cue.source = "local"
            cue.error_message = f"gemini_fallback: {sanitize_gemini_error(exc)}"
            return cue

    def summarize_session(self, packets: list[PhysioPacket], fallback: SessionSummary) -> tuple[str, str, str]:
        if not self._vertex_enabled:
            return fallback.summary_text, fallback.recommendation_text, "local"

        metrics = self._session_metrics(packets, fallback)
        prompt = (
            "Summarize this physical therapy session for a dashboard. "
            "Return JSON with summary_text and recommendation_text. "
            "Keep each value under 24 words, safe, non-diagnostic, and concrete. "
            f"Metrics: {json.dumps(metrics, sort_keys=True)}"
        )
        try:
            text = self._generate_text(prompt, max_output_tokens=256)
            parsed = json.loads(self._extract_json(text))
            return (
                clean_coach_text(parsed.get("summary_text", fallback.summary_text), fallback.summary_text),
                clean_coach_text(parsed.get("recommendation_text", fallback.recommendation_text), fallback.recommendation_text),
                "gemini",
            )
        except Exception:
            return fallback.summary_text, fallback.recommendation_text, "local"

    def _generate_text(self, prompt: str, *, max_output_tokens: int = 96) -> str:
        if not self._client:
            GeminiCoachProvider._last_status = "vertex_not_configured"
            GeminiCoachProvider._last_error = "vertex_not_configured"
            raise ValueError("vertex_not_configured")

        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("empty_text_prompt")

        try:
            response = self._client.models.generate_content(
                model=self.model,
                contents=prompt.strip(),
                config=_text_only_config(max_output_tokens=max_output_tokens),
            )
        except Exception as exc:
            GeminiCoachProvider._last_status = "vertex_error"
            GeminiCoachProvider._last_error = sanitize_gemini_error(exc)
            raise ValueError(GeminiCoachProvider._last_error) from exc

        text = _response_text(response)
        if not text:
            GeminiCoachProvider._last_status = "vertex_empty_response"
            GeminiCoachProvider._last_error = "gemini_response_missing_text"
            raise ValueError("gemini_response_missing_text")

        GeminiCoachProvider._last_status = "success"
        GeminiCoachProvider._last_error = None
        return text

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
