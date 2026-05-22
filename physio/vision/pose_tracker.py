from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from angle_utils import Point, elbow_angle, normalized_to_pixel, shoulder_raise_angle
from jitter import MotionQualityTracker
from overlay import draw_landmark, draw_target_arc, draw_text_panel, format_overlay_lines
from packet_emitter import PacketEmitter
from rep_counter import RepCounter
from scoring import COACH_MESSAGES, calculate_physio_score, choose_coach_state, range_status_for_angle

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from hardware.sensor_client import SensorClient, offline_sensor_packet
except ImportError:
    SensorClient = None

    def offline_sensor_packet() -> dict:
        return {
            "device_id": "sensor-offline",
            "timestamp_ms": int(time.time() * 1000),
            "sensor_status": "offline",
            "recording_active": False,
            "distance_cm": None,
            "sensor_jitter_score": 0,
            "sensor_jitter_detected": False,
            "sample_rate_hz": 0,
        }


POSE_LANDMARKS = {
    "right": {"shoulder": 12, "elbow": 14, "wrist": 16, "hip": 24},
    "left": {"shoulder": 11, "elbow": 13, "wrist": 15, "hip": 23},
}


class PoseTracker:
    def __init__(
        self,
        side: str = "right",
        target_angle: float = 90.0,
        target_reps: int = 8,
        backend_url: str = "http://localhost:8000",
        post_backend: bool = True,
        use_sensor: bool = True,
    ) -> None:
        self.side = side
        self.target_angle = target_angle
        self.target_reps = target_reps
        self.backend_url = backend_url.rstrip("/")
        self.rep_counter = RepCounter(target_angle=target_angle)
        self.motion = MotionQualityTracker()
        self.emitter = PacketEmitter(self.backend_url, enabled=post_backend)
        self.sensor_client = SensorClient() if SensorClient and use_sensor else None
        self.last_session_fetch_at = 0.0
        self.session_id = "opencv-live"

    def get_backend_session_id(self) -> str:
        now = time.time()
        if now - self.last_session_fetch_at < 3:
            return self.session_id
        self.last_session_fetch_at = now
        try:
            with urllib.request.urlopen(f"{self.backend_url}/api/live/source", timeout=0.25) as response:
                payload = json.loads(response.read().decode("utf-8"))
                self.session_id = payload.get("session_id") or self.session_id
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            pass
        return self.session_id

    def sensor_packet(self) -> dict:
        if self.sensor_client is None:
            return offline_sensor_packet()
        return self.sensor_client.latest()

    def build_packet(
        self,
        shoulder_angle_value: float,
        elbow_angle_value: float,
        wrist_height_relative: float,
        landmark_confidence: float,
        hand_detected: bool,
        camera_status: str,
    ) -> dict:
        now = time.time()
        quality = self.motion.update(now, shoulder_angle_value)
        rep_phase = self.rep_counter.update(shoulder_angle_value) if camera_status == "ok" else "idle"
        hold_time_sec = self.rep_counter.hold_time_sec if camera_status == "ok" else 0.0
        range_status = range_status_for_angle(shoulder_angle_value, self.target_angle) if camera_status == "ok" else "unknown"
        compensation = "none" if hand_detected and landmark_confidence >= 0.6 else "low_confidence"
        sensor = self.sensor_packet()
        sensor_jitter_score = float(sensor.get("sensor_jitter_score") or 0)
        combined_jitter_score = round((sensor_jitter_score + quality["opencv_jitter_score"]) / 2, 3)
        score = calculate_physio_score(
            shoulder_angle=shoulder_angle_value,
            target_angle=self.target_angle,
            combined_jitter_score=combined_jitter_score,
            pace=quality["pace"],
            hold_time_sec=hold_time_sec,
            landmark_confidence=landmark_confidence,
            compensation=compensation,
        )
        coach_state = choose_coach_state(
            camera_status=camera_status,
            landmark_confidence=landmark_confidence,
            combined_jitter_score=combined_jitter_score,
            pace=quality["pace"],
            range_status=range_status,
            rep_phase=rep_phase,
            hold_time_sec=hold_time_sec,
            rep_count=self.rep_counter.rep_count,
            target_reps=self.target_reps,
        )

        return {
            "session_id": self.get_backend_session_id(),
            "timestamp_ms": int(now * 1000),
            "exercise": "right_arm_raise",
            "side": self.side,
            "device_id": sensor.get("device_id", "sensor-offline"),
            "sensor_status": sensor.get("sensor_status", "offline"),
            "camera_status": camera_status,
            "distance_cm": sensor.get("distance_cm"),
            "sensor_jitter_score": sensor_jitter_score,
            "opencv_jitter_score": quality["opencv_jitter_score"],
            "combined_jitter_score": combined_jitter_score,
            "jitter_detected": bool(sensor.get("sensor_jitter_detected", False)) or combined_jitter_score > 0.65,
            "shoulder_angle": round(shoulder_angle_value, 1),
            "elbow_angle": round(elbow_angle_value, 1),
            "target_angle": self.target_angle,
            "landmark_confidence": round(landmark_confidence, 3),
            "rep_count": self.rep_counter.rep_count,
            "rep_phase": rep_phase,
            "hold_time_sec": round(hold_time_sec, 1),
            "pace": quality["pace"],
            "range_status": range_status,
            "compensation": compensation,
            "physio_score": score,
            "coach_state": coach_state,
            "local_coach_message": COACH_MESSAGES[coach_state],
            "ai_coach_message": None,
            "avatar_status": "idle",
            "voice_status": "idle",
        }

    def emit(self, packet: dict) -> bool:
        return self.emitter.emit(packet)


