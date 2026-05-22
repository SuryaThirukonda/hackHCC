from __future__ import annotations

from dataclasses import dataclass


@dataclass
class AvatarResult:
    status: str
    avatar_session_id: str | None = None
    avatar_url: str | None = None
    error_message: str | None = None


class MockAvatarProvider:
    def speak(self, text: str, optional_audio_path: str | None = None) -> AvatarResult:
        return AvatarResult(status="idle")


def get_avatar_provider() -> MockAvatarProvider:
    return MockAvatarProvider()
