from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass


@dataclass
class AvatarResult:
    status: str
    avatar_session_id: str | None = None
    avatar_url: str | None = None
    error_message: str | None = None


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
        self.api_key = _env_secret("HEYGEN_API_KEY")
        self.avatar_id = _env_secret("HEYGEN_AVATAR_ID")
        self.voice_id = _env_secret("HEYGEN_VOICE_ID")
        self.timeout_sec = float(os.getenv("HEYGEN_TIMEOUT_SEC", "4"))
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
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_sec) as response:
                payload = json.loads(response.read().decode("utf-8"))
            data = payload.get("data") or {}
            return AvatarResult(
                status="queued",
                avatar_session_id=data.get("video_id"),
                avatar_url=data.get("video_url") or data.get("share_url"),
            )
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
            result = self.fallback.speak(text, optional_audio_path, optional_audio_url)
            result.status = "mock_heygen_error"
            result.error_message = str(exc)
            return result

    def _voice_payload(self, text: str, optional_audio_url: str | None) -> dict[str, str]:
        if self.use_audio_source and optional_audio_url:
            return {
                "type": "audio",
                "audio_url": optional_audio_url,
            }

        voice: dict[str, str] = {"type": "text", "input_text": text}
        if self.voice_id:
            voice["voice_id"] = self.voice_id
        return voice


def get_avatar_provider() -> MockAvatarProvider | HeyGenAvatarProvider:
    provider = os.getenv("AVATAR_PROVIDER", "mock").lower()
    if provider == "heygen":
        return HeyGenAvatarProvider()
    return MockAvatarProvider()


def _env_secret(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    if not value or value.startswith("your_"):
        return None
    return value
