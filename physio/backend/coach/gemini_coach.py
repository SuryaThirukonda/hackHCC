from __future__ import annotations

import os

from coach.base import CoachCue, CoachProvider
from coach.mock_coach import MockCoachProvider
from schemas import PhysioPacket


class GeminiCoachProvider(CoachProvider):
    """Future Gemini adapter with a safe mock fallback for BC-0."""

    def __init__(self) -> None:
        self.api_key = os.getenv("GEMINI_API_KEY")
        self.fallback = MockCoachProvider()

    def generate_cue(self, packet: PhysioPacket) -> CoachCue:
        if not self.api_key:
            cue = self.fallback.generate_cue(packet)
            cue.source = "mock"
            return cue

        # Real Gemini calls are intentionally left for Prompt C-2.
        cue = self.fallback.generate_cue(packet)
        cue.source = "mock"
        return cue
