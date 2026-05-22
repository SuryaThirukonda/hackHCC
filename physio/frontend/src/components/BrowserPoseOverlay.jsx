import { Camera, Loader2, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { postPacket } from "../api/client.js";

const TARGET_ANGLE = 90;
const TARGET_REPS = 8;
const DETECT_INTERVAL_MS = 66;
const POST_INTERVAL_MS = 500;

const POSE = {
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24 },
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23 }
};

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20]
];

const COACH_MESSAGES = {
  good_form: "Great control. Keep that same pace.",
  almost_there: "Almost there. Raise your arm a little higher.",
  too_fast: "Slow down and control the movement.",
  too_jittery: "Keep your arm steady and move smoothly.",
  hold_longer: "Hold at the top for one more second.",
  low_confidence: "Adjust your position so I can see your arm.",
  rest_needed: "Take a short rest before the next rep.",
  session_complete: "Session complete. Nice steady work.",
  error: "Something went wrong. Check the sensor or camera."
};

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function angle(a, b, c) {
  if (!a || !b || !c) return 0;
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const magA = Math.hypot(ba.x, ba.y);
  const magC = Math.hypot(bc.x, bc.y);
  if (!magA || !magC) return 0;
  return Math.acos(clamp(dot / (magA * magC), -1, 1)) * 180 / Math.PI;
}

function rangeStatus(shoulderAngle, targetAngle) {
  if (shoulderAngle >= targetAngle + 10) return "overextended";
  if (shoulderAngle >= targetAngle) return "target_met";
  if (shoulderAngle >= targetAngle - 15) return "almost_there";
  if (shoulderAngle < 20) return "below_start";
  return "too_low";
}

function physioScore({ shoulderAngle, combinedJitter, pace, holdTime, confidence, compensation }) {
  const range = Math.min(shoulderAngle / TARGET_ANGLE, 1) * 35;
  const smooth = (1 - clamp(combinedJitter, 0, 1)) * 25;
  const paceScore = { good: 15, too_slow: 8, too_fast: 5, unknown: 8 }[pace] ?? 8;
  const hold = Math.min(holdTime / 2, 1) * 15;
  const confidenceScore = clamp(confidence, 0, 1) * 10;
  const penalty = { none: 0, shoulder_shrug: 8, torso_lean: 8, low_confidence: 10, unknown: 0 }[compensation] ?? 0;
  return Math.round(clamp(range + smooth + paceScore + hold + confidenceScore - penalty, 0, 100));
}

function coachState({ cameraStatus, confidence, combinedJitter, pace, range, phase, holdTime, reps }) {
  if (cameraStatus !== "ok") return "low_confidence";
  if (confidence < 0.6) return "low_confidence";
  if (combinedJitter > 0.65) return "too_jittery";
  if (pace === "too_fast") return "too_fast";
  if (range === "almost_there" || range === "too_low") return "almost_there";
  if (phase === "holding" && holdTime < 2) return "hold_longer";
  if (reps >= TARGET_REPS) return "session_complete";
  return "good_form";
}

function pixel(point, width, height) {
  return { x: point.x * width, y: point.y * height };
}

