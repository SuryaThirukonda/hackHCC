from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

# EMA alpha: higher = follows raw signal faster but noisier.
# 0.40 gives a good balance between responsiveness and smoothness for 15-30 Hz pose data.
_EMA_ALPHA = 0.40


@dataclass
class MotionQualityTracker:
    # More samples → steadier jitter estimate; 26 ≈ 1.5–2 s at 15 Hz.
    max_samples: int = 26
    too_fast_deg_per_sec: float = 150.0
    too_slow_deg_per_sec: float = 8.0
    # Raw (timestamp, angle) pairs kept only for timing
    samples: deque[tuple[float, float]] = field(default_factory=deque)
    # EMA-smoothed angle history used for velocity / jitter calculation
    ema_samples: deque[tuple[float, float]] = field(default_factory=deque)
    _ema_angle: float | None = field(default=None, init=False)

    def reset(self) -> None:
        self.samples.clear()
        self.ema_samples.clear()
        self._ema_angle = None

    def update(self, timestamp_sec: float, shoulder_angle: float) -> dict:
        # --- EMA smoothing pass ---
        if self._ema_angle is None:
            self._ema_angle = shoulder_angle
        else:
            self._ema_angle = _EMA_ALPHA * shoulder_angle + (1.0 - _EMA_ALPHA) * self._ema_angle

        self.samples.append((timestamp_sec, shoulder_angle))
        self.ema_samples.append((timestamp_sec, self._ema_angle))
        while len(self.samples) > self.max_samples:
            self.samples.popleft()
        while len(self.ema_samples) > self.max_samples:
            self.ema_samples.popleft()

        if len(self.ema_samples) < 3:
            return {"angular_velocity": 0.0, "opencv_jitter_score": 0.0, "pace": "unknown"}

        # Velocities computed on EMA-smoothed angles — eliminates single-frame landmark bounce
        ema_list = list(self.ema_samples)
        velocities = []
        for (t0, a0), (t1, a1) in zip(ema_list, ema_list[1:]):
            dt = max(t1 - t0, 0.001)
            velocities.append((a1 - a0) / dt)

        latest_velocity = velocities[-1]
        abs_velocity = abs(latest_velocity)
        velocity_changes = [abs(v1 - v0) for v0, v1 in zip(velocities, velocities[1:])]
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
            "pace": pace,
        }
