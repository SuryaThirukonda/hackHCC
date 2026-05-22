from __future__ import annotations


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def calculate_physio_score(
    shoulder_angle: float | None,
    target_angle: float,
    combined_jitter_score: float,
    pace: str,
    hold_time_sec: float,
    landmark_confidence: float,
    compensation: str = "none",
) -> int | None:
    if shoulder_angle is None:
        return None
    range_score = min(shoulder_angle / max(target_angle, 1), 1.0) * 35
    smoothness_score = (1 - clamp(combined_jitter_score, 0, 1)) * 25
    pace_score = {"good": 15, "too_slow": 8, "too_fast": 5, "unknown": 8}.get(pace, 8)
    hold_score = min(hold_time_sec / 2.0, 1.0) * 15
    confidence_score = clamp(landmark_confidence, 0, 1) * 10
    penalty = {"none": 0, "shoulder_shrug": 8, "torso_lean": 8, "low_confidence": 10}.get(compensation, 0)
    return round(clamp(range_score + smoothness_score + pace_score + hold_score + confidence_score - penalty, 0, 100))


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


def range_status_for_angle(shoulder_angle: float | None, target_angle: float) -> str:
    if shoulder_angle is None:
        return "unknown"
    if shoulder_angle >= target_angle + 10:
        return "overextended"
    if shoulder_angle >= target_angle:
        return "target_met"
    if shoulder_angle >= target_angle - 15:
        return "almost_there"
    if shoulder_angle < 20:
        return "below_start"
    return "too_low"


def choose_coach_state(
    camera_status: str,
    landmark_confidence: float,
    combined_jitter_score: float,
    pace: str,
    range_status: str,
    rep_phase: str,
    hold_time_sec: float,
    rep_count: int,
    target_reps: int = 8,
) -> str:
    if camera_status != "ok":
        return "low_confidence"
    if landmark_confidence < 0.45:
        return "low_confidence"
    if combined_jitter_score > 0.65:
        return "too_jittery"
    if pace == "too_fast":
        return "too_fast"
    if range_status in {"almost_there", "too_low"}:
        return "almost_there"
    if rep_phase == "holding" and hold_time_sec < 2.0:
        return "hold_longer"
    if rep_count >= target_reps:
        return "session_complete"
    return "good_form"
