from __future__ import annotations

import math
import time

from packet_merge import apply_local_rules
from schemas import PhysioPacket


class MockPacketGenerator:
    def __init__(self) -> None:
        self.started = time.time()

    def next_packet(self, session_id: str = "mock-session", target_angle: float = 90) -> PhysioPacket:
        elapsed = time.time() - self.started
        cycle = (elapsed % 6.0) / 6.0
        wave = (1 - math.cos(cycle * math.tau)) / 2
        shoulder_angle = 18 + wave * 82
        elbow_angle = 168 - wave * 12
        rep_count = int(elapsed // 6)

        if cycle < 0.18:
            rep_phase = "resting"
        elif cycle < 0.45:
            rep_phase = "raising"
        elif cycle < 0.62:
            rep_phase = "holding"
        elif cycle < 0.88:
            rep_phase = "lowering"
        else:
            rep_phase = "rep_complete"

        hold_time = max(0.0, (cycle - 0.45) * 6) if rep_phase == "holding" else 0.0
        sensor_jitter = 0.2 + 0.08 * math.sin(elapsed * 2.3)
        opencv_jitter = 0.12 + 0.08 * math.sin(elapsed * 3.7)
        pace = "good"
        if int(elapsed) % 17 in {12, 13}:
            pace = "too_fast"
        if int(elapsed) % 23 in {5, 6}:
            sensor_jitter = 0.72
            opencv_jitter = 0.67

        if shoulder_angle >= target_angle + 8:
            range_status = "overextended"
        elif shoulder_angle >= target_angle:
            range_status = "target_met"
        elif shoulder_angle >= target_angle - 16:
            range_status = "almost_there"
        elif shoulder_angle < 25:
            range_status = "below_start"
        else:
            range_status = "too_low"

        packet = PhysioPacket(
            session_id=session_id,
            timestamp_ms=int(time.time() * 1000),
            exercise="right_arm_raise",
            side="right",
            device_id="sensor-mock",
            sensor_status="ok",
            camera_status="ok",
            distance_cm=round(55 - wave * 14 + math.sin(elapsed) * 0.8, 2),
            sensor_jitter_score=round(max(0, min(1, sensor_jitter)), 3),
            opencv_jitter_score=round(max(0, min(1, opencv_jitter)), 3),
            combined_jitter_score=0,
            jitter_detected=False,
            shoulder_angle=round(shoulder_angle, 1),
            elbow_angle=round(elbow_angle, 1),
            target_angle=target_angle,
            landmark_confidence=round(0.88 + 0.08 * math.sin(elapsed / 3), 2),
            rep_count=rep_count,
            rep_phase=rep_phase,
            hold_time_sec=round(hold_time, 1),
            pace=pace,
            range_status=range_status,
            compensation="none",
            physio_score=0,
            coach_state="good_form",
            local_coach_message="Great control. Keep that same pace.",
        )
        return apply_local_rules(packet)