def landmark_point(landmarks, index: int, min_visibility: float = 0.45) -> tuple[Point | None, float]:
    landmark = landmarks[index]
    visibility = getattr(landmark, "visibility", 1.0)
    if visibility < min_visibility:
        return None, visibility
    return Point(landmark.x, landmark.y), visibility


def closest_hand_to_wrist(hand_results, wrist: Point | None) -> tuple[list[Point], float] | None:
    if not hand_results.multi_hand_landmarks:
        return None
    hands = []
    for index, hand_landmarks in enumerate(hand_results.multi_hand_landmarks):
        points = [Point(lm.x, lm.y) for lm in hand_landmarks.landmark]
        score = 1.0
        if hand_results.multi_handedness and index < len(hand_results.multi_handedness):
            score = hand_results.multi_handedness[index].classification[0].score
        distance = 0.0 if wrist is None else math.hypot(points[0].x - wrist.x, points[0].y - wrist.y)
        hands.append((distance, points, score))
    hands.sort(key=lambda item: item[0])
    return hands[0][1], hands[0][2]


def draw_hand_points(frame, hands, width: int, height: int) -> None:
    if not hands.multi_hand_landmarks:
        return
    connections = [(0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8), (0, 9), (9, 10), (10, 11), (11, 12), (0, 13), (13, 14), (14, 15), (15, 16), (0, 17), (17, 18), (18, 19), (19, 20)]
    for hand_landmarks in hands.multi_hand_landmarks:
        pixels = [normalized_to_pixel(Point(lm.x, lm.y), width, height) for lm in hand_landmarks.landmark]
        for start, end in connections:
            cv2.line(frame, pixels[start], pixels[end], (95, 185, 244), 2, cv2.LINE_AA)
        for point in pixels:
            draw_landmark(frame, point, (86, 216, 167), radius=3)


def run_self_test() -> None:
    tracker = PoseTracker(post_backend=False, use_sensor=False)
    packet = tracker.build_packet(
        shoulder_angle_value=92.0,
        elbow_angle_value=166.0,
        wrist_height_relative=0.4,
        landmark_confidence=0.92,
        hand_detected=True,
        camera_status="ok",
    )
    print(json.dumps(packet, indent=2))


