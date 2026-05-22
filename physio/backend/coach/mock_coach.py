from __future__ import annotations

from coach.base import CoachCue, CoachProvider, clean_coach_text
from schemas import PhysioPacket


COACH_MESSAGES = {
    "good_form": "Great control. Keep that same pace.",
    "almost_there": "Almost there. Raise your arm a little higher.",
    "too_fast": "Slow down and control the movement.",
    "too_jittery": "Keep your arm steady and move smoothly.",
    "hold_longer": "Hold at the top for one more second.",
    "low_confidence": "Adjust your position so I can see your arm.",
    "rest_needed": "Take a short rest before the next rep.",
    "session_complete": "Session complete. Nice steady work.",
    "error": "Something went wrong. Check the sensor or camera."
}


class MockCoachProvider(CoachProvider):
    def generate_cue(self, packet: PhysioPacket) -> CoachCue:
        return CoachCue(
            coach_state=packet.coach_state,
            message=clean_coach_text(COACH_MESSAGES.get(packet.coach_state, packet.local_coach_message)),
            source="mock"
        )
