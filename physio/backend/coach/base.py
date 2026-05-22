from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from schemas import PhysioPacket


@dataclass
class CoachCue:
    coach_state: str
    message: str
    source: str
    error_message: str | None = None


class CoachProvider(ABC):
    @abstractmethod
    def generate_cue(self, packet: PhysioPacket) -> CoachCue:
        """Return a short coaching cue for a final Physio packet."""


def clean_coach_text(text: str, fallback: str = "Move slowly and stay in control.") -> str:
    """Keep provider output short, concrete, and display safe."""
    normalized = " ".join((text or "").replace("\n", " ").split())
    if not normalized:
        normalized = fallback
    if len(normalized) > 140:
        normalized = normalized[:137].rstrip(" ,.;:") + "..."
    return normalized


def packet_metrics_for_ai(packet: PhysioPacket) -> dict[str, int | float | str | bool | None]:
    """Only scalar coaching metrics are sent to remote AI providers."""
    return {
        "exercise": packet.exercise,
        "side": packet.side,
        "coach_state": packet.coach_state,
        "local_coach_message": packet.local_coach_message,
        "shoulder_angle": packet.shoulder_angle,
        "elbow_angle": packet.elbow_angle,
        "target_angle": packet.target_angle,
        "rep_count": packet.rep_count,
        "rep_phase": packet.rep_phase,
        "hold_time_sec": packet.hold_time_sec,
        "pace": packet.pace,
        "range_status": packet.range_status,
        "compensation": packet.compensation,
        "physio_score": packet.physio_score,
        "combined_jitter_score": packet.combined_jitter_score,
        "jitter_detected": packet.jitter_detected,
        "landmark_confidence": packet.landmark_confidence,
        "sensor_status": packet.sensor_status,
        "camera_status": packet.camera_status,
        "distance_cm": packet.distance_cm,
    }
