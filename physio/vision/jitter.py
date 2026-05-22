from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field


@dataclass
class MotionQualityTracker:
    max_samples: int = 18
    too_fast_deg_per_sec: float = 150.0
    too_slow_deg_per_sec: float = 8.0
    samples: deque[tuple[float, float]] = field(default_factory=deque)

    def reset(self) -> None:
        self.samples.clear()

    def update(self, timestamp_sec: float, shoulder_angle: float) -> dict:
        self.samples.append((timestamp_sec, shoulder_angle))
        while len(self.samples) > self.max_samples:
            self.samples.popleft()

        if len(self.samples) < 3:
            return {"angular_velocity": 0.0, "opencv_jitter_score": 0.0, "pace": "unknown"}

        velocities = []
        for (t0, a0), (t1, a1) in zip(self.samples, list(self.samples)[1:]):
            dt = max(t1 - t0, 0.001)
            velocities.append((a1 - a0) / dt)

        latest_velocity = velocities[-1]
        abs_velocity = abs(latest_velocity)
        velocity_changes = [
            abs(v1 - v0)
            for v0, v1 in zip(velocities, velocities[1:])
        ]
        average_change = sum(velocity_changes) / max(len(velocity_changes), 1)
        jitter_score = max(0.0, min(1.0, average_change / 240.0))

        if abs_velocity > self.too_fast_deg_per_sec:
            pace = "too_fast"
        elif abs_velocity < self.too_slow_deg_per_sec:
            pace = "too_slow"
        else:
            pace = "good"

        return {
            "angular_velocity": latest_velocity,
            "opencv_jitter_score": round(jitter_score, 3),
            "pace": pace
        }
