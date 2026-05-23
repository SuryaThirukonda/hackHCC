from __future__ import annotations

from coach.mock_coach import coach_message_for_packet
from schemas import PhysioPacket, PosePacket, SensorPacket


REQUIRED_HOLD_TIME_SEC = 2.0
TARGET_REPS = 8
LOCAL_ANALYZED_EXERCISES = {"elbow_flexion_extension", "seated_one_arm_forward_press"}


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def calculate_physio_score(packet: PhysioPacket) -> int | None:
    if packet.exercise in LOCAL_ANALYZED_EXERCISES and packet.physio_score is not None:
        return packet.physio_score
    if packet.shoulder_angle is None or packet.elbow_angle is None or packet.camera_status != "ok":
        return None
    target = max(packet.target_angle, 1)
    range_score = min(packet.shoulder_angle / target, 1.0) * 35
    smoothness_score = (1 - clamp(packet.combined_jitter_score, 0, 1)) * 25
    pace_score = {"good": 15, "too_slow": 8, "too_fast": 5, "unknown": 8}[packet.pace]
    hold_score = min(packet.hold_time_sec / REQUIRED_HOLD_TIME_SEC, 1.0) * 15
    confidence_score = packet.landmark_confidence * 10
    compensation_penalty = {
        "none": 0,
        "shoulder_shrug": 8,
        "torso_lean": 8,
        "low_confidence": 10,
        "unknown": 0
    }[packet.compensation]
    return int(round(clamp(
        range_score + smoothness_score + pace_score + hold_score + confidence_score - compensation_penalty,
        0,
        100
    )))


def choose_coach_state(packet: PhysioPacket) -> str:
    if packet.exercise in LOCAL_ANALYZED_EXERCISES:
        if (
            packet.camera_status != "ok"
            or packet.elbow_angle is None
            or packet.landmark_confidence < 0.45
        ):
            return "low_confidence"
        if packet.coach_state:
            return packet.coach_state
    if packet.sensor_status == "error":
        return "error"
    if (
        packet.camera_status != "ok"
        or packet.shoulder_angle is None
        or packet.elbow_angle is None
        or packet.landmark_confidence < 0.45
    ):
        return "low_confidence"
    if packet.combined_jitter_score > 0.65:
        return "too_jittery"
    if packet.pace == "too_fast":
        return "too_fast"
    if packet.range_status in {"almost_there", "too_low"}:
        return "almost_there"
    if packet.rep_phase == "holding" and packet.hold_time_sec < REQUIRED_HOLD_TIME_SEC:
        return "hold_longer"
    if packet.rep_count >= TARGET_REPS:
        return "session_complete"
    return "good_form"


def apply_local_rules(packet: PhysioPacket) -> PhysioPacket:
    combined = max(packet.combined_jitter_score, (packet.sensor_jitter_score + packet.opencv_jitter_score) / 2)
    update = {
        "combined_jitter_score": round(combined, 3),
        "jitter_detected": combined > 0.65,
    }
    provisional = packet.model_copy(update=update)
    coach_state = choose_coach_state(provisional)
    provisional = provisional.model_copy(update={"coach_state": coach_state})
    provisional = provisional.model_copy(update={"local_coach_message": coach_message_for_packet(provisional)})
    score = calculate_physio_score(provisional)
    return provisional.model_copy(update={"physio_score": score})


def merge_packets(
    session_id: str,
    pose: PosePacket,
    sensor: SensorPacket,
    target_angle: float = 90,
) -> PhysioPacket:
    combined_jitter = (sensor.sensor_jitter_score + pose.opencv_jitter_score) / 2
    packet = PhysioPacket(
        session_id=session_id,
        timestamp_ms=max(pose.timestamp_ms, sensor.timestamp_ms),
        exercise=pose.exercise,
        side=pose.side,
        device_id=sensor.device_id,
        sensor_status=sensor.sensor_status,
        camera_status=pose.camera_status,
        distance_cm=sensor.distance_cm,
        sensor_jitter_score=sensor.sensor_jitter_score,
        opencv_jitter_score=pose.opencv_jitter_score,
        combined_jitter_score=combined_jitter,
        jitter_detected=sensor.sensor_jitter_detected or combined_jitter > 0.65,
        shoulder_angle=pose.shoulder_angle,
        elbow_angle=pose.elbow_angle,
        target_angle=target_angle,
        landmark_confidence=pose.landmark_confidence,
        rep_count=pose.rep_count,
        rep_phase=pose.rep_phase,
        hold_time_sec=pose.hold_time_sec,
        pace=pose.pace,
        range_status=pose.range_status,
        compensation=pose.compensation,
        physio_score=0,
        coach_state="good_form",
        local_coach_message="Great control. Keep that same pace.",
    )
    return apply_local_rules(packet)
