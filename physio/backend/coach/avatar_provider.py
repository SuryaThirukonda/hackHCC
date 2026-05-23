from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

from coach.http_errors import env_secret, provider_http_error

# HeyGen video status poll endpoint (v1 status API)
_HEYGEN_STATUS_URL = "https://api.heygen.com/v1/video_status.get"


@dataclass
class AvatarResult:
    status: str
    avatar_session_id: str | None = None
    avatar_url: str | None = None
    error_message: str | None = None
    generate_time_ms: int | None = None


class MockAvatarProvider:
    def speak(
        self,
        text: str,
        optional_audio_path: str | None = None,
        optional_audio_url: str | None = None,
    ) -> AvatarResult:
        return AvatarResult(status="mock")


class HeyGenAvatarProvider:
    def __init__(self) -> None:
        self.api_key = env_secret("HEYGEN_API_KEY")
        self.avatar_id = env_secret("HEYGEN_AVATAR_ID")
        self.voice_id = env_secret("HEYGEN_VOICE_ID")
        self.timeout_sec = float(os.getenv("HEYGEN_TIMEOUT_SEC", "10"))
        self.api_url = os.getenv("HEYGEN_API_URL", "https://api.heygen.com/v2/video/generate")
        self.use_audio_source = os.getenv("HEYGEN_USE_ELEVENLABS_AUDIO", "false").lower() in {"1", "true", "yes"}
        self.fallback = MockAvatarProvider()

    def speak(
        self,
        text: str,
        optional_audio_path: str | None = None,
        optional_audio_url: str | None = None,
    ) -> AvatarResult:
        if not self.api_key or not self.avatar_id:
            result = self.fallback.speak(text, optional_audio_path, optional_audio_url)
            result.status = "mock_missing_heygen_key"
            return result

        voice = self._voice_payload(text, optional_audio_url)

        body = json.dumps({
            "video_inputs": [{
                "character": {
                    "type": "avatar",
                    "avatar_id": self.avatar_id,
                    "avatar_style": "normal",
                },
                "voice": voice,
            }],
            "dimension": {"width": 720, "height": 720},
        }).encode("utf-8")
        request = urllib.request.Request(
            self.api_url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Api-Key": self.api_key,
            },
        )
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_sec) as response:
                payload = json.loads(response.read().decode("utf-8"))
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            data = payload.get("data") or {}
            print(f"[HeyGen] generate call took {elapsed_ms}ms — video_id={data.get('video_id')}")
            return AvatarResult(
                status="queued",
                avatar_session_id=data.get("video_id"),
                avatar_url=data.get("video_url") or data.get("share_url"),
                generate_time_ms=elapsed_ms,
            )
        except urllib.error.HTTPError as exc:
            result = self.fallback.speak(text, optional_audio_path, optional_audio_url)
            result.status = "mock_heygen_error"
            result.error_message = provider_http_error(exc, "heygen")
            return result
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
            result = self.fallback.speak(text, optional_audio_path, optional_audio_url)
            result.status = "mock_heygen_error"
            result.error_message = str(exc)
            return result

    def poll_video_status(self, video_id: str) -> dict:
        """
        Poll HeyGen's video status endpoint for a previously queued video_id.
        Returns a dict with: status, video_url, thumbnail_url, duration, error
        HeyGen statuses: pending | processing | completed | failed
        """
        if not self.api_key:
            return {"status": "error", "error": "missing_api_key"}

        url = f"{_HEYGEN_STATUS_URL}?video_id={video_id}"
        req = urllib.request.Request(
            url,
            method="GET",
            headers={"X-Api-Key": self.api_key},
        )
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_sec) as response:
                payload = json.loads(response.read().decode("utf-8"))
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            data = payload.get("data") or {}
            heygen_status = data.get("status", "unknown")
            video_url = data.get("video_url") or data.get("share_url")
            print(f"[HeyGen] poll status={heygen_status} for {video_id} ({elapsed_ms}ms)")
            return {
                "status": heygen_status,
                "video_url": video_url,
                "thumbnail_url": data.get("thumbnail_url"),
                "duration": data.get("duration"),
                "error": data.get("error") or payload.get("message"),
                "poll_time_ms": elapsed_ms,
            }
        except urllib.error.HTTPError as exc:
            return {"status": "error", "error": provider_http_error(exc, "heygen")}
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
            return {"status": "error", "error": str(exc)}

    def _voice_payload(self, text: str, optional_audio_url: str | None) -> dict[str, str]:
        if self.use_audio_source and optional_audio_url:
            return {
                "type": "audio",
                "audio_url": optional_audio_url,
            }

        voice: dict[str, str] = {"type": "text", "input_text": text}
        # Include voice_id only if explicitly configured (not a placeholder)
        if self.voice_id and self.voice_id != "PASTE_HEYGEN_VOICE_ID_HERE":
            voice["voice_id"] = self.voice_id
        return voice


def get_avatar_provider() -> MockAvatarProvider | HeyGenAvatarProvider:
    provider = os.getenv("AVATAR_PROVIDER", "mock").lower()
    if provider == "heygen":
        return HeyGenAvatarProvider()
    return MockAvatarProvider()
