from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from schemas import PhysioPacket


@dataclass
class CoachCue:
    coach_state: str
    message: str
    source: str


class CoachProvider(ABC):
    @abstractmethod
    def generate_cue(self, packet: PhysioPacket) -> CoachCue:
        """Return a short coaching cue for a final Physio packet."""
