from __future__ import annotations

import math
from typing import NamedTuple


class Point(NamedTuple):
    x: float
    y: float


def calculate_angle(a: Point | None, b: Point | None, c: Point | None) -> float | None:
    """Calculate the smaller angle at vertex b from three 2D points."""
    if a is None or b is None or c is None:
        return None
    ba = (a.x - b.x, a.y - b.y)
    bc = (c.x - b.x, c.y - b.y)
    dot = ba[0] * bc[0] + ba[1] * bc[1]
    mag_ba = math.hypot(*ba)
    mag_bc = math.hypot(*bc)
    if mag_ba == 0 or mag_bc == 0:
        return None
    cosine = max(-1.0, min(1.0, dot / (mag_ba * mag_bc)))
    return math.degrees(math.acos(cosine))


def elbow_angle(shoulder: Point | None, elbow: Point | None, wrist: Point | None) -> float | None:
    return calculate_angle(shoulder, elbow, wrist)


def shoulder_raise_angle(hip: Point | None, shoulder: Point | None, wrist: Point | None) -> float | None:
    return calculate_angle(hip, shoulder, wrist)


def normalized_to_pixel(point: Point, width: int, height: int) -> tuple[int, int]:
    return int(point.x * width), int(point.y * height)


if __name__ == "__main__":
    right_angle = calculate_angle(Point(0, 1), Point(0, 0), Point(1, 0))
    straight = calculate_angle(Point(-1, 0), Point(0, 0), Point(1, 0))
    print({"right_angle": round(right_angle, 1), "straight": round(straight, 1)})