function drawPoint(ctx, point, color, radius = 7) {
  ctx.beginPath();
  ctx.fillStyle = "rgba(0,0,0,.7)";
  ctx.arc(point.x, point.y, radius + 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawLine(ctx, start, end, color, width = 5) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
}

function useRepCounter() {
  return useRef({
    count: 0,
    phase: "idle",
    reachedTarget: false,
    holdStartedAt: null,
    holdTime: 0
  });
}

function updateRep(rep, shoulderAngle) {
  const now = performance.now();
  if (shoulderAngle < 30) {
    if (rep.reachedTarget) {
      rep.count += 1;
      rep.phase = "rep_complete";
      rep.reachedTarget = false;
    } else {
      rep.phase = "resting";
    }
    rep.holdStartedAt = null;
    rep.holdTime = 0;
    return;
  }

  if (shoulderAngle >= TARGET_ANGLE - 8) {
    rep.reachedTarget = true;
    rep.phase = "holding";
    if (!rep.holdStartedAt) rep.holdStartedAt = now;
    rep.holdTime = (now - rep.holdStartedAt) / 1000;
    return;
  }

  rep.holdStartedAt = null;
  rep.holdTime = 0;
  rep.phase = rep.reachedTarget ? "lowering" : "raising";
}

function updateMotion(samples, timestamp, shoulderAngle) {
  samples.push({ timestamp, shoulderAngle });
  while (samples.length > 18) samples.shift();
  if (samples.length < 3) return { pace: "unknown", jitter: 0, velocity: 0 };

  const velocities = [];
  for (let i = 1; i < samples.length; i += 1) {
    const previous = samples[i - 1];
    const current = samples[i];
    const dt = Math.max((current.timestamp - previous.timestamp) / 1000, 0.001);
    velocities.push((current.shoulderAngle - previous.shoulderAngle) / dt);
  }

  const velocity = velocities.at(-1) ?? 0;
  const changes = [];
  for (let i = 1; i < velocities.length; i += 1) {
    changes.push(Math.abs(velocities[i] - velocities[i - 1]));
  }
  const averageChange = changes.reduce((sum, value) => sum + value, 0) / Math.max(changes.length, 1);
  const jitter = clamp(averageChange / 240, 0, 1);
  const speed = Math.abs(velocity);
  const pace = speed > 150 ? "too_fast" : speed < 8 ? "too_slow" : "good";
  return { pace, jitter, velocity };
}

export default function BrowserPoseOverlay({ active, sessionId, onPacket }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const poseRef = useRef(null);
  const handRef = useRef(null);
  const rafRef = useRef(null);
  const repRef = useRepCounter();
  const samplesRef = useRef([]);
  const lastDetectAtRef = useRef(0);
  const lastPostAtRef = useRef(0);
  const latestPacketRef = useRef(null);
  const latestPoseRef = useRef(null);
  const latestHandsRef = useRef([]);
  const [cameraState, setCameraState] = useState("idle");
  const [cameraError, setCameraError] = useState("");

  useEffect(() => () => stopCamera(), []);

  async function loadLandmarkers(delegate = "GPU") {
    const { FilesetResolver, PoseLandmarker, HandLandmarker } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
    const pose = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
        delegate
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    const hands = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
        delegate
      },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.45,
      minHandPresenceConfidence: 0.45,
      minTrackingConfidence: 0.45
    });
    return { pose, hands };
  }

  async function startCamera() {
    try {
      setCameraState("loading");
      setCameraError("");

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not expose webcam access.");
      }

      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 960 },
          height: { ideal: 540 },
          facingMode: "user"
        },
        audio: false
      });

      videoRef.current.srcObject = streamRef.current;
      await videoRef.current.play();

      try {
        const models = await loadLandmarkers("GPU");
        poseRef.current = models.pose;
        handRef.current = models.hands;
      } catch {
        const models = await loadLandmarkers("CPU");
        poseRef.current = models.pose;
        handRef.current = models.hands;
      }

      setCameraState("ready");
      rafRef.current = requestAnimationFrame(loop);
    } catch (error) {
      setCameraState("error");
      setCameraError(error.message);
    }
  }

  function stopCamera() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    poseRef.current?.close?.();
    handRef.current?.close?.();
    poseRef.current = null;
    handRef.current = null;
    setCameraState((state) => state === "idle" ? "idle" : "stopped");
  }

  function buildPacket(poseLandmarks, handLandmarks, timestampMs) {
    const indices = POSE.right;
    const point = (index) => {
      const landmark = poseLandmarks?.[index];
      if (!landmark) return null;
      const visibility = landmark.visibility ?? 1;
      return visibility >= 0.45 ? landmark : null;
    };

    const shoulder = point(indices.shoulder);
    const elbow = point(indices.elbow);
    const wrist = point(indices.wrist);
    const hip = point(indices.hip);
    const cameraStatus = shoulder && elbow && wrist && hip ? "ok" : "warning";
    const shoulderAngle = cameraStatus === "ok" ? angle(hip, shoulder, wrist) : 0;
    const elbowAngle = cameraStatus === "ok" ? angle(shoulder, elbow, wrist) : 0;
    const confidence = cameraStatus === "ok"
      ? [shoulder, elbow, wrist, hip].reduce((sum, item) => sum + (item.visibility ?? 1), 0) / 4
      : 0;
    const handDetected = handLandmarks.length > 0;
    const compensation = handDetected && confidence >= 0.6 ? "none" : "low_confidence";
    updateRep(repRef.current, shoulderAngle);
    const motion = updateMotion(samplesRef.current, timestampMs, shoulderAngle);
    const combinedJitter = motion.jitter / 2;
    const currentRange = cameraStatus === "ok" ? rangeStatus(shoulderAngle, TARGET_ANGLE) : "unknown";
    const score = physioScore({
      shoulderAngle,
      combinedJitter,
      pace: motion.pace,
      holdTime: repRef.current.holdTime,
      confidence,
      compensation
    });
    const state = coachState({
      cameraStatus,
      confidence,
      combinedJitter,
      pace: motion.pace,
      range: currentRange,
      phase: repRef.current.phase,
      holdTime: repRef.current.holdTime,
      reps: repRef.current.count
    });

    return {
      session_id: sessionId || "browser-webcam",
      timestamp_ms: Math.round(Date.now()),
      exercise: "right_arm_raise",
      side: "right",
      device_id: "browser-webcam",
      sensor_status: "offline",
      camera_status: cameraStatus,
      distance_cm: null,
      sensor_jitter_score: 0,
      opencv_jitter_score: Number(motion.jitter.toFixed(3)),
      combined_jitter_score: Number(combinedJitter.toFixed(3)),
      jitter_detected: combinedJitter > 0.65,
      shoulder_angle: Number(shoulderAngle.toFixed(1)),
      elbow_angle: Number(elbowAngle.toFixed(1)),
      target_angle: TARGET_ANGLE,
      landmark_confidence: Number(confidence.toFixed(3)),
      rep_count: repRef.current.count,
      rep_phase: cameraStatus === "ok" ? repRef.current.phase : "idle",
      hold_time_sec: Number(repRef.current.holdTime.toFixed(1)),
      pace: motion.pace,
      range_status: currentRange,
      compensation,
      physio_score: score,
      coach_state: state,
      local_coach_message: COACH_MESSAGES[state],
      ai_coach_message: null,
      avatar_status: "idle",
      voice_status: "idle"
    };
  }

  function drawOverlay(ctx, width, height, poseLandmarks, handLandmarks, packet) {
    ctx.save();
    ctx.fillStyle = "rgba(15,17,16,.72)";
    ctx.fillRect(12, 12, 520, 168);
    ctx.fillStyle = "#56d8a7";
    ctx.font = "800 20px Segoe UI";
    ctx.fillText("Physio | browser webcam tracking", 28, 44);
    ctx.fillStyle = "#f4f1e8";
    ctx.font = "700 18px Segoe UI";
    ctx.fillText(`Shoulder ${packet.shoulder_angle.toFixed(1)} deg | Elbow ${packet.elbow_angle.toFixed(1)} deg`, 28, 78);
    ctx.fillText(`Rep ${packet.rep_count} | ${packet.rep_phase} | Score ${packet.physio_score}`, 28, 110);
    ctx.fillText(packet.local_coach_message, 28, 142);

    for (const landmarks of handLandmarks) {
      const points = landmarks.map((landmark) => pixel(landmark, width, height));
      for (const [start, end] of HAND_CONNECTIONS) {
        drawLine(ctx, points[start], points[end], "#79a7ff", 2);
      }
      for (const item of points) {
        drawPoint(ctx, item, "#56d8a7", 3);
      }
    }

    if (poseLandmarks?.length) {
      const indices = POSE.right;
      const shoulder = pixel(poseLandmarks[indices.shoulder], width, height);
      const elbow = pixel(poseLandmarks[indices.elbow], width, height);
      const wrist = pixel(poseLandmarks[indices.wrist], width, height);
      const hip = pixel(poseLandmarks[indices.hip], width, height);
      drawLine(ctx, hip, shoulder, "rgba(244,241,232,.45)", 3);
      drawLine(ctx, shoulder, elbow, "#f4b95f", 6);
      drawLine(ctx, elbow, wrist, "#56d8a7", 6);
      drawPoint(ctx, shoulder, "#f4b95f");
      drawPoint(ctx, elbow, "#56d8a7");
      drawPoint(ctx, wrist, "#ff7464");

      ctx.beginPath();
      ctx.strokeStyle = "#56d8a7";
      ctx.lineWidth = 5;
      ctx.arc(shoulder.x, shoulder.y, 82, -Math.PI / 2 - 0.15, -Math.PI / 2 + 0.15);
      ctx.stroke();
    }
    ctx.restore();
  }

  async function postLatestPacket(packet) {
    latestPacketRef.current = packet;
    onPacket?.(packet);
    try {
      await postPacket(packet);
    } catch {
      // The visual tracker remains useful even if the backend is offline.
    }
  }

  function loop(timestampMs) {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!active || !video || !canvas || !ctx || !poseRef.current || !handRef.current) return;

    const width = video.videoWidth || 960;
    const height = video.videoHeight || 540;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.drawImage(video, 0, 0, width, height);

    if (timestampMs - lastDetectAtRef.current >= DETECT_INTERVAL_MS) {
      const poseResult = poseRef.current.detectForVideo(video, timestampMs);
      const handResult = handRef.current.detectForVideo(video, timestampMs);
      latestPoseRef.current = poseResult.landmarks?.[0] || null;
      latestHandsRef.current = handResult.landmarks || [];
      latestPacketRef.current = buildPacket(latestPoseRef.current, latestHandsRef.current, timestampMs);
      lastDetectAtRef.current = timestampMs;
    }

    if (latestPacketRef.current) {
      drawOverlay(ctx, width, height, latestPoseRef.current, latestHandsRef.current, latestPacketRef.current);
    } else {
      ctx.fillStyle = "#f4f1e8";
      ctx.font = "700 28px Segoe UI";
      ctx.fillText("Initializing webcam tracker...", 28, 52);
    }

    if (latestPacketRef.current && timestampMs - lastPostAtRef.current >= POST_INTERVAL_MS) {
      postLatestPacket(latestPacketRef.current);
      lastPostAtRef.current = timestampMs;
    }

    rafRef.current = requestAnimationFrame(loop);
  }

  return (
    <div className="camera-stage browser-camera-stage">
      <video ref={videoRef} playsInline muted className="browser-video-source" />
      <canvas ref={canvasRef} className="browser-overlay-canvas" />
      <span className="camera-badge"><Video size={15} /> Browser webcam overlay</span>
      {cameraState !== "ready" && (
        <div className="camera-permission">
          <Camera size={34} />
          <strong>Use webcam tracking in this tab</strong>
          <p>Allow camera access to draw tracked arm and hand points live.</p>
          <button type="button" onClick={startCamera} disabled={cameraState === "loading"}>
            {cameraState === "loading" ? <Loader2 size={17} className="spin" /> : <Camera size={17} />}
            {cameraState === "loading" ? "Loading tracker" : "Enable webcam"}
          </button>
          {cameraError && <small>{cameraError}</small>}
        </div>
      )}
      {cameraState === "ready" && (
        <button type="button" className="camera-stop" onClick={stopCamera}>Stop camera</button>
      )}
    </div>
  );
}
