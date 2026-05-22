from __future__ import annotations

import json
import math
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class FakeSensorHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/sensor/latest":
            self.send_response(404)
            self.end_headers()
            return

        elapsed = time.time()
        wave = (1 - math.cos((elapsed % 6) / 6 * math.tau)) / 2
        jitter = 0.16 + 0.08 * math.sin(elapsed * 3)
        packet = {
            "device_id": "sensor-fake-001",
            "timestamp_ms": int(time.time() * 1000),
            "sensor_status": "ok",
            "recording_active": True,
            "distance_cm": round(56 - wave * 13, 2),
            "sensor_jitter_score": round(max(0, min(1, jitter)), 3),
            "sensor_jitter_detected": jitter > 0.65,
            "sample_rate_hz": 20
        }
        body = json.dumps(packet).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:
        return


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 8010), FakeSensorHandler)
    print("Fake sensor server running at http://localhost:8010/sensor/latest")
    server.serve_forever()
