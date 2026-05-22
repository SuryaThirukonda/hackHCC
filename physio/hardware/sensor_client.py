from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass


@dataclass
class SensorClient:
    endpoint: str = os.getenv("SENSOR_ENDPOINT", "http://localhost:8010/sensor/latest")
    timeout_sec: float = 1.0

    def latest(self) -> dict:
        try:
            with urllib.request.urlopen(self.endpoint, timeout=self.timeout_sec) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            return offline_sensor_packet()


def offline_sensor_packet() -> dict:
    return {
        "device_id": "sensor-offline",
        "timestamp_ms": int(time.time() * 1000),
        "sensor_status": "offline",
        "recording_active": False,
        "distance_cm": None,
        "sensor_jitter_score": 0,
        "sensor_jitter_detected": False,
        "sample_rate_hz": 0,
        "error_message": "Sensor endpoint unavailable"
    }


if __name__ == "__main__":
    print(json.dumps(SensorClient().latest(), indent=2))
