from __future__ import annotations

from coach.base import CoachCue, CoachProvider
from schemas import PhysioPacket


COACH_MESSAGES = {
    "good_form": "Great control. Keep that same pace.",
    "almost_there": "Almost there. Raise your arm a little higher.",
    "too_fast": "Slow down and control the movement.",
    "too_jittery": "Keep your arm steady and move smoothly.",
    "hold_longer": "Hold at the top for one more second.",
    "low_confidence": "Move your full arm into view.",
    "rest_needed": "Take a short rest before the next rep.",
    "session_complete": "Session complete. Nice steady work.",
    "error": "Something went wrong. Check the sensor or camera."
}

ELBOW_COACH_MESSAGES = {
    **COACH_MESSAGES,
    "good_form": "Good control. Keep the same pace.",
    "almost_there": "Bend your elbow a little more.",
    "bend_more": "Bend your elbow a little more.",
    "straighten_more": "Straighten your arm fully.",
    "hold_longer": "Hold the bend briefly.",
    "keep_upper_arm_still": "Keep your upper arm still.",
    "rep_complete": "Good rep.",
}


def coach_message_for_packet(packet: PhysioPacket) -> str:
    messages = ELBOW_COACH_MESSAGES if packet.exercise == "elbow_flexion_extension" else COACH_MESSAGES
    return messages.get(packet.coach_state, packet.local_coach_message)


class MockCoachProvider(CoachProvider):
    def generate_cue(self, packet: PhysioPacket) -> CoachCue:
        return CoachCue(
            coach_state=packet.coach_state,
            message=coach_message_for_packet(packet),
            source="mock"
        )
