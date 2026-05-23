import { Camera, Loader2, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createElbowFlexionAnalyzer } from "../analyzers/elbowFlexionAnalyzer.js";
import { createPushMotionAnalyzer } from "../analyzers/pushMotionAnalyzer.js";
import { postPacket } from "../api/client.js";
import { useSensorStream } from "../sensors/useSensorStream.js";

const TARGET_ANGLE = 90;
const DETECT_INTERVAL_MS = 66;
const POST_INTERVAL_MS = 500;
const MIN_LANDMARK_CONFIDENCE = 0.45;
const MIN_PRESENT_SCORE = 0.45;
const CAMERA_PREF_KEY = "physio_browser_camera_enabled";

let sharedCameraStream = null;
let sharedLandmarkers = null;
let sharedLandmarkersPromise = null;

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

function exerciseTargetAngle(exercise) {
  if (exercise?.targetPosition) {
    return (exercise.targetPosition.elbowAngleMin + exercise.targetPosition.elbowAngleMax) / 2;
  }
  return TARGET_ANGLE;
}

function createAnalyzerForExercise(exercise) {
  if (exercise?.movementType === "forward_press" || exercise?.id === "seated_one_arm_forward_press") {
    return createPushMotionAnalyzer(exercise);
  }
  return createElbowFlexionAnalyzer(exercise);
}

// ---------------------------------------------------------------------------
// Framing analysis — chest press specific
// ---------------------------------------------------------------------------

/**
 * Checks whether the arm fits the camera frame well for a chest-press exercise.
 * All inputs are normalized MediaPipe coordinates (0–1 range).
 * Returns { ok, cue, state } where cue is a spoken prompt or null.
 */
function analyzePressFaming(shoulder, elbow, wrist) {
  if (!shoulder || !elbow || !wrist) {
    return { ok: false, cue: "Move your arm fully into view.", state: "frame_arm_missing" };
  }

  const EDGE = 0.08;           // 8% from any edge
  const MIN_SPAN = 0.20;       // arm span < 20% of frame → too far
  const MAX_SPAN = 0.80;       // arm span > 80% of frame → too close

  // Compute arm span in normalized space (shoulder→wrist distance)
  const armSpan = Math.hypot(shoulder.x - wrist.x, shoulder.y - wrist.y);

  if (armSpan < MIN_SPAN) {
    return { ok: false, cue: "Come closer to the camera.", state: "frame_too_far" };
  }
  if (armSpan > MAX_SPAN) {
    return { ok: false, cue: "Step back from the camera.", state: "frame_too_close" };
  }
  if (wrist.x < EDGE || elbow.x < EDGE) {
    return { ok: false, cue: "Shift right — arm is cut off.", state: "frame_arm_cut" };
  }
  if (wrist.x > 1 - EDGE || elbow.x > 1 - EDGE) {
    return { ok: false, cue: "Shift left — arm is cut off.", state: "frame_arm_cut" };
  }
  if (wrist.y < EDGE || elbow.y < EDGE) {
    return { ok: false, cue: "Lower your arm into frame.", state: "frame_arm_cut" };
  }
  if (wrist.y > 1 - EDGE || elbow.y > 1 - EDGE) {
    return { ok: false, cue: "Raise your arm into frame.", state: "frame_arm_cut" };
  }

  return { ok: true, cue: null, state: "frame_ok" };
}

/**
 * Compute palm centre pixel from MediaPipe hand landmark array.
 * Uses the 5 knuckle-base landmarks (0,5,9,13,17) that form the palm ring.
 */
function palmCenterFromHandLandmarks(landmarks, width, height) {
  if (!landmarks?.length) return null;
  const PALM_IDX = [0, 5, 9, 13, 17];
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (const idx of PALM_IDX) {
    const lm = landmarks[idx];
    if (lm) { sx += lm.x; sy += lm.y; count++; }
  }
  if (!count) return null;
  return { x: (sx / count) * width, y: (sy / count) * height };
}

function isForwardPressExercise(exercise) {
  return exercise?.movementType === "forward_press" || exercise?.id === "seated_one_arm_forward_press";
}

function repPhaseForAnalyzerPhase(phase) {
  return {
    CALIBRATION_READY: "idle",
    WAITING_FOR_TRACKING: "idle",
    MOVE_TO_BENT: "lowering",
    START_BENT_HOLD: "holding",
    START_BENT_READY: "resting",
    PUSHING: "raising",
    EXTENDED_HOLD: "holding",
    RETURNING: "lowering",
    WAITING_FOR_START: "idle",
    STRAIGHTEN_TO_START: "lowering",
    EXTENDED_READY: "resting",
    FLEXING: "raising",
    FLEXED_HOLD: "holding",
    HOLD_COMPLETE: "holding",
    EXTENDING: "lowering",
    REP_COMPLETE: "rep_complete",
    SESSION_COMPLETE: "rep_complete"
  }[phase] || "idle";
}

