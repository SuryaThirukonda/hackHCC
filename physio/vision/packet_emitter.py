from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request


class PacketEmitter:
    def __init__(self, backend_url: str | None = None, enabled: bool = True) -> None:
        self.backend_url = (backend_url or os.getenv("PHYSIO_BACKEND_URL", "http://localhost:8000")).rstrip("/")
        self.enabled = enabled
        self.last_error_at = 0.0

    def emit(self, packet: dict) -> bool:
        print(json.dumps(packet, separators=(",", ":")))
        if not self.enabled:
            return False

        body = json.dumps(packet).encode("utf-8")
        request = urllib.request.Request(
            f"{self.backend_url}/api/packets",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=0.35):
                return True
        except (urllib.error.URLError, TimeoutError):
            now = time.time()
            if now - self.last_error_at > 5:
                print(f"Backend unavailable at {self.backend_url}; continuing locally.")
                self.last_error_at = now
            return False

    def emit_frame(self, jpeg_bytes: bytes) -> bool:
        if not self.enabled:
            return False

        request = urllib.request.Request(
            f"{self.backend_url}/api/vision/frame",
            data=jpeg_bytes,
            headers={"Content-Type": "image/jpeg"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=0.25):
                return True
        except (urllib.error.URLError, TimeoutError):
            return False
