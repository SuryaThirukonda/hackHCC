import { Camera, Loader2, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { postPacket } from "../api/client.js";

const TARGET_ANGLE = 90;
const TARGET_REPS = 8;
const DETECT_INTERVAL_MS = 66;
const POST_INTERVAL_MS = 500;
const MIN_LANDMARK_CONFIDENCE = 0.45;
const MIN_PRESENT_SCORE = 0.45;

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
  low_confidence: "Move your full arm into view.",
  rest_needed: "Take a short rest before the next rep.",
  session_complete: "Session complete. Nice steady work.",
  error: "Something went wrong. Check the sensor or camera."
};

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function angle(a, b, c) {
  if (!a || !b || !c) return null;
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const magA = Math.hypot(ba.x, ba.y);
  const magC = Math.hypot(bc.x, bc.y);
  if (!magA || !magC) return null;
  return Math.acos(clamp(dot / (magA * magC), -1, 1)) * 180 / Math.PI;
}

function finitePoint(point) {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function calculateShoulderRaiseAngleFromScreen(shoulder, elbow) {
  if (!finitePoint(shoulder) || !finitePoint(elbow)) return null;
  const dx = elbow.x - shoulder.x;
  const dy = elbow.y - shoulder.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) === 0) return null;
  return Math.atan2(Math.abs(dx), dy) * 180 / Math.PI;
}

function rangeStatus(shoulderAngle, targetAngle) {
  if (shoulderAngle >= targetAngle + 10) return "overextended";
  if (shoulderAngle >= targetAngle) return "target_met";
  if (shoulderAngle >= targetAngle - 15) return "almost_there";
  if (shoulderAngle < 20) return "below_start";
  return "too_low";
}