function humanPhaseForAnalyzerPhase(phase) {
  return {
    CALIBRATION_READY: "Begin now",
    WAITING_FOR_TRACKING: "Start bent",
    MOVE_TO_BENT: "Move to bent",
    START_BENT_HOLD: "Hold bent",
    START_BENT_READY: "Ready",
    PUSHING: "Pressing",
    EXTENDED_HOLD: "Hold reach",
    RETURNING: "Returning",
    WAITING_FOR_START: "Start straight",
    STRAIGHTEN_TO_START: "Straighten",
    EXTENDED_READY: "Ready",
    FLEXING: "Bending",
    FLEXED_HOLD: "Hold",
    HOLD_COMPLETE: "Extend now",
    EXTENDING: "Straighten",
    REP_COMPLETE: "Rep complete",
    SESSION_COMPLETE: "Complete"
  }[phase] || "Waiting";
}

function compactPoint(point, score) {
  if (!point) return null;
  return {
    x: Number(point.x.toFixed(3)),
    y: Number(point.y.toFixed(3)),
    score: Number(score.toFixed(3))
  };
}

function sensorStatusForSample(sensorStream, latestSensor, sensorExpectedActive, staleMs = 600) {
  if (!sensorExpectedActive) return "offline";
  if (latestSensor?.distance_cm != null && Date.now() - latestSensor.timestamp_ms <= staleMs) return "ok";
  if (latestSensor?.distance_cm != null) return "warning";
  if (sensorStream.status === "error") return "error";
  if (sensorStream.status === "ok" || sensorStream.status === "connecting") return "warning";
  return "offline";
}

