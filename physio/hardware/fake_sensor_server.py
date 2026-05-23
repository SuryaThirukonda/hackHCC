from __future__ import annotations

import json
import math
import time
import asyncio
from threading import Thread
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import websockets
except ImportError:  # pragma: no cover - optional local demo dependency
    websockets = None


def build_sensor_packet() -> dict:
    elapsed = time.time()
    wave = (1 - math.cos((elapsed % 6) / 6 * math.tau)) / 2
    jitter = 0.16 + 0.08 * math.sin(elapsed * 3)
    return {
        "device_id": "sensor-fake-001",
        "timestamp_ms": int(time.time() * 1000),
        "sensor_status": "ok",
        "recording_active": True,
        "distance_cm": round(56 - wave * 13, 2),
        "sensor_jitter_score": round(max(0, min(1, jitter)), 3),
        "sensor_jitter_detected": jitter > 0.65,
        "sample_rate_hz": 20
    }


def build_sensor_line() -> str:
    return f"Distance: {build_sensor_packet()['distance_cm']:.2f} cm"


class FakeSensorHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/sensor/latest":
            self.send_response(404)
            self.end_headers()
            return

        packet = build_sensor_packet()
        body = json.dumps(packet).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:
        return


def parse_command(message: str) -> str | None:
    text = message.strip().lower()
    if text in {"start", "stop"}:
        return text
    try:
        payload = json.loads(message)
    except json.JSONDecodeError:
        return None
    command = str(payload.get("command", "")).lower()
    return command if command in {"start", "stop"} else None


async def fake_sensor_websocket(websocket) -> None:
    streaming = False
    try:
        while True:
            try:
                message = await asyncio.wait_for(websocket.recv(), timeout=0.05)
                command = parse_command(message)
                if command == "start":
                    streaming = True
                    await websocket.send(json.dumps({"status": "streaming_started"}))
                elif command == "stop":
                    streaming = False
                    await websocket.send(json.dumps({"status": "streaming_stopped"}))
            except asyncio.TimeoutError:
                if streaming:
                    await websocket.send(build_sensor_line())
    except websockets.ConnectionClosed:
        return


async def run_websocket_server() -> None:
    if websockets is None:
        print("Install websockets to enable ws://localhost:8765 fake sensor streaming")
        return
    async with websockets.serve(fake_sensor_websocket, "0.0.0.0", 8765):
        print("Fake sensor websocket running at ws://localhost:8765")
        await asyncio.Future()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 8010), FakeSensorHandler)
    print("Fake sensor server running at http://localhost:8010/sensor/latest")
    if websockets is None:
        print("Install websockets to enable ws://localhost:8765 fake sensor streaming")
        server.serve_forever()
        raise SystemExit
    Thread(target=server.serve_forever, daemon=True).start()
    asyncio.run(run_websocket_server())