function physioScore({ shoulderAngle, combinedJitter, pace, holdTime, confidence, compensation }) {
  if (shoulderAngle == null) return null;
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
  if (confidence < MIN_LANDMARK_CONFIDENCE) return "low_confidence";
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

function landmarkScore(landmark) {
  if (!landmark) return 0;
  const scores = [];
  if (Number.isFinite(landmark.visibility)) scores.push(landmark.visibility);
  if (Number.isFinite(landmark.presence)) scores.push(landmark.presence);
  if (!scores.length) return 0.5;
  return clamp(Math.min(...scores), 0, 1);
}

function selectPosePoint(poseLandmarks, index) {
  const landmark = poseLandmarks?.[index] || null;
  const score = landmarkScore(landmark);
  return {
    point: score >= MIN_PRESENT_SCORE ? landmark : null,
    score,
    present: score >= MIN_PRESENT_SCORE
  };
}

function formatMaybeAngle(value) {
  return value == null ? "--" : value.toFixed(1);
}

function compactPoint(point, score) {
  if (!point) return null;
  return {
    x: Number(point.x.toFixed(3)),
    y: Number(point.y.toFixed(3)),
    score: Number(score.toFixed(3))
  };
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
  if (shoulderAngle == null) return;
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

function invalidateRep(rep) {
  rep.phase = "idle";
  rep.reachedTarget = false;
  rep.holdStartedAt = null;
  rep.holdTime = 0;
}

function updateMotion(samples, timestamp, shoulderAngle) {
  if (shoulderAngle == null) {
    samples.length = 0;
    return { pace: "unknown", jitter: 0, velocity: 0 };
  }
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

export default function BrowserPoseOverlay({ active, sessionId, onPacket, side = "right" }) {
  const activeSide = POSE[side] ? side : "right";
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
  const debugModeRef = useRef(false);
  const [cameraState, setCameraState] = useState("idle");
  const [cameraError, setCameraError] = useState("");
  const [debugMode, setDebugMode] = useState(false);

  useEffect(() => () => stopCamera(), []);
  useEffect(() => {
    debugModeRef.current = debugMode;
  }, [debugMode]);

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
    const indices = POSE[activeSide];
    const poseDetected = Boolean(poseLandmarks?.length);
    const shoulderSample = selectPosePoint(poseLandmarks, indices.shoulder);
    const elbowSample = selectPosePoint(poseLandmarks, indices.elbow);
    const wristSample = selectPosePoint(poseLandmarks, indices.wrist);
    const hipSample = selectPosePoint(poseLandmarks, indices.hip);
    const shoulder = shoulderSample.point;
    const elbow = elbowSample.point;
    const wrist = wristSample.point;
    const hip = hipSample.point;
    const confidence = (shoulderSample.score + elbowSample.score + wristSample.score) / 3;
    const hasArmLandmarks = shoulderSample.present && elbowSample.present && wristSample.present;
    const coordinatesFinite = finitePoint(shoulder) && finitePoint(elbow) && finitePoint(wrist);
    const baseReady = poseDetected && hasArmLandmarks && coordinatesFinite && confidence >= MIN_LANDMARK_CONFIDENCE;
    const usingTorsoReference = baseReady && hipSample.present && finitePoint(hip);
    const usingScreenAxisFallback = baseReady && !usingTorsoReference;
    const shoulderAngle = baseReady
      ? (usingTorsoReference ? angle(hip, shoulder, wrist) : calculateShoulderRaiseAngleFromScreen(shoulder, elbow))
      : null;
    const elbowAngle = baseReady ? angle(shoulder, elbow, wrist) : null;
    const calculatedAngles = shoulderAngle != null && elbowAngle != null;
    const validAnalysis = baseReady && calculatedAngles;
    const angleRejectionReason = validAnalysis
      ? "none"
      : !poseDetected
        ? "pose_not_detected"
        : !hasArmLandmarks
          ? "missing_shoulder_elbow_or_wrist"
          : !coordinatesFinite
            ? "non_finite_coordinates"
            : confidence < MIN_LANDMARK_CONFIDENCE
              ? "low_landmark_confidence"
              : "angle_calculation_failed";
    const cameraStatus = validAnalysis ? "ok" : "warning";
    const compensation = validAnalysis ? "none" : "low_confidence";

    if (validAnalysis) {
      updateRep(repRef.current, shoulderAngle);
    } else {
      invalidateRep(repRef.current);
    }

    const motion = updateMotion(samplesRef.current, timestampMs, validAnalysis ? shoulderAngle : null);
    const combinedJitter = validAnalysis ? motion.jitter / 2 : 0;
    const currentRange = validAnalysis ? rangeStatus(shoulderAngle, TARGET_ANGLE) : "unknown";
    const score = physioScore({
      shoulderAngle: validAnalysis ? shoulderAngle : null,
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
      source: "browser_mediapipe",
      session_id: sessionId || "browser-webcam",
      timestamp_ms: Math.round(Date.now()),
      exercise: "right_arm_raise",
      side: activeSide,
      device_id: "browser-webcam",
      sensor_status: "offline",
      camera_status: cameraStatus,
      distance_cm: null,
      sensor_jitter_score: 0,
      opencv_jitter_score: Number(motion.jitter.toFixed(3)),
      combined_jitter_score: Number(combinedJitter.toFixed(3)),
      jitter_detected: validAnalysis && combinedJitter > 0.65,
      shoulder_angle: validAnalysis ? Number(shoulderAngle.toFixed(1)) : null,
      elbow_angle: validAnalysis ? Number(elbowAngle.toFixed(1)) : null,
      target_angle: TARGET_ANGLE,
      landmark_confidence: Number(confidence.toFixed(3)),
      rep_count: repRef.current.count,
      rep_phase: validAnalysis ? repRef.current.phase : "idle",
      hold_time_sec: Number(repRef.current.holdTime.toFixed(1)),
      pace: motion.pace,
      range_status: currentRange,
      compensation,
      physio_score: score,
      coach_state: state,
      local_coach_message: COACH_MESSAGES[state],
      ai_coach_message: null,
      avatar_status: "idle",
      voice_status: "idle",
      pose_detected: poseDetected,
      shoulder_present: shoulderSample.present,
      elbow_present: elbowSample.present,
      wrist_present: wristSample.present,
      hip_present: hipSample.present,
      angle_valid: validAnalysis,
      using_torso_reference: usingTorsoReference,
      using_screen_axis_fallback: usingScreenAxisFallback,
      shoulder_coords: compactPoint(shoulder, shoulderSample.score),
      elbow_coords: compactPoint(elbow, elbowSample.score),
      wrist_coords: compactPoint(wrist, wristSample.score),
      angle_rejection_reason: angleRejectionReason,
      _debug_landmarks: {
        shoulder: compactPoint(shoulder, shoulderSample.score),
        elbow: compactPoint(elbow, elbowSample.score),
        wrist: compactPoint(wrist, wristSample.score)
      }
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
    ctx.fillText(`Shoulder ${formatMaybeAngle(packet.shoulder_angle)} deg | Elbow ${formatMaybeAngle(packet.elbow_angle)} deg`, 28, 78);
    ctx.fillText(`Rep ${packet.rep_count} | ${packet.rep_phase} | Score ${packet.physio_score ?? "--"}`, 28, 110);
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
      const indices = POSE[activeSide];
      const shoulderSample = selectPosePoint(poseLandmarks, indices.shoulder);
      const elbowSample = selectPosePoint(poseLandmarks, indices.elbow);
      const wristSample = selectPosePoint(poseLandmarks, indices.wrist);
      const hipSample = selectPosePoint(poseLandmarks, indices.hip);
      const shoulder = shoulderSample.point ? pixel(shoulderSample.point, width, height) : null;
      const elbow = elbowSample.point ? pixel(elbowSample.point, width, height) : null;
      const wrist = wristSample.point ? pixel(wristSample.point, width, height) : null;
      const hip = hipSample.point ? pixel(hipSample.point, width, height) : null;
      if (shoulder && hip) {
        drawLine(ctx, hip, shoulder, "rgba(244,241,232,.45)", 3);
      }
      if (shoulder && elbow) {
        drawLine(ctx, shoulder, elbow, "#f4b95f", 6);
      }
      if (elbow && wrist) {
        drawLine(ctx, elbow, wrist, "#56d8a7", 6);
      }
      if (shoulder) drawPoint(ctx, shoulder, "#f4b95f");
      if (elbow) drawPoint(ctx, elbow, "#56d8a7");
      if (wrist) drawPoint(ctx, wrist, "#ff7464");

      if (packet.angle_valid && shoulder) {
        ctx.beginPath();
        ctx.strokeStyle = "#56d8a7";
        ctx.lineWidth = 5;
        ctx.arc(shoulder.x, shoulder.y, 82, -Math.PI / 2 - 0.15, -Math.PI / 2 + 0.15);
        ctx.stroke();
      }
    }

    if (!packet.angle_valid) {
      ctx.fillStyle = "rgba(100,116,255,.88)";
      ctx.fillRect(12, height - 68, 430, 44);
      ctx.fillStyle = "#f4f1e8";
      ctx.font = "800 18px Segoe UI";
      ctx.fillText("Move your full arm into view.", 28, height - 40);
    }
    ctx.restore();
  }

  async function postLatestPacket(packet) {
    latestPacketRef.current = packet;
    onPacket?.(packet);
    if (debugModeRef.current) {
      console.log("Physio analysis debug", {
        shoulder: packet._debug_landmarks?.shoulder || null,
        elbow: packet._debug_landmarks?.elbow || null,
        wrist: packet._debug_landmarks?.wrist || null,
        hip_present: packet.hip_present,
        landmark_confidence: packet.landmark_confidence,
        angle_valid: packet.angle_valid,
        angle_rejection_reason: packet.angle_rejection_reason,
        shoulder_angle: packet.shoulder_angle,
        elbow_angle: packet.elbow_angle,
        rep_phase: packet.rep_phase,
        rep_count: packet.rep_count,
        coach_state: packet.coach_state
      });
    }
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
      <span className="camera-badge"><Video size={15} /> Live Webcam Analysis</span>
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
        <div className="camera-actions">
          <button type="button" className="camera-debug" onClick={() => setDebugMode((value) => !value)}>
            {debugMode ? "Analysis debug on" : "Analysis debug"}
          </button>
          <button type="button" className="camera-stop" onClick={stopCamera}>Stop camera</button>
        </div>
      )}
    </div>
  );
}
