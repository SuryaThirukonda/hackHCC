from __future__ import annotations


STATE_COLORS = {
    "good_form": (86, 216, 167),
    "session_complete": (86, 216, 167),
    "almost_there": (95, 185, 244),
    "hold_longer": (95, 185, 244),
    "too_fast": (100, 116, 255),
    "too_jittery": (100, 116, 255),
    "low_confidence": (100, 116, 255),
    "error": (100, 116, 255),
}


def format_overlay_lines(packet: dict, fps: float = 0.0, data_status: str = "real") -> list[str]:
    shoulder = packet.get("shoulder_angle")
    elbow = packet.get("elbow_angle")
    shoulder_text = "--" if shoulder is None else f"{shoulder:.1f}"
    elbow_text = "--" if elbow is None else f"{elbow:.1f}"
    score = packet.get("physio_score")
    score_text = "--" if score is None else str(score)
    return [
        f"Physio | {data_status.upper()} | FPS {fps:.1f}",
        f"Shoulder: {shoulder_text} deg",
        f"Elbow: {elbow_text} deg",
        f"Target: {packet.get('target_angle', 90):.1f} deg",
        f"Rep: {packet.get('rep_count', 0)} / Phase: {packet.get('rep_phase', 'idle')}",
        f"Score: {score_text} | State: {packet.get('coach_state', 'unknown')}",
        f"Pace: {packet.get('pace', 'unknown')} | Jitter: {packet.get('opencv_jitter_score', 0):.2f}",
        packet.get("local_coach_message", "")
    ]


def draw_text_panel(frame, lines: list[str]) -> None:
    import cv2

    x, y = 18, 26
    line_height = 25
    width = 520
    height = line_height * len(lines) + 20
    overlay = frame.copy()
    cv2.rectangle(overlay, (10, 10), (10 + width, 10 + height), (15, 17, 16), -1)
    cv2.addWeighted(overlay, 0.72, frame, 0.28, 0, frame)
    for index, line in enumerate(lines):
        color = (86, 216, 167) if index == 0 else (244, 241, 232)
        cv2.putText(frame, line, (x, y + index * line_height), cv2.FONT_HERSHEY_SIMPLEX, 0.62, color, 2, cv2.LINE_AA)


def draw_target_arc(frame, shoulder_xy: tuple[int, int], target_angle: float, current_angle: float, coach_state: str) -> None:
    import cv2

    color = STATE_COLORS.get(coach_state, (244, 241, 232))
    radius = 92
    center = shoulder_xy
    cv2.ellipse(frame, center, (radius, radius), 0, -100, -35, (70, 80, 78), 2, cv2.LINE_AA)
    cv2.ellipse(frame, center, (radius, radius), 0, -target_angle - 8, -target_angle + 8, (86, 216, 167), 5, cv2.LINE_AA)
    end_x = int(center[0] + radius * 0.85)
    cv2.line(frame, center, (end_x, center[1]), (80, 80, 80), 1, cv2.LINE_AA)
    cv2.putText(frame, f"{current_angle:.0f}/{target_angle:.0f}", (center[0] + 16, center[1] - 16), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2, cv2.LINE_AA)


def draw_landmark(frame, point: tuple[int, int], color: tuple[int, int, int], radius: int = 7) -> None:
    import cv2

    cv2.circle(frame, point, radius + 3, (10, 10, 10), -1, cv2.LINE_AA)
    cv2.circle(frame, point, radius, color, -1, cv2.LINE_AA)