function calibratedPositionForDistance(distanceCm, compressedCm, stretchedCm) {
  if (!Number.isFinite(distanceCm) || !Number.isFinite(compressedCm) || !Number.isFinite(stretchedCm)) return null;
  const travel = stretchedCm - compressedCm;
  if (Math.abs(travel) < 0.01) return null;
  const signedTravel = Math.sign(travel) * Math.max(Math.abs(travel), 0.25);
  return clamp((distanceCm - compressedCm) / signedTravel, 0, 1);
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

// EMA alpha for angle smoothing in motion tracker. Matches the Python jitter.py value.
const MOTION_EMA_ALPHA = 0.40;

function updateMotion(samples, timestamp, elbowAngle) {
  if (elbowAngle == null) {
    samples.length = 0;
    return { pace: "unknown", jitter: 0, velocity: 0, smoothedAngle: null };
  }

  // Apply EMA to raw angle before storing — eliminates single-frame landmark bounce
  const prev = samples.at(-1);
  const emaAngle = prev == null
    ? elbowAngle
    : MOTION_EMA_ALPHA * elbowAngle + (1 - MOTION_EMA_ALPHA) * prev.emaAngle;

  samples.push({ timestamp, elbowAngle, emaAngle });
  // 26 samples ≈ 1.7 s at 15 Hz — matches Python tracker window
  while (samples.length > 26) samples.shift();
  if (samples.length < 3) return { pace: "unknown", jitter: 0, velocity: 0, smoothedAngle: emaAngle };

  // Velocities computed on EMA-smoothed angles — not raw
  const velocities = [];
  for (let i = 1; i < samples.length; i += 1) {
    const previous = samples[i - 1];
    const current = samples[i];
    const dt = Math.max((current.timestamp - previous.timestamp) / 1000, 0.001);
    velocities.push((current.emaAngle - previous.emaAngle) / dt);
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
  return { pace, jitter, velocity, smoothedAngle: emaAngle };
}

function activeSharedStream() {
  if (!sharedCameraStream) return null;
  const hasLiveTrack = sharedCameraStream.getVideoTracks().some((track) => track.readyState === "live");
  if (!hasLiveTrack) sharedCameraStream = null;
  return sharedCameraStream;
}

function rememberCameraEnabled(value) {
  try {
    if (value) {
      window.localStorage.setItem(CAMERA_PREF_KEY, "true");
    } else {
      window.localStorage.removeItem(CAMERA_PREF_KEY);
    }
  } catch {
    // Browser storage is a convenience; camera permission itself is browser-managed.
  }
}

function rememberedCameraEnabled() {
  try {
    return window.localStorage.getItem(CAMERA_PREF_KEY) === "true";
  } catch {
    return false;
  }
}

async function browserCameraPermissionGranted() {
  try {
    if (!navigator.permissions?.query) return false;
    const status = await navigator.permissions.query({ name: "camera" });
    return status.state === "granted";
  } catch {
    return false;
  }
}

export default function BrowserPoseOverlay({
  active,
  sessionId,
  onPacket,
  onRoutineBegin,
  side = "right",
  exercise,
  recordingActive = true,
  overlayCoachMessage = "",
  bonusRepRequested = false
}) {
  const activeSide = POSE[side] ? side : "right";
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const poseRef = useRef(null);
  const handRef = useRef(null);
  const rafRef = useRef(null);
  const samplesRef = useRef([]);
  const lastDetectAtRef = useRef(0);
  const lastPostAtRef = useRef(0);
  const latestPacketRef = useRef(null);
  const latestPoseRef = useRef(null);
  const latestHandsRef = useRef([]);
  const debugModeRef = useRef(false);
  const analyzerRef = useRef(createAnalyzerForExercise(exercise));
  const previousSessionRef = useRef(sessionId);
  const previousRecordingRef = useRef(recordingActive);
  const calibrationReadyUntilRef = useRef(0);
  const [calibration, setCalibration] = useState({ compressedCm: null, stretchedCm: null });
  const [routineStarted, setRoutineStarted] = useState(false);
  const calibrationRef = useRef(calibration);
  const routineStartedRef = useRef(routineStarted);
  // Auto-calibration state
  const [autoCalState, setAutoCalState] = useState("idle"); // idle | scanning | confirmed
  const autoCalWindowRef = useRef([]); // rolling distance samples for range detection
  const autoCalStableRef = useRef(0); // ms the range has been stable
  const [cameraState, setCameraState] = useState("idle");
  const [cameraError, setCameraError] = useState("");
  const [debugMode, setDebugMode] = useState(false);

  const recordingActiveRef = useRef(recordingActive);
  const overlayCoachMessageRef = useRef(overlayCoachMessage);
  const onPacketRef = useRef(onPacket);
  const onRoutineBeginRef = useRef(onRoutineBegin);
  const exerciseRef = useRef(exercise);
  const sessionIdRef = useRef(sessionId);
  const activeSideRef = useRef(activeSide);

  useEffect(() => { recordingActiveRef.current = recordingActive; }, [recordingActive]);
  useEffect(() => { overlayCoachMessageRef.current = overlayCoachMessage; }, [overlayCoachMessage]);
  useEffect(() => { onPacketRef.current = onPacket; }, [onPacket]);
  useEffect(() => { onRoutineBeginRef.current = onRoutineBegin; }, [onRoutineBegin]);
  useEffect(() => { calibrationRef.current = calibration; }, [calibration]);
  useEffect(() => { routineStartedRef.current = routineStarted; }, [routineStarted]);
  useEffect(() => { exerciseRef.current = exercise; }, [exercise]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { activeSideRef.current = activeSide; }, [activeSide]);

  const forwardPressExercise = isForwardPressExercise(exercise);
  const calibrationComplete = !forwardPressExercise ||
    (Number.isFinite(calibration.compressedCm) && Number.isFinite(calibration.stretchedCm));
  const calibrationTravelCm = Number.isFinite(calibration.compressedCm) && Number.isFinite(calibration.stretchedCm)
    ? Math.abs(calibration.stretchedCm - calibration.compressedCm)
    : null;
  const calibrationQuality = !forwardPressExercise || !calibrationComplete
    ? "missing"
    : calibrationTravelCm < 1
      ? "low_travel"
      : "ok";

  const sensorStream = useSensorStream({
    active: Boolean(active && forwardPressExercise)
  });

  useEffect(() => {
    if (forwardPressExercise && calibrationComplete) {
      calibrationReadyUntilRef.current = Date.now() + 1600;
      routineStartedRef.current = true;
      setRoutineStarted(true);
      onRoutineBeginRef.current?.();
    }
    if (!calibrationComplete) {
      calibrationReadyUntilRef.current = 0;
      routineStartedRef.current = false;
      setRoutineStarted(false);
    }
  }, [calibrationComplete, forwardPressExercise]);

  // ── Auto-calibration scanning loop ────────────────────────────────────────
  // While autoCalState === "scanning", poll sensor samples every 200 ms.
  // Track rolling min/max over a ~6 s window; when the range has been stable
  // (settled within ±0.4 cm) for 1.5 s AND travel > MIN_TRAVEL_CM, lock in.
  useEffect(() => {
    if (autoCalState !== "scanning" || !forwardPressExercise) return undefined;

    const MIN_TRAVEL_CM = 3.0;  // minimum hand movement to accept calibration
    const SCAN_WINDOW_MS = 6000;
    const STABLE_NEEDED_MS = 1500;
    const STABLE_TOLERANCE_CM = 0.4;

    const interval = window.setInterval(() => {
      const now = Date.now();
      const rawSamples = sensorStream.samplesRef.current;
      if (!rawSamples.length) return;

      // Keep only samples from the last SCAN_WINDOW_MS
      const cutoff = now - SCAN_WINDOW_MS;
      const recent = rawSamples.filter((s) => s.timestamp_ms >= cutoff);
      autoCalWindowRef.current = recent;

      if (recent.length < 8) return; // not enough data yet

      const distances = recent.map((s) => s.distance_cm).filter(Number.isFinite);
      const minD = Math.min(...distances);
      const maxD = Math.max(...distances);
      const travel = maxD - minD;

      if (travel < MIN_TRAVEL_CM) return; // user hasn't moved enough yet

      // Check stability: split window in halves and compare max/min drift
      const half = Math.floor(recent.length / 2);
      const firstHalf = recent.slice(0, half).map((s) => s.distance_cm).filter(Number.isFinite);
      const secondHalf = recent.slice(half).map((s) => s.distance_cm).filter(Number.isFinite);
      const rangeFirst = Math.max(...firstHalf) - Math.min(...firstHalf);
      const rangeSecond = Math.max(...secondHalf) - Math.min(...secondHalf);
      const drift = Math.abs(rangeFirst - rangeSecond);

      if (drift > STABLE_TOLERANCE_CM) {
        // Range is still changing — reset stable timer
        autoCalStableRef.current = now;
        return;
      }

      if (autoCalStableRef.current === 0) {
        autoCalStableRef.current = now;
        return;
      }

      if (now - autoCalStableRef.current >= STABLE_NEEDED_MS) {
        // Stable and sufficient travel — lock calibration
        const compressedCm = Math.round(minD * 100) / 100;
        const stretchedCm = Math.round(maxD * 100) / 100;
        setCalibration({ compressedCm, stretchedCm });
        calibrationRef.current = { compressedCm, stretchedCm };
        setAutoCalState("confirmed");
        autoCalStableRef.current = 0;
      }
    }, 200);

    return () => window.clearInterval(interval);
  }, [autoCalState, forwardPressExercise, sensorStream.samplesRef]);

  useEffect(() => {
    let cancelled = false;
    async function resumeCameraIfAllowed() {
      const canResume = Boolean(activeSharedStream()) || (rememberedCameraEnabled() && await browserCameraPermissionGranted());
      if (!cancelled && canResume) startCamera({ autoResume: true });
    }
    resumeCameraIfAllowed();
    return () => {
      cancelled = true;
      detachCamera();
    };
  }, []);
  useEffect(() => {
    debugModeRef.current = debugMode;
  }, [debugMode]);
  useEffect(() => {
    analyzerRef.current = createAnalyzerForExercise(exercise);
    previousSessionRef.current = sessionId;
    calibrationRef.current = { compressedCm: null, stretchedCm: null };
    routineStartedRef.current = false;
    setCalibration({ compressedCm: null, stretchedCm: null });
    setRoutineStarted(false);
  }, [exercise?.id]);
  useEffect(() => {
    if (previousSessionRef.current !== sessionId) {
      if (!recordingActive) {
        analyzerRef.current.reset();
        samplesRef.current = [];
      }
      previousSessionRef.current = sessionId;
      calibrationRef.current = { compressedCm: null, stretchedCm: null };
      routineStartedRef.current = false;
      setCalibration({ compressedCm: null, stretchedCm: null });
      setRoutineStarted(false);
    }
  }, [recordingActive, sessionId]);
  useEffect(() => {
    if (!previousRecordingRef.current && recordingActive) {
      analyzerRef.current.reset();
      samplesRef.current = [];
    }
    previousRecordingRef.current = recordingActive;
  }, [recordingActive]);
  useEffect(() => {
    if (bonusRepRequested && analyzerRef.current?.extendRepGoal) {
      analyzerRef.current.extendRepGoal(1);
    }
  }, [bonusRepRequested]);

  async function createLandmarkers(delegate = "GPU") {
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

  async function loadLandmarkers() {
    if (sharedLandmarkers) return sharedLandmarkers;
    if (sharedLandmarkersPromise) return sharedLandmarkersPromise;
    sharedLandmarkersPromise = (async () => {
      try {
        return await createLandmarkers("GPU");
      } catch {
        return createLandmarkers("CPU");
      }
    })();
    sharedLandmarkers = await sharedLandmarkersPromise;
    sharedLandmarkersPromise = null;
    return sharedLandmarkers;
  }

  async function startCamera({ autoResume = false } = {}) {
    try {
      setCameraState("loading");
      setCameraError("");

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not expose webcam access.");
      }

      streamRef.current = activeSharedStream();
      if (!streamRef.current) {
        if (autoResume && rememberedCameraEnabled() && !(await browserCameraPermissionGranted())) {
          setCameraState("idle");
          return;
        }
        sharedCameraStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 960 },
            height: { ideal: 540 },
            facingMode: "user"
          },
          audio: false
        });
        streamRef.current = sharedCameraStream;
      }

      videoRef.current.srcObject = streamRef.current;
      await videoRef.current.play();

      const models = await loadLandmarkers();
      poseRef.current = models.pose;
      handRef.current = models.hands;

      rememberCameraEnabled(true);
      setCameraState("ready");
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(loop);
    } catch (error) {
      setCameraState("error");
      setCameraError(error.message);
    }
  }

  function detachCamera() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    streamRef.current = null;
    poseRef.current = null;
    handRef.current = null;
  }

  function stopCamera() {
    detachCamera();
    activeSharedStream()?.getTracks().forEach((track) => track.stop());
    sharedCameraStream = null;
    sharedLandmarkers?.pose?.close?.();
    sharedLandmarkers?.hands?.close?.();
    sharedLandmarkers = null;
    sharedLandmarkersPromise = null;
    rememberCameraEnabled(false);
    setCameraState((state) => state === "idle" ? "idle" : "stopped");
  }

  function captureCalibrationPoint(kind) {
    const latestSensor = sensorStream.latestSampleRef.current;
    if (!Number.isFinite(latestSensor?.distance_cm)) return;
    setCalibration((current) => {
      const next = {
        ...current,
        [kind]: latestSensor.distance_cm
      };
      calibrationRef.current = next;
      return next;
    });
    analyzerRef.current?.reset?.();
    routineStartedRef.current = false;
    setRoutineStarted(false);
  }

  function beginRoutine() {
    analyzerRef.current?.reset?.();
    samplesRef.current = [];
    calibrationReadyUntilRef.current = Date.now() + 1200;
    routineStartedRef.current = true;
    setRoutineStarted(true);
    onRoutineBeginRef.current?.();
  }

  function buildPacket(poseLandmarks, handLandmarks, timestampMs) {
    const exercise = exerciseRef.current;
    const activeSide = activeSideRef.current;
    const sessionId = sessionIdRef.current;
    const targetAngle = exerciseTargetAngle(exercise);
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
    const upperArmAngle = baseReady ? calculateShoulderRaiseAngleFromScreen(shoulder, elbow) : null;
    const elbowAngle = baseReady ? angle(shoulder, elbow, wrist) : null;
    const calculatedAngles = upperArmAngle != null && elbowAngle != null;
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

    // updateMotion applies EMA internally; smoothedAngle is used for analyzer input
    // so rep transitions and jitter are computed on the same stable signal.
    const motion = updateMotion(samplesRef.current, timestampMs, validAnalysis ? elbowAngle : null);
    const analyzerElbowAngle = (validAnalysis && motion.smoothedAngle != null)
      ? motion.smoothedAngle
      : elbowAngle;
    const latestSensor = sensorStream.latestSampleRef.current;
    const isForwardPress = isForwardPressExercise(exercise);
    const currentCalibration = calibrationRef.current;
    const packetCalibrationComplete = !isForwardPress ||
      (Number.isFinite(currentCalibration.compressedCm) && Number.isFinite(currentCalibration.stretchedCm));
    const packetCalibrationTravelCm = Number.isFinite(currentCalibration.compressedCm) && Number.isFinite(currentCalibration.stretchedCm)
      ? Math.abs(currentCalibration.stretchedCm - currentCalibration.compressedCm)
      : null;
    const packetCalibrationQuality = !isForwardPress || !packetCalibrationComplete
      ? "missing"
      : packetCalibrationTravelCm < 1
        ? "low_travel"
        : "ok";
    const sensorStatus = isForwardPress
      ? sensorStatusForSample(sensorStream, latestSensor, true, exercise?.sensorStaleMs ?? 600)
      : "offline";
    const sensorJitterScore = latestSensor?.sensor_jitter_score ?? 0;
    const calibratedPosition = isForwardPress && packetCalibrationComplete
      ? calibratedPositionForDistance(latestSensor?.distance_cm, currentCalibration.compressedCm, currentCalibration.stretchedCm)
      : null;
    const combinedJitter = validAnalysis
      ? isForwardPress
        ? Math.max(motion.jitter / 2, packetCalibrationComplete ? 0 : sensorJitterScore)
        : motion.jitter / 2
      : 0;
    const currentRange = validAnalysis && exercise?.targetPosition
      ? elbowAngle <= exercise.targetPosition.elbowAngleMax && elbowAngle >= exercise.targetPosition.elbowAngleMin
        ? "target_met"
        : isForwardPress
          ? elbowAngle < exercise.targetPosition.elbowAngleMin
            ? "almost_there"
            : "overextended"
          : elbowAngle > exercise.targetPosition.elbowAngleMax
            ? "almost_there"
            : "overextended"
      : "unknown";
    // For the chest press, evaluate framing before analysis so the cue can be voiced.
    const framingResult = isForwardPress && validAnalysis
      ? analyzePressFaming(
          shoulderSample.point,
          elbowSample.point,
          wristSample.point,
        )
      : null;

    const analyzerFrame = {
      timestampMs: Math.round(Date.now()),
      // Use EMA-smoothed angle so phase transitions don't trigger on single noisy frames
      elbowAngle: validAnalysis ? analyzerElbowAngle : null,
      shoulderAngle: validAnalysis ? upperArmAngle : null,
      landmarkConfidence: confidence,
      jitterScore: combinedJitter,
      cameraJitterScore: motion.jitter,
      distanceCm: latestSensor?.distance_cm ?? null,
      sensorTimestampMs: latestSensor?.timestamp_ms ?? null,
      sensorJitterScore: packetCalibrationComplete ? 0 : sensorJitterScore,
      calibrationCompressedCm: currentCalibration.compressedCm,
      calibrationStretchedCm: currentCalibration.stretchedCm,
      sensorValid: sensorStatus === "ok",
      validLandmarks: validAnalysis
    };
    const analysisActive = !isForwardPress || (packetCalibrationComplete && routineStartedRef.current);
    const analyzerOutput = analysisActive
      ? analyzerRef.current.analyze(analyzerFrame)
      : analyzerRef.current.preview(analyzerFrame);
    // Framing cues override coach message when arm is not well-positioned in frame.
    // Only override during waiting/pre-rep phases so it doesn't interrupt mid-rep.
    const preRepPhases = new Set(["WAITING_FOR_TRACKING", "MOVE_TO_BENT", "START_BENT_HOLD", "START_BENT_READY"]);
    if (framingResult && !framingResult.ok && preRepPhases.has(analyzerOutput.phase)) {
      analyzerOutput.coach_state = framingResult.state;
      analyzerOutput.local_coach_message = framingResult.cue;
    }

    if (isForwardPress && !packetCalibrationComplete) {
      analyzerOutput.coach_state = sensorStatus === "ok" ? "almost_there" : "low_confidence";
      analyzerOutput.local_coach_message = "Calibrate the bent and stretched distances before pressing.";
    }
    if (isForwardPress && packetCalibrationComplete && Date.now() < calibrationReadyUntilRef.current) {
      analyzerOutput.phase = "CALIBRATION_READY";
      analyzerOutput.coach_state = "good_form";
      analyzerOutput.local_coach_message = "Calibration set. Begin now.";
    }
    const packetSensorJitter = isForwardPress && packetCalibrationComplete
      ? analyzerOutput.sensor_linearity_score ?? sensorJitterScore
      : sensorJitterScore;
    const state = analyzerOutput.coach_state;

    return {
      source: "browser_mediapipe",
      session_id: sessionId || "browser-webcam",
      timestamp_ms: Math.round(Date.now()),
      exercise: exercise?.id || "elbow_flexion_extension",
      side: activeSide,
      device_id: latestSensor?.device_id || "browser-webcam",
      sensor_status: sensorStatus,
      camera_status: cameraStatus,
      distance_cm: latestSensor?.distance_cm ?? null,
      sensor_jitter_score: Number(packetSensorJitter.toFixed(3)),
      opencv_jitter_score: Number(motion.jitter.toFixed(3)),
      combined_jitter_score: Number(Math.max(combinedJitter, analyzerOutput.jitter_score ?? 0).toFixed(3)),
      jitter_detected: validAnalysis && Math.max(combinedJitter, analyzerOutput.jitter_score ?? 0) > 0.65,
      shoulder_angle: validAnalysis ? Number(upperArmAngle.toFixed(1)) : null,
      elbow_angle: validAnalysis ? Number(elbowAngle.toFixed(1)) : null,
      elbow_angle_smoothed: validAnalysis && motion.smoothedAngle != null ? Number(motion.smoothedAngle.toFixed(1)) : null,
      target_angle: targetAngle,
      landmark_confidence: Number(confidence.toFixed(3)),
      rep_count: analyzerOutput.rep_count,
      rep_phase: validAnalysis ? repPhaseForAnalyzerPhase(analyzerOutput.phase) : "idle",
      hold_time_sec: Number((analyzerOutput.hold_time_sec || 0).toFixed(1)),
      pace: analyzerOutput.pace,
      range_status: currentRange,
      compensation,
      physio_score: analyzerOutput.physio_score,
      coach_state: state,
      local_coach_message: analyzerOutput.local_coach_message,
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
      analyzer_output: analyzerOutput,
      analyzer_phase_label: humanPhaseForAnalyzerPhase(analyzerOutput.phase),
      range_of_motion: analyzerOutput.range_of_motion,
      push_depth_cm: analyzerOutput.push_depth_cm,
      sensor_linearity_score: analyzerOutput.sensor_linearity_score,
      sensor_valid: analyzerOutput.sensor_valid,
      calibration_complete: packetCalibrationComplete,
      calibration_quality: packetCalibrationQuality,
      calibration_travel_cm: packetCalibrationTravelCm == null ? null : Number(packetCalibrationTravelCm.toFixed(2)),
      calibration_compressed_cm: currentCalibration.compressedCm,
      calibration_stretched_cm: currentCalibration.stretchedCm,
      calibrated_position: calibratedPosition == null ? null : Number(calibratedPosition.toFixed(3)),
      sensor_command_status: sensorStream.commandStatus,
      sensor_stream_url: sensorStream.url,
      shoulder_drift: analyzerOutput.shoulder_drift,
      completed_rep: analyzerOutput.completed_rep,
      framing_cue: framingResult?.cue ?? null,
      framing_ok: framingResult?.ok ?? true,
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
    ctx.fillText(`Physio | ${exerciseRef.current?.shortName || "webcam tracking"}`, 28, 44);
    ctx.fillStyle = "#f4f1e8";
    ctx.font = "700 18px Segoe UI";
    ctx.fillText(`Upper arm ${formatMaybeAngle(packet.shoulder_angle)} deg | Elbow ${formatMaybeAngle(packet.elbow_angle)} deg`, 28, 78);
    ctx.fillText(`Rep ${packet.rep_count} | ${packet.analyzer_phase_label || packet.rep_phase} | Score ${packet.physio_score ?? "--"}`, 28, 110);
    const coachLine = overlayCoachMessageRef.current || packet.ai_coach_message || packet.local_coach_message;
    ctx.fillText(coachLine, 28, 142);

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
      // Wrist: larger ring for chest press so the push endpoint is clearly visible
      if (wrist) {
        const isPressMode = isForwardPressExercise(exerciseRef.current);
        if (isPressMode) {
          // Double-ring wrist marker for chest press
          ctx.beginPath();
          ctx.strokeStyle = "#ff7464";
          ctx.lineWidth = 2;
          ctx.arc(wrist.x, wrist.y, 16, 0, Math.PI * 2);
          ctx.stroke();
        }
        drawPoint(ctx, wrist, "#ff7464", isPressMode ? 9 : 7);
      }

      if (packet.angle_valid && shoulder) {
        ctx.beginPath();
        ctx.strokeStyle = "#56d8a7";
        ctx.lineWidth = 5;
        ctx.arc(shoulder.x, shoulder.y, 82, -Math.PI / 2 - 0.15, -Math.PI / 2 + 0.15);
        ctx.stroke();
      }

      // Palm centre from hand landmarks — chest press specific
      if (isForwardPressExercise(exerciseRef.current) && handLandmarks?.length) {
        const palmPx = palmCenterFromHandLandmarks(handLandmarks[0], width, height);
        if (palmPx) {
          // Outer ring
          ctx.beginPath();
          ctx.strokeStyle = "#56d8a7";
          ctx.lineWidth = 2;
          ctx.arc(palmPx.x, palmPx.y, 18, 0, Math.PI * 2);
          ctx.stroke();
          // Filled centre
          ctx.beginPath();
          ctx.fillStyle = "#56d8a7";
          ctx.arc(palmPx.x, palmPx.y, 7, 0, Math.PI * 2);
          ctx.fill();
          // Label
          ctx.fillStyle = "#56d8a7";
          ctx.font = "600 13px Segoe UI";
          ctx.fillText("PALM", palmPx.x + 22, palmPx.y + 5);
          // Line from wrist to palm centre
          if (wrist) {
            ctx.beginPath();
            ctx.strokeStyle = "rgba(86,216,167,.45)";
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.moveTo(wrist.x, wrist.y);
            ctx.lineTo(palmPx.x, palmPx.y);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }
    }

    // Framing guide border + cue for chest press
    if (isForwardPressExercise(exerciseRef.current) && packet.angle_valid) {
      const framingOk = packet.framing_ok !== false;
      const borderColor = framingOk ? "rgba(86,216,167,.5)" : "rgba(95,185,244,.85)";
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 4;
      ctx.strokeRect(6, 6, width - 12, height - 12);

      if (!framingOk && packet.framing_cue) {
        ctx.fillStyle = "rgba(15,17,16,.82)";
        ctx.fillRect(0, height - 62, width, 62);
        ctx.fillStyle = "#5fb9f4";
        ctx.font = "700 17px Segoe UI";
        ctx.fillText(packet.framing_cue, 22, height - 30);
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
    onPacketRef.current?.(packet);
    if (debugModeRef.current) {
      console.log("Physio analysis debug", {
        shoulder: packet._debug_landmarks?.shoulder || null,
        elbow: packet._debug_landmarks?.elbow || null,
        wrist: packet._debug_landmarks?.wrist || null,
        hip_present: packet.hip_present,
        landmark_confidence: packet.landmark_confidence,
        angle_valid: packet.angle_valid,
        angle_rejection_reason: packet.angle_rejection_reason,
        upper_arm_angle: packet.shoulder_angle,
        elbow_angle: packet.elbow_angle,
        analyzer_phase: packet.analyzer_output?.phase,
        phase_label: packet.analyzer_phase_label,
        rep_count: packet.rep_count,
        coach_state: packet.coach_state
      });
    }
    if (recordingActiveRef.current && packet.calibration_complete !== false) {
      try {
        await postPacket(packet);
      } catch {
        // The visual tracker remains useful even if the backend is offline.
      }
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
      {forwardPressExercise && cameraState === "ready" && (
        <AutoCalibrationPanel
          sensorStream={sensorStream}
          autoCalState={autoCalState}
          calibration={calibration}
          calibrationComplete={calibrationComplete}
          calibrationQuality={calibrationQuality}
          onStartScan={() => {
            autoCalStableRef.current = 0;
            autoCalWindowRef.current = [];
            setAutoCalState("scanning");
            setCalibration({ compressedCm: null, stretchedCm: null });
            calibrationRef.current = { compressedCm: null, stretchedCm: null };
            analyzerRef.current?.reset?.();
            routineStartedRef.current = false;
            setRoutineStarted(false);
          }}
          onReset={() => {
            setAutoCalState("idle");
            autoCalStableRef.current = 0;
            autoCalWindowRef.current = [];
            setCalibration({ compressedCm: null, stretchedCm: null });
            calibrationRef.current = { compressedCm: null, stretchedCm: null };
            analyzerRef.current?.reset?.();
            routineStartedRef.current = false;
            setRoutineStarted(false);
          }}
          onBegin={beginRoutine}
        />
      )}
    </div>
  );
}

function formatDistance(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} cm` : "--";
}

/**
 * AutoCalibrationPanel
 *
 * Replaces the old "Set Bent / Set Stretched" button pair.
 *
 * Flow:
 *   idle      → user taps "Start calibration"
 *   scanning  → user moves hand in/out; system tracks min/max distance
 *   confirmed → range locked; user taps "Begin" to start reps
 */
function AutoCalibrationPanel({
  sensorStream,
  autoCalState,
  calibration,
  calibrationComplete,
  calibrationQuality,
  onStartScan,
  onReset,
  onBegin,
}) {
  const hasSensor = Number.isFinite(sensorStream.latest?.distance_cm);
  const liveDist = hasSensor ? sensorStream.latest.distance_cm.toFixed(2) : null;
  const travel = Number.isFinite(calibration.compressedCm) && Number.isFinite(calibration.stretchedCm)
    ? Math.abs(calibration.stretchedCm - calibration.compressedCm)
    : 0;
  // Progress bar: travel relative to 5 cm target
  const progress = Math.min(travel / 5, 1);

  return (
    <div className="sensor-calibration-panel">
      <div className="calibration-current">
        <p className="eyebrow">Sensor calibration</p>
        <strong className="live-distance-value">
          {liveDist != null ? `${liveDist} cm` : "Waiting for sensor"}
        </strong>
      </div>

      {autoCalState === "idle" && (
        <>
          <button
            type="button"
            className="calibration-begin"
            onClick={onStartScan}
            disabled={!hasSensor}
          >
            Start calibration
          </button>
          <small>Press the button then slowly move your hand forward and back a few times.</small>
        </>
      )}

      {autoCalState === "scanning" && (
        <>
          <p className="calibration-scanning-hint">
            Move your hand <strong>in and out</strong> slowly — full bent to full press.
          </p>
          <div className="cal-progress-bar-track">
            <div
              className="cal-progress-bar-fill"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="calibration-values">
            <span><em>Near</em> <strong>{formatDistance(calibration.compressedCm)}</strong></span>
            <span><em>Far</em> <strong>{formatDistance(calibration.stretchedCm)}</strong></span>
            <span><em>Range</em> <strong>{travel > 0 ? `${travel.toFixed(1)} cm` : "--"}</strong></span>
          </div>
          <small>Keep moving until the bar fills — system will lock automatically.</small>
          <button type="button" className="calibration-reset-btn" onClick={onReset}>Cancel</button>
        </>
      )}

      {autoCalState === "confirmed" && (
        <>
          <div className="calibration-values calibration-locked">
            <span>✓ <em>Bent</em> <strong>{formatDistance(calibration.compressedCm)}</strong></span>
            <span>✓ <em>Extended</em> <strong>{formatDistance(calibration.stretchedCm)}</strong></span>
            <span><em>Range</em> <strong>{travel.toFixed(1)} cm</strong></span>
          </div>
          <small className="calibration-ready">
            {calibrationQuality === "low_travel"
              ? "Calibrated — try a wider range for better scoring."
              : "Calibrated and ready."}
          </small>
          <div className="calibration-actions">
            <button type="button" className="calibration-begin" onClick={onBegin}>
              Begin
            </button>
            <button type="button" className="calibration-reset-btn" onClick={onReset}>
              Redo
            </button>
          </div>
        </>
      )}
    </div>
  );
}