def run_tracker(args: argparse.Namespace) -> None:
    try:
        import cv2
        import mediapipe as mp
    except ImportError as error:
        print(f"Missing vision dependency: {error}. Run: python -m pip install -r backend/requirements.txt")
        raise SystemExit(1)

    globals()["cv2"] = cv2

    tracker = PoseTracker(
        side=args.side,
        target_angle=args.target_angle,
        target_reps=args.target_reps,
        backend_url=args.backend_url,
        post_backend=not args.no_post,
        use_sensor=not args.no_sensor,
    )

    cap = cv2.VideoCapture(args.camera, cv2.CAP_DSHOW)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    if not cap.isOpened():
        raise SystemExit(f"Could not open camera index {args.camera}")

    mp_pose = mp.solutions.pose
    mp_hands = mp.solutions.hands
    pose_indices = POSE_LANDMARKS[args.side]
    last_packet = None
    last_emit_at = 0.0
    last_frame_emit_at = 0.0
    last_frame_at = time.time()
    fps = 0.0
    frame_index = 0

    with mp_pose.Pose(
        static_image_mode=False,
        model_complexity=0,
        smooth_landmarks=True,
        enable_segmentation=False,
        min_detection_confidence=0.55,
        min_tracking_confidence=0.55,
    ) as pose, mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=2,
        model_complexity=0,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as hands:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("Camera frame read failed.")
                break

            frame_index += 1
            now = time.time()
            fps = 0.9 * fps + 0.1 * (1.0 / max(now - last_frame_at, 0.001))
            last_frame_at = now
            height, width = frame.shape[:2]

            should_process = frame_index % args.process_every == 0
            if should_process:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                rgb.flags.writeable = False
                pose_results = pose.process(rgb)
                hand_results = hands.process(rgb)
                rgb.flags.writeable = True

                shoulder = elbow = wrist = hip = None
                confidence = 0.0
                hand_detected = False
                if pose_results.pose_landmarks:
                    landmarks = pose_results.pose_landmarks.landmark
                    shoulder, shoulder_conf = landmark_point(landmarks, pose_indices["shoulder"])
                    elbow, elbow_conf = landmark_point(landmarks, pose_indices["elbow"])
                    wrist, wrist_conf = landmark_point(landmarks, pose_indices["wrist"])
                    hip, hip_conf = landmark_point(landmarks, pose_indices["hip"])
                    confidence = (shoulder_conf + elbow_conf + wrist_conf + hip_conf) / 4

                selected_hand = closest_hand_to_wrist(hand_results, wrist)
                if selected_hand:
                    hand_points, hand_score = selected_hand
                    hand_detected = True
                    if wrist is None:
                        wrist = hand_points[0]
                    confidence = max(confidence, min(1.0, hand_score))

                camera_status = "ok" if shoulder and elbow and wrist and hip else "warning"
                shoulder_value = shoulder_raise_angle(hip, shoulder, wrist) if camera_status == "ok" else 0.0
                elbow_value = elbow_angle(shoulder, elbow, wrist) if camera_status == "ok" else 0.0
                wrist_height_relative = 0.0
                if wrist and shoulder:
                    wrist_height_relative = max(-1.0, min(1.0, shoulder.y - wrist.y))

                last_packet = tracker.build_packet(
                    shoulder_angle_value=shoulder_value,
                    elbow_angle_value=elbow_value,
                    wrist_height_relative=wrist_height_relative,
                    landmark_confidence=confidence,
                    hand_detected=hand_detected,
                    camera_status=camera_status,
                )

                if camera_status == "ok":
                    shoulder_xy = normalized_to_pixel(shoulder, width, height)
                    elbow_xy = normalized_to_pixel(elbow, width, height)
                    wrist_xy = normalized_to_pixel(wrist, width, height)
                    hip_xy = normalized_to_pixel(hip, width, height)
                    cv2.line(frame, hip_xy, shoulder_xy, (90, 90, 90), 3, cv2.LINE_AA)
                    cv2.line(frame, shoulder_xy, elbow_xy, (244, 185, 95), 4, cv2.LINE_AA)
                    cv2.line(frame, elbow_xy, wrist_xy, (86, 216, 167), 4, cv2.LINE_AA)
                    draw_landmark(frame, shoulder_xy, (244, 185, 95))
                    draw_landmark(frame, elbow_xy, (86, 216, 167))
                    draw_landmark(frame, wrist_xy, (255, 116, 100))
                    draw_target_arc(frame, shoulder_xy, args.target_angle, shoulder_value, last_packet["coach_state"])

                draw_hand_points(frame, hand_results, width, height)

                if now - last_emit_at >= args.emit_interval:
                    tracker.emit(last_packet)
                    last_emit_at = now

            if last_packet:
                draw_text_panel(frame, format_overlay_lines(last_packet, fps=fps, data_status="real-opencv"))
            else:
                draw_text_panel(frame, ["Physio | REAL-OPENCV", "Waiting for landmarks"])

            if now - last_frame_emit_at >= args.frame_interval:
                encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), args.jpeg_quality]
                encoded, buffer = cv2.imencode(".jpg", frame, encode_params)
                if encoded:
                    tracker.emitter.emit_frame(buffer.tobytes())
                    last_frame_emit_at = now

            if not args.no_display:
                cv2.imshow("Physio OpenCV Tracker", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

            if args.max_frames and frame_index >= args.max_frames:
                break

    cap.release()
    if not args.no_display:
        cv2.destroyAllWindows()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Physio OpenCV and MediaPipe tracker")
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--side", choices=["right", "left"], default="right")
    parser.add_argument("--target-angle", type=float, default=90.0)
    parser.add_argument("--target-reps", type=int, default=8)
    parser.add_argument("--backend-url", default="http://localhost:8000")
    parser.add_argument("--emit-interval", type=float, default=0.5)
    parser.add_argument("--frame-interval", type=float, default=0.2)
    parser.add_argument("--jpeg-quality", type=int, default=72)
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=480)
    parser.add_argument("--process-every", type=int, default=1)
    parser.add_argument("--no-post", action="store_true")
    parser.add_argument("--no-sensor", action="store_true")
    parser.add_argument("--no-display", action="store_true")
    parser.add_argument("--max-frames", type=int, default=0)
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    options = parse_args()
    if options.self_test:
        run_self_test()
    else:
        run_tracker(options)
