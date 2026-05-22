from __future__ import annotations

from dataclasses import dataclass


@dataclass
class VoiceResult:
    status: str
    audio_url: str | None = None
    local_file_path: str | None = None
    error_message: str | None = None


class MockVoiceProvider:
    def synthesize(self, text: str) -> VoiceResult:
        return VoiceResult(status="idle")


def get_voice_provider() -> MockVoiceProvider:
    return MockVoiceProvider()
