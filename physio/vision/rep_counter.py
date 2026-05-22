from __future__ import annotations

from dataclasses import dataclass
import time


@dataclass
class RepCounter:
    target_angle: float = 90
    rest_angle_threshold: float = 30
    target_tolerance: float = 8
    rep_count: int = 0
    phase: str = "idle"
    has_reached_target: bool = False
    hold_started_at: float | None = None
    hold_time_sec: float = 0.0

    def invalidate(self) -> None:
        self.phase = "idle"
        self.has_reached_target = False
        self.hold_started_at = None
        self.hold_time_sec = 0.0

    def update(self, shoulder_angle: float) -> str:
        if shoulder_angle < self.rest_angle_threshold:
            if self.has_reached_target:
                self.rep_count += 1
                self.phase = "rep_complete"
                self.has_reached_target = False
                self.hold_started_at = None
                self.hold_time_sec = 0.0
                return self.phase
            self.phase = "resting"
            self.hold_started_at = None
            self.hold_time_sec = 0.0
            return self.phase

        if shoulder_angle >= self.target_angle - self.target_tolerance:
            self.has_reached_target = True
            self.phase = "holding"
            if self.hold_started_at is None:
                self.hold_started_at = time.time()
            self.hold_time_sec = time.time() - self.hold_started_at
            return self.phase

        self.hold_started_at = None
        self.hold_time_sec = 0.0
        self.phase = "raising" if not self.has_reached_target else "lowering"
        return self.phase
