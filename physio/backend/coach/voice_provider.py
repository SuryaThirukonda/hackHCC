from __future__ import annotations

import os
import uuid
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path


@dataclass
class VoiceResult:
    status: str
    audio_url: str | None = None
    local_file_path: str | None = None
    error_message: str | None = None


class MockVoiceProvider:
    def synthesize(self, text: str) -> VoiceResult:
        return VoiceResult(status="mock")


class ElevenLabsVoiceProvider:
    def __init__(self, audio_dir: Path | None = None) -> None:
        self.api_key = _env_secret("ELEVENLABS_API_KEY")
        self.voice_id = _env_secret("ELEVENLABS_VOICE_ID")
        self.model_id = os.getenv("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2")
        self.timeout_sec = float(os.getenv("ELEVENLABS_TIMEOUT_SEC", "4"))
        self.audio_dir = audio_dir or Path(__file__).resolve().parents[1] / "data" / "audio"
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        self.fallback = MockVoiceProvider()

    def synthesize(self, text: str) -> VoiceResult:
        if not self.api_key or not self.voice_id:
            result = self.fallback.synthesize(text)
            result.status = "mock_missing_elevenlabs_key"
            return result

        url = f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}"
        body = (
            "{"
            f"\"text\":{_json_string(text)},"
            f"\"model_id\":{_json_string(self.model_id)},"
            "\"voice_settings\":{\"stability\":0.55,\"similarity_boost\":0.75}"
            "}"
        ).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Accept": "audio/mpeg",
                "Content-Type": "application/json",
                "xi-api-key": self.api_key,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_sec) as response:
                audio_bytes = response.read()
            filename = f"coach-{uuid.uuid4().hex}.mp3"
            path = self.audio_dir / filename
            path.write_bytes(audio_bytes)
            return VoiceResult(
                status="ready",
                audio_url=f"/static/audio/{filename}",
                local_file_path=str(path),
            )
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            result = self.fallback.synthesize(text)
            result.status = "mock_elevenlabs_error"
            result.error_message = str(exc)
            return result


def get_voice_provider() -> MockVoiceProvider | ElevenLabsVoiceProvider:
    provider = os.getenv("VOICE_PROVIDER", "mock").lower()
    if provider == "elevenlabs":
        return ElevenLabsVoiceProvider()
    return MockVoiceProvider()


def _env_secret(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    if not value or value.startswith("your_"):
        return None
    return value


def _json_string(value: str) -> str:
    import json

    return json.dumps(value)
