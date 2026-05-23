from __future__ import annotations

import os
import time
from dataclasses import dataclass, field

from coach.avatar_provider import AvatarResult, get_avatar_provider
from coach.base import CoachProvider, clean_coach_text
from coach.gemini_coach import GeminiCoachProvider
from coach.mock_coach import MockCoachProvider
from coach.voice_provider import VoiceResult, get_voice_provider
from schemas import CoachCueResponse, PhysioPacket, SessionSummary


IMPORTANT_STATES = {"error", "low_confidence", "too_fast", "too_jittery", "session_complete"}


@dataclass
class CoachSessionMemory:
    last_spoken_ms: int = 0
    last_spoken_message: str = ""
    last_coach_state: str = ""
    last_rep_count: int = 0
    last_cue_ms: int = 0
    recent_messages: list[str] = field(default_factory=list)


class CoachOrchestrator:
    def __init__(self) -> None:
        self.coach_provider = self._get_coach_provider()
        self.voice_provider = get_voice_provider()
        self.avatar_provider = get_avatar_provider()
        self.memories: dict[str, CoachSessionMemory] = {}
        self.min_speak_gap_ms = int(os.getenv("COACH_MIN_SPEAK_GAP_MS", "5000"))
        self.duplicate_gap_ms = int(os.getenv("COACH_DUPLICATE_GAP_MS", "14000"))

    def cue_for_packet(self, packet: PhysioPacket) -> CoachCueResponse:
        memory = self.memories.setdefault(packet.session_id, CoachSessionMemory())
        cue = self.coach_provider.generate_cue(packet)
        message = clean_coach_text(cue.message, packet.local_coach_message)
        now_ms = int(time.time() * 1000)
        should_speak, reason = self._should_speak(packet, message, memory, now_ms)

        voice_result = VoiceResult(status="idle")
        avatar_result = AvatarResult(status="disabled")
        if should_speak:
            voice_result = self.voice_provider.synthesize(message)
            memory.last_spoken_ms = now_ms
            memory.last_spoken_message = message

        memory.last_cue_ms = now_ms
        memory.last_coach_state = packet.coach_state
        memory.last_rep_count = packet.rep_count
        memory.recent_messages = (memory.recent_messages + [message])[-8:]

        provider_error = self._provider_errors(cue.error_message, voice_result.error_message, avatar_result.error_message)
        if provider_error and reason == "speak":
            reason = "speak_with_provider_fallback"

        return CoachCueResponse(
            coach_state=packet.coach_state,
            message=message,
            source=cue.source,
            voice_status=voice_result.status,
            avatar_status=avatar_result.status,
            should_speak=should_speak,
            reason=reason,
            audio_url=voice_result.audio_url,
            local_file_path=voice_result.local_file_path,
            avatar_url=avatar_result.avatar_url,
            avatar_session_id=avatar_result.avatar_session_id,
            provider_error=provider_error,
        )

    def summarize_session(self, packets: list[PhysioPacket], fallback: SessionSummary) -> SessionSummary:
        summarize = getattr(self.coach_provider, "summarize_session", None)
        if not callable(summarize):
            return fallback
        summary_text, recommendation_text, _source = summarize(packets, fallback)
        return fallback.model_copy(update={
            "summary_text": summary_text,
            "recommendation_text": recommendation_text,
        })

    def reset_session(self, session_id: str) -> None:
        self.memories.pop(session_id, None)

    def provider_status(self) -> dict[str, str | int | bool | None]:
        return {
            "coach_provider": self.coach_provider.__class__.__name__,
            "voice_provider": self.voice_provider.__class__.__name__,
            "avatar_provider": self.avatar_provider.__class__.__name__,
            "min_speak_gap_ms": self.min_speak_gap_ms,
            "duplicate_gap_ms": self.duplicate_gap_ms,
            "heygen_use_elevenlabs_audio": os.getenv("HEYGEN_USE_ELEVENLABS_AUDIO", "false").lower() in {"1", "true", "yes"},
            "public_base_url": bool(self._public_base()),
        }

    def _should_speak(
        self,
        packet: PhysioPacket,
        message: str,
        memory: CoachSessionMemory,
        now_ms: int,
    ) -> tuple[bool, str]:
        if not message:
            return False, "empty_message"
        if memory.last_spoken_ms == 0:
            return True, "first_cue"
        elapsed = now_ms - memory.last_spoken_ms
        if message == memory.last_spoken_message and elapsed < self.duplicate_gap_ms:
            return False, "duplicate_cue"
        if elapsed < self.min_speak_gap_ms:
            return False, "speak_cooldown"
        if packet.coach_state != memory.last_coach_state and packet.coach_state in IMPORTANT_STATES:
            return True, "state_changed"
        if packet.rep_count > memory.last_rep_count and packet.coach_state in {"good_form", "session_complete"}:
            return True, "rep_progress"
        if packet.coach_state in IMPORTANT_STATES:
            return True, "important_state"
        return False, "visual_only_tick"

    @staticmethod
    def _get_coach_provider() -> CoachProvider:
        provider = os.getenv("COACH_PROVIDER", "mock").lower()
        if provider == "gemini":
            return GeminiCoachProvider()
        return MockCoachProvider()

    @staticmethod
    def _public_base() -> str | None:
        value = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
        return value or None

    def _public_audio_url(self, audio_url: str | None) -> str | None:
        if not audio_url:
            return None
        if audio_url.startswith("http://") or audio_url.startswith("https://"):
            return audio_url
        base = self._public_base()
        if not base:
            return None
        return f"{base}{audio_url}"

    @staticmethod
    def _provider_errors(*errors: str | None) -> str | None:
        present = [error for error in errors if error]
        return " | ".join(present) if present else None
