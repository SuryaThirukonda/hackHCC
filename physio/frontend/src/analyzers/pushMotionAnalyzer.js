const COACH_MESSAGES = {
  good_form: "Good control.",
  start_bent: "Bend to start.",
  move_to_bent: "Move to bent.",
  begin_routine: "Calibration set. Begin now.",
  push_forward: "Press forward.",
  hold_reach: "Hold reach.",
  return_control: "Return slowly.",
  keep_level: "Keep arm level.",
  almost_there: "Keep hand on sensor path.",
  keep_upper_arm_still: "Keep arm level.",
  too_fast: "Slow down.",
  too_jittery: "Move smoothly.",
  hold_longer: "Hold briefly.",
  rep_complete: "Good press.",
  session_complete: "Session complete.",
  low_confidence: "Keep arm visible."
};

const DEFAULT_CONFIG = {
  exerciseId: "seated_one_arm_forward_press",
  exerciseName: "Seated One-Arm Forward Press",
  side: "right",
  repGoal: 8,
  startBentMin: 65,
  startBentMax: 115,
  targetExtensionMin: 145,
  targetExtensionMax: 178,
  requiredHoldSeconds: 1.0,
  minRepSeconds: 2.0,
  maxRepSeconds: 7.0,
  minConfidence: 0.45,
  targetPushDepthCm: 10,
  minPushDepthCm: 6,
  returnDepthCm: 2.5,
  startBentHoldSeconds: 0.7,
  sensorStaleMs: 500,
  jitterWarning: 0.38,
  shoulderDriftWarning: 24,
  transitionDebounceMs: 120,
  staleFrameMs: 1500
};

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function round(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function paceForDuration(durationSec, config) {
  if (!durationSec) return "unknown";
  if (durationSec < config.minRepSeconds) return "too_fast";
  if (durationSec > config.maxRepSeconds) return "too_slow";
  return "good";
}

function scorePace(pace, durationSec, config) {
  if (pace === "good") return 100;
  if (!durationSec) return 65;
  if (pace === "too_fast") return clamp((durationSec / config.minRepSeconds) * 100, 0, 100);
  const overage = durationSec - config.maxRepSeconds;
  return clamp(100 - overage * 16, 0, 100);
}

function normalizeConfig(exercise = {}) {
  return {
    ...DEFAULT_CONFIG,
    exerciseId: exercise.id || DEFAULT_CONFIG.exerciseId,
    exerciseName: exercise.name || DEFAULT_CONFIG.exerciseName,
    side: exercise.side || DEFAULT_CONFIG.side,
    repGoal: exercise.repGoal || DEFAULT_CONFIG.repGoal,
    startBentMin: exercise.startPosition?.elbowAngleMin ?? DEFAULT_CONFIG.startBentMin,
    startBentMax: exercise.startPosition?.elbowAngleMax ?? DEFAULT_CONFIG.startBentMax,
    targetExtensionMin: exercise.targetPosition?.elbowAngleMin ?? DEFAULT_CONFIG.targetExtensionMin,
    targetExtensionMax: exercise.targetPosition?.elbowAngleMax ?? DEFAULT_CONFIG.targetExtensionMax,
    requiredHoldSeconds: exercise.holdSeconds ?? DEFAULT_CONFIG.requiredHoldSeconds,
    minRepSeconds: exercise.minRepSeconds ?? DEFAULT_CONFIG.minRepSeconds,
    maxRepSeconds: exercise.maxRepSeconds ?? DEFAULT_CONFIG.maxRepSeconds,
    targetPushDepthCm: exercise.targetPushDepthCm ?? DEFAULT_CONFIG.targetPushDepthCm,
    minPushDepthCm: exercise.minPushDepthCm ?? DEFAULT_CONFIG.minPushDepthCm,
    sensorStaleMs: exercise.sensorStaleMs ?? DEFAULT_CONFIG.sensorStaleMs,
    jitterWarning: exercise.jitterThreshold ?? DEFAULT_CONFIG.jitterWarning,
    shoulderDriftWarning: exercise.shoulderDriftThreshold ?? DEFAULT_CONFIG.shoulderDriftWarning
  };
}

function linearityScore(samples) {
  const valid = samples
    .filter((sample) => Number.isFinite(sample.distanceCm) && Number.isFinite(sample.timestampMs))
    .slice(-30);
  if (valid.length < 4) return 0;

  const first = valid[0];
  const last = valid.at(-1);
  const durationMs = Math.max(last.timestampMs - first.timestampMs, 1);
  const netChange = last.distanceCm - first.distanceCm;
  const netDistance = Math.abs(netChange);

  let residualTotal = 0;
  for (const sample of valid) {
    const progress = (sample.timestampMs - first.timestampMs) / durationMs;
    const expected = first.distanceCm + netChange * progress;
    residualTotal += Math.abs(sample.distanceCm - expected);
  }
  const residualScore = clamp((residualTotal / valid.length) / Math.max(netDistance, 1.5), 0, 1);

  const velocities = [];
  for (let i = 1; i < valid.length; i += 1) {
    const previous = valid[i - 1];
    const current = valid[i];
    const dt = Math.max((current.timestampMs - previous.timestampMs) / 1000, 0.001);
    velocities.push((current.distanceCm - previous.distanceCm) / dt);
  }

  let signChanges = 0;
  const jumps = [];
  for (let i = 1; i < velocities.length; i += 1) {
    jumps.push(Math.abs(velocities[i] - velocities[i - 1]));
    if (Math.sign(velocities[i]) && Math.sign(velocities[i - 1]) && Math.sign(velocities[i]) !== Math.sign(velocities[i - 1])) {
      signChanges += 1;
    }
  }
  const averageJump = jumps.reduce((sum, value) => sum + value, 0) / Math.max(jumps.length, 1);
  const jerkScore = clamp(averageJump / 120, 0, 1);
  const wobbleScore = clamp(signChanges / Math.max(velocities.length - 1, 1), 0, 1);
  return clamp(residualScore * 0.45 + jerkScore * 0.4 + wobbleScore * 0.15, 0, 1);
}

function calibratedPosition(distanceCm, compressedCm, stretchedCm) {
  if (!Number.isFinite(distanceCm) || !Number.isFinite(compressedCm) || !Number.isFinite(stretchedCm)) return null;
  const travel = stretchedCm - compressedCm;
  if (Math.abs(travel) < 0.01) return null;
  const signedTravel = Math.sign(travel) * Math.max(Math.abs(travel), 0.25);
  return clamp((distanceCm - compressedCm) / signedTravel, 0, 1);
}

function calibratedJitterScore(samples, compressedCm, stretchedCm) {
  const valid = samples
    .map((sample) => ({
      timestampMs: sample.timestampMs,
      position: calibratedPosition(sample.distanceCm, compressedCm, stretchedCm)
    }))
    .filter((sample) => Number.isFinite(sample.timestampMs) && Number.isFinite(sample.position))
    .slice(-30);
  if (valid.length < 4) return 0;

  const first = valid[0];
  const last = valid.at(-1);
  const durationMs = Math.max(last.timestampMs - first.timestampMs, 1);
  const netChange = last.position - first.position;
  const netMotion = Math.abs(netChange);

  let residualTotal = 0;
  for (const sample of valid) {
    const progress = (sample.timestampMs - first.timestampMs) / durationMs;
    const expected = first.position + netChange * progress;
    residualTotal += Math.abs(sample.position - expected);
  }
  const residualScore = clamp((residualTotal / valid.length) / Math.max(netMotion, 0.08), 0, 1);

  const velocities = [];
  for (let i = 1; i < valid.length; i += 1) {
    const previous = valid[i - 1];
    const current = valid[i];
    const dt = Math.max((current.timestampMs - previous.timestampMs) / 1000, 0.001);
    velocities.push((current.position - previous.position) / dt);
  }

  let directionFlips = 0;
  const accelerationChanges = [];
  for (let i = 1; i < velocities.length; i += 1) {
    accelerationChanges.push(Math.abs(velocities[i] - velocities[i - 1]));
    if (
      Math.abs(velocities[i]) > 0.05 &&
      Math.abs(velocities[i - 1]) > 0.05 &&
      Math.sign(velocities[i]) !== Math.sign(velocities[i - 1])
    ) {
      directionFlips += 1;
    }
  }
  const accelerationScore = clamp(
    (accelerationChanges.reduce((sum, value) => sum + value, 0) / Math.max(accelerationChanges.length, 1)) / 5,
    0,
    1
  );
  const reversalScore = clamp(directionFlips / Math.max(velocities.length - 1, 1), 0, 1);

  return clamp(residualScore * 0.45 + accelerationScore * 0.35 + reversalScore * 0.2, 0, 1);
}

function physioScore({ rangeOfMotion, pushDepthCm, jitterScore, pace, holdTimeSec, repDurationSec, shoulderDrift }, config) {
  const extensionScore = clamp((rangeOfMotion / Math.max(config.targetExtensionMin - config.startBentMax, 1)) * 100, 0, 100);
  const depthScore = pushDepthCm == null
    ? 72
    : clamp((pushDepthCm / Math.max(config.targetPushDepthCm, 1)) * 100, 0, 100);
  const smoothnessScore = clamp(100 - jitterScore * 100, 0, 100);
  const paceScore = scorePace(pace, repDurationSec, config);
  const holdScore = clamp((holdTimeSec / config.requiredHoldSeconds) * 100, 0, 100);
  const stabilityScore = clamp(100 - shoulderDrift * 3, 0, 100);
  return Math.round(
    extensionScore * 0.25 +
    depthScore * 0.20 +
    smoothnessScore * 0.25 +
    paceScore * 0.15 +
    holdScore * 0.10 +
    stabilityScore * 0.05
  );
}

export function createPushMotionAnalyzer(exercise) {
  const config = normalizeConfig(exercise);

  const state = {
    phase: "WAITING_FOR_TRACKING",
    repCount: 0,
    repStartMs: null,
    holdStartMs: null,
    startBentHoldMs: null,
    holdTimeSec: 0,
    holdCompleted: false,
    minElbowAngle: null,
    maxElbowAngle: null,
    startShoulderAngle: null,
    shoulderDrift: 0,
    baselineDistanceCm: null,
    pushDirection: null,
    maxPushDepthCm: 0,
    lastRepDurationSec: null,
    lastRepCompletedAtMs: 0,
    lastCompletedRep: null,
    completedReps: [],
    sensorSamples: [],
    repJitterEvents: 0,
    repJitterScoreSum: 0,
    repMaxJitterScore: 0,
    repFrameCount: 0,
    repHoldResidualSum: 0,
    repHoldFrames: 0,
    repReversalEvents: 0,
    pendingTransition: null,
    lastOutput: null,
    lastFrameTimestampMs: null
  };

  function resetRep(timestampMs, elbowAngle = null, shoulderAngle = null, distanceCm = null) {
    state.repStartMs = timestampMs;
    state.holdStartMs = null;
    state.startBentHoldMs = null;
    state.holdTimeSec = 0;
    state.holdCompleted = false;
    state.minElbowAngle = elbowAngle;
    state.maxElbowAngle = elbowAngle;
    state.startShoulderAngle = shoulderAngle;
    state.shoulderDrift = 0;
    state.baselineDistanceCm = Number.isFinite(distanceCm) ? distanceCm : null;
    state.pushDirection = null;
    state.maxPushDepthCm = 0;
    state.lastRepDurationSec = null;
    state.sensorSamples = [];
    state.pendingTransition = null;
    state.repJitterEvents = 0;
    state.repJitterScoreSum = 0;
    state.repMaxJitterScore = 0;
    state.repFrameCount = 0;
    state.repHoldResidualSum = 0;
    state.repHoldFrames = 0;
    state.repReversalEvents = 0;
  }

  function acceptTransition(nextPhase, timestampMs) {
    if (state.phase === nextPhase) {
      state.pendingTransition = null;
      return true;
    }
    if (!state.pendingTransition || state.pendingTransition.phase !== nextPhase) {
      state.pendingTransition = { phase: nextPhase, sinceMs: timestampMs };
      return false;
    }
    if (timestampMs - state.pendingTransition.sinceMs < config.transitionDebounceMs) return false;
    state.phase = nextPhase;
    state.pendingTransition = null;
    return true;
  }

  function normalizeFrame(frame = {}) {
    const timestampMs = frame.timestampMs ?? frame.timestamp_ms ?? Date.now();
    const sensorTimestampMs = frame.sensorTimestampMs ?? frame.sensor_timestamp_ms ?? null;
    const distanceCm = frame.distanceCm ?? frame.distance_cm ?? null;
    const calibrationCompressedCm = frame.calibrationCompressedCm ?? frame.calibration_compressed_cm ?? null;
    const calibrationStretchedCm = frame.calibrationStretchedCm ?? frame.calibration_stretched_cm ?? null;
    const sensorValid = Boolean(
      Number.isFinite(distanceCm) &&
      (sensorTimestampMs == null || timestampMs - sensorTimestampMs <= config.sensorStaleMs)
    );
    const calibrationCaptured = Number.isFinite(calibrationCompressedCm) && Number.isFinite(calibrationStretchedCm);
    const calibrationTravelCm = calibrationCaptured ? Math.abs(calibrationStretchedCm - calibrationCompressedCm) : null;
    const calibrated = calibratedPosition(distanceCm, calibrationCompressedCm, calibrationStretchedCm);
    return {
      timestampMs,
      elbowAngle: frame.elbowAngle ?? frame.elbow_angle ?? null,
      shoulderAngle: frame.shoulderAngle ?? frame.shoulder_angle ?? null,
      landmarkConfidence: frame.landmarkConfidence ?? frame.landmark_confidence ?? 0,
      cameraJitterScore: frame.cameraJitterScore ?? frame.jitterScore ?? frame.jitter_score ?? 0,
      sensorJitterScore: frame.sensorJitterScore ?? frame.sensor_jitter_score ?? 0,
      distanceCm,
      sensorTimestampMs,
      sensorValid,
      calibrationCompressedCm,
      calibrationStretchedCm,
      calibrationCaptured,
      calibrationTravelCm,
      calibratedPosition: calibrated,
      calibrationComplete: calibrationCaptured,
      validLandmarks: frame.validLandmarks ?? frame.angle_valid ?? frame.valid_landmarks ?? false,
      jitterEvent: Boolean(frame.jitterGroupedEvent ?? frame.jitter_grouped_event ?? frame.jitterEvent ?? frame.jitter_event),
      trendResidual: frame.trendResidual ?? frame.trend_residual ?? null,
      directionReversals: frame.directionReversals ?? frame.direction_reversals ?? 0
    };
  }

  function repJitterScore({
    groupedEventCount,
    holdResidualAvg,
    reversalEvents,
    maxJitterScore
  }) {
    const eventScore = Math.min(groupedEventCount / 2.5, 1) * 0.5;
    const holdScore = holdResidualAvg > 0 ? clamp(holdResidualAvg / 8, 0, 1) * 0.25 : 0;
    const reversalScore = Math.min(reversalEvents / 2, 1) * 0.25;
    return clamp(
      Math.max(maxJitterScore * 0.12, eventScore + holdScore + reversalScore),
      0,
      1
    );
  }

  function trackRepJitter({
    jitterScore,
    jitterEvent,
    phase,
    trendResidual,
    directionReversals
  }) {
    state.repFrameCount += 1;
    state.repJitterScoreSum += jitterScore ?? 0;
    state.repMaxJitterScore = Math.max(state.repMaxJitterScore, jitterScore ?? 0);
    if (jitterEvent) state.repJitterEvents += 1;
    if ((phase === "EXTENDED_HOLD" || phase === "START_BENT_HOLD") && Number.isFinite(trendResidual)) {
      state.repHoldResidualSum += trendResidual;
      state.repHoldFrames += 1;
    }
    if (directionReversals >= 3) state.repReversalEvents += 1;
  }

  function updateRanges(elbowAngle, shoulderAngle) {
    state.minElbowAngle = state.minElbowAngle == null ? elbowAngle : Math.min(state.minElbowAngle, elbowAngle);
    state.maxElbowAngle = state.maxElbowAngle == null ? elbowAngle : Math.max(state.maxElbowAngle, elbowAngle);
    if (state.startShoulderAngle == null && shoulderAngle != null) state.startShoulderAngle = shoulderAngle;
    if (state.startShoulderAngle != null && shoulderAngle != null) {
      state.shoulderDrift = Math.max(state.shoulderDrift, Math.abs(shoulderAngle - state.startShoulderAngle));
    }
  }

  function updateDistance(frame) {
    if (!frame.sensorValid) return null;
    if (frame.calibrationComplete) {
      state.baselineDistanceCm = frame.calibrationCompressedCm;
      state.pushDirection = Math.sign(frame.calibrationStretchedCm - frame.calibrationCompressedCm) || 1;
    } else if (state.baselineDistanceCm == null) {
      state.baselineDistanceCm = frame.distanceCm;
    }
    const delta = frame.distanceCm - state.baselineDistanceCm;
    if (state.pushDirection == null && Math.abs(delta) >= 2) {
      state.pushDirection = Math.sign(delta) || 1;
    }
    const depth = state.pushDirection == null ? Math.abs(delta) : Math.max(0, state.pushDirection * delta);
    state.maxPushDepthCm = Math.max(state.maxPushDepthCm, depth);
    state.sensorSamples.push({
      timestampMs: frame.sensorTimestampMs || frame.timestampMs,
      distanceCm: frame.distanceCm
    });
    while (state.sensorSamples.length > 80) state.sensorSamples.shift();
    return depth;
  }

  function currentDepth(frame) {
    if (!frame.sensorValid || state.baselineDistanceCm == null) return null;
    const delta = frame.distanceCm - state.baselineDistanceCm;
    if (state.pushDirection == null) return Math.abs(delta);
    return Math.max(0, state.pushDirection * delta);
  }

  function estimateRepJitter() {
    return repJitterScore({
      groupedEventCount: state.repJitterEvents,
      holdResidualAvg: state.repHoldFrames ? state.repHoldResidualSum / state.repHoldFrames : 0,
      reversalEvents: state.repReversalEvents,
      maxJitterScore: state.repMaxJitterScore
    });
  }

  function currentMetrics(frame) {
    const repJitter = estimateRepJitter();
    const rangeOfMotion =
      state.minElbowAngle == null || state.maxElbowAngle == null
        ? 0
        : state.maxElbowAngle - state.minElbowAngle;
    const repDurationSec =
      state.repStartMs == null
        ? state.lastRepDurationSec
        : (frame.timestampMs - state.repStartMs) / 1000;
    const pace = paceForDuration(state.lastRepDurationSec || repDurationSec, config);
    return {
      rangeOfMotion: round(rangeOfMotion, 1) || 0,
      repDurationSec: round(repDurationSec, 1),
      pace,
      pushDepthCm: round(state.maxPushDepthCm, 1),
      physioScore: physioScore({
        rangeOfMotion,
        pushDepthCm: state.maxPushDepthCm,
        jitterScore: repJitter,
        pace,
        holdTimeSec: state.holdTimeSec,
        repDurationSec,
        shoulderDrift: state.shoulderDrift
      }, config)
    };
  }

  function coachFor({ valid, sensorValid, pace, repJustCompleted }) {
    if (!valid) return "low_confidence";
    if (state.repCount >= config.repGoal) return "session_complete";
    if (repJustCompleted) return pace === "too_fast" ? "too_fast" : "rep_complete";
    if (!sensorValid && ["START_BENT_READY", "PUSHING", "EXTENDED_HOLD"].includes(state.phase)) return "almost_there";
    if (state.phase === "EXTENDED_HOLD" && state.holdTimeSec < config.requiredHoldSeconds) return "hold_longer";
    if (estimateRepJitter() > config.jitterWarning) return "too_jittery";
    if (state.shoulderDrift > config.shoulderDriftWarning) return "keep_upper_arm_still";
    if (pace === "too_fast") return "too_fast";
    return "good_form";
  }

  function phaseMessage(phase) {
    return {
      WAITING_FOR_TRACKING: COACH_MESSAGES.start_bent,
      MOVE_TO_BENT: COACH_MESSAGES.move_to_bent,
      START_BENT_HOLD: "Hold bent.",
      START_BENT_READY: COACH_MESSAGES.push_forward,
      PUSHING: COACH_MESSAGES.push_forward,
      EXTENDED_HOLD: COACH_MESSAGES.hold_reach,
      RETURNING: COACH_MESSAGES.return_control,
      REP_COMPLETE: COACH_MESSAGES.rep_complete,
      SESSION_COMPLETE: COACH_MESSAGES.session_complete
    }[phase] || COACH_MESSAGES.good_form;
  }

  function analyze(frame) {
    const normalizedFrame = normalizeFrame(frame);
    const timestampMs = normalizedFrame.timestampMs;
    const elbowAngle = normalizedFrame.elbowAngle;
    const shoulderAngle = normalizedFrame.shoulderAngle;
    const nonIncreasingTimestamp = state.lastFrameTimestampMs != null && timestampMs <= state.lastFrameTimestampMs;
    const longFrameGap = state.lastFrameTimestampMs != null && timestampMs - state.lastFrameTimestampMs > config.staleFrameMs;
    const staleFrame = nonIncreasingTimestamp || longFrameGap;
    const valid = Boolean(
      normalizedFrame.validLandmarks &&
      !staleFrame &&
      elbowAngle != null &&
      shoulderAngle != null &&
      normalizedFrame.landmarkConfidence >= config.minConfidence
    );
    if (!nonIncreasingTimestamp) state.lastFrameTimestampMs = timestampMs;

    if (!valid) {
      state.pendingTransition = null;
      const output = makeOutput(normalizedFrame, {
        valid,
        coachState: "low_confidence",
        coachMessage: COACH_MESSAGES.low_confidence,
        pace: "unknown",
        rangeOfMotion: 0,
        repDurationSec: state.lastRepDurationSec,
        physioScore: null,
        jitterScore: 0
      });
      state.lastOutput = output;
      return output;
    }

    updateRanges(elbowAngle, shoulderAngle);
    const pushDepth = updateDistance(normalizedFrame);
    const sensorLinearity = normalizedFrame.sensorValid
      ? normalizedFrame.calibrationComplete
        ? calibratedJitterScore(
            state.sensorSamples,
            normalizedFrame.calibrationCompressedCm,
            normalizedFrame.calibrationStretchedCm
          )
        : linearityScore(state.sensorSamples)
      : 0;
    const jitterScore = clamp(Math.max(
      normalizedFrame.cameraJitterScore || 0,
      normalizedFrame.sensorJitterScore || 0,
      sensorLinearity
    ), 0, 1);
    trackRepJitter({
      jitterScore,
      jitterEvent: normalizedFrame.jitterEvent,
      phase: state.phase,
      trendResidual: normalizedFrame.trendResidual,
      directionReversals: normalizedFrame.directionReversals
    });

    let repJustCompleted = false;
    let completedRep = null;
    const position = normalizedFrame.calibratedPosition;
    const hasCalibratedDistance = normalizedFrame.calibrationComplete && Number.isFinite(position);
    const nearBent = hasCalibratedDistance && position <= 0.25;
    const leavingBent = hasCalibratedDistance && position >= 0.32;
    const nearStretched = hasCalibratedDistance && position >= 0.78;
    const leavingStretched = hasCalibratedDistance && position <= 0.70;
    const returnedBent = hasCalibratedDistance && position <= 0.28;
    const cameraBent = elbowAngle >= config.startBentMin && elbowAngle <= config.startBentMax;
    const cameraLeavingBent = elbowAngle > config.startBentMax + 8;
    const bentReady = nearBent || cameraBent;

    if (state.phase === "WAITING_FOR_TRACKING") {
      if (bentReady) {
        if (acceptTransition("START_BENT_HOLD", timestampMs)) {
          resetRep(timestampMs, elbowAngle, shoulderAngle, normalizedFrame.distanceCm);
          state.startBentHoldMs = timestampMs;
        }
      } else if (hasCalibratedDistance && acceptTransition("MOVE_TO_BENT", timestampMs)) {
        resetRep(timestampMs, elbowAngle, shoulderAngle, normalizedFrame.distanceCm);
      }
    } else if (state.phase === "MOVE_TO_BENT") {
      if (bentReady) {
        if (acceptTransition("START_BENT_HOLD", timestampMs)) {
          state.startBentHoldMs = timestampMs;
          resetRep(timestampMs, elbowAngle, shoulderAngle, normalizedFrame.distanceCm);
          state.startBentHoldMs = timestampMs;
        }
      }
    } else if (state.phase === "START_BENT_HOLD") {
      if (!bentReady) {
        state.startBentHoldMs = null;
        if (leavingBent || cameraLeavingBent) acceptTransition("PUSHING", timestampMs);
      } else {
        if (state.startBentHoldMs == null) state.startBentHoldMs = timestampMs;
        if ((timestampMs - state.startBentHoldMs) / 1000 >= config.startBentHoldSeconds) {
          acceptTransition("START_BENT_READY", timestampMs);
        }
      }
    } else if (state.phase === "START_BENT_READY") {
      const depth = pushDepth ?? currentDepth(normalizedFrame) ?? 0;
      if (leavingBent || cameraLeavingBent || (!hasCalibratedDistance && depth >= 2)) {
        if (acceptTransition("PUSHING", timestampMs)) {
          state.lastCompletedRep = null;
        }
      }
    } else if (state.phase === "PUSHING") {
      const depth = pushDepth ?? currentDepth(normalizedFrame) ?? 0;
      const extensionReached = elbowAngle >= config.targetExtensionMin;
      const depthReached = normalizedFrame.sensorValid && (nearStretched || depth >= config.minPushDepthCm);
      if (extensionReached || depthReached) {
        if (acceptTransition("EXTENDED_HOLD", timestampMs)) {
          state.holdStartMs = timestampMs;
          state.holdTimeSec = 0;
        }
      }
    } else if (state.phase === "EXTENDED_HOLD") {
      const depth = pushDepth ?? currentDepth(normalizedFrame) ?? state.maxPushDepthCm;
      const holdingExtension = elbowAngle >= config.targetExtensionMin - 8;
      if (holdingExtension || nearStretched) {
        state.holdTimeSec = state.holdStartMs ? (timestampMs - state.holdStartMs) / 1000 : 0;
        if (!state.holdCompleted && state.holdTimeSec >= config.requiredHoldSeconds) {
          state.holdCompleted = true;
        }
      }
      const returningByAngle = elbowAngle < config.targetExtensionMin - 12;
      const returningByDepth = normalizedFrame.sensorValid &&
        (leavingStretched || depth <= Math.max(state.maxPushDepthCm - 2.5, config.returnDepthCm));
      if ((state.holdCompleted && returningByAngle) || (state.holdCompleted && returningByDepth)) {
        acceptTransition("RETURNING", timestampMs);
      }
    } else if (state.phase === "RETURNING") {
      const depth = pushDepth ?? currentDepth(normalizedFrame);
      const returnedByPose = cameraBent;
      const returnedByDepth = !normalizedFrame.sensorValid ||
        depth == null ||
        returnedBent ||
        depth <= Math.max(config.returnDepthCm, state.maxPushDepthCm * 0.28);
      if (returnedByDepth || returnedByPose) {
        if (acceptTransition("REP_COMPLETE", timestampMs)) {
          const durationSec = state.repStartMs ? (timestampMs - state.repStartMs) / 1000 : 0;
          const rangeOfMotion = (state.maxElbowAngle ?? elbowAngle) - (state.minElbowAngle ?? elbowAngle);
          const pace = paceForDuration(durationSec, config);
          const repJitter = repJitterScore({
            groupedEventCount: state.repJitterEvents,
            holdResidualAvg: state.repHoldFrames ? state.repHoldResidualSum / state.repHoldFrames : 0,
            reversalEvents: state.repReversalEvents,
            maxJitterScore: state.repMaxJitterScore
          });
          const score = physioScore({
            rangeOfMotion,
            pushDepthCm: state.maxPushDepthCm,
            jitterScore: repJitter,
            pace,
            holdTimeSec: state.holdTimeSec,
            repDurationSec: durationSec,
            shoulderDrift: state.shoulderDrift
          }, config);
          state.repCount += 1;
          state.lastRepDurationSec = durationSec;
          state.lastRepCompletedAtMs = timestampMs;
          completedRep = {
            rep_index: state.repCount,
            started_at_ms: state.repStartMs,
            ended_at_ms: timestampMs,
            start_elbow_angle: round(state.minElbowAngle, 1),
            return_elbow_angle: round(elbowAngle, 1),
            range_of_motion: round(rangeOfMotion, 1),
            max_extension_angle: round(state.maxElbowAngle, 1),
            push_depth_cm: round(state.maxPushDepthCm, 1),
            sensor_linearity_score: round(sensorLinearity, 2),
            hold_time_sec: round(state.holdTimeSec, 1),
            rep_duration_sec: round(durationSec, 1),
            pace,
            jitter_score: round(repJitter, 2),
            jitter_count: state.repJitterEvents,
            shoulder_drift: round(state.shoulderDrift, 1),
            physio_score: score,
            issue:
              state.maxPushDepthCm < config.minPushDepthCm
                ? "short_push_depth"
                : state.holdTimeSec < config.requiredHoldSeconds
                  ? "did_not_hold_long_enough"
                  : pace === "too_fast"
                    ? "moved_too_fast"
                    : repJitter > config.jitterWarning
                      ? "too_jittery"
                      : state.shoulderDrift > config.shoulderDriftWarning
                        ? "shoulder_compensation"
                        : "none",
            clean:
              state.maxPushDepthCm >= config.minPushDepthCm &&
              state.holdTimeSec >= config.requiredHoldSeconds &&
              pace === "good" &&
              repJitter <= config.jitterWarning &&
              state.shoulderDrift <= config.shoulderDriftWarning
          };
          state.completedReps.push(completedRep);
          state.lastCompletedRep = completedRep;
          repJustCompleted = true;
          state.phase = state.repCount >= config.repGoal ? "SESSION_COMPLETE" : "START_BENT_READY";
          resetRep(timestampMs, elbowAngle, shoulderAngle, normalizedFrame.distanceCm);
        }
      }
    }

    const metrics = currentMetrics(normalizedFrame);
    const coachState = coachFor({
      valid,
      sensorValid: normalizedFrame.sensorValid,
      pace: completedRep?.pace || metrics.pace,
      repJustCompleted
    });
    const coachMessage = !valid || repJustCompleted || coachState === "session_complete"
      ? COACH_MESSAGES[coachState]
      : phaseMessage(state.phase);

    const output = makeOutput(normalizedFrame, {
      valid,
      coachState,
      coachMessage,
      pace: completedRep?.pace || metrics.pace,
      rangeOfMotion: completedRep?.range_of_motion ?? metrics.rangeOfMotion,
      repDurationSec: completedRep?.rep_duration_sec ?? metrics.repDurationSec,
      pushDepthCm: completedRep?.push_depth_cm ?? metrics.pushDepthCm,
      sensorLinearity,
      physioScore: completedRep?.physio_score ?? metrics.physioScore,
      completedRep,
      jitterScore
    });
    state.lastOutput = output;
    return output;
  }

  function makeOutput(frame, details = {}) {
    const timestampMs = frame.timestampMs ?? Date.now();
    const recentCompletedRep = details.completedRep ||
      (state.lastCompletedRep && timestampMs - state.lastRepCompletedAtMs <= 1400
        ? state.lastCompletedRep
        : null);
    const displayPhase = recentCompletedRep ? "REP_COMPLETE" : state.phase;
    const displayRange = recentCompletedRep?.range_of_motion ?? details.rangeOfMotion;
    const displayRepDuration = recentCompletedRep?.rep_duration_sec ?? details.repDurationSec;
    const displayHoldTime = recentCompletedRep?.hold_time_sec ?? state.holdTimeSec;
    const displayPace = recentCompletedRep?.pace ?? details.pace;
    const displayScore = recentCompletedRep?.physio_score ?? details.physioScore;
    const displayCoachState = recentCompletedRep && !details.completedRep
      ? recentCompletedRep.pace === "too_fast" ? "too_fast" : "rep_complete"
      : details.coachState;

    return {
      exercise_id: config.exerciseId,
      exercise_name: config.exerciseName,
      side: config.side,
      phase: displayPhase,
      rep_count: state.repCount,
      rep_goal: config.repGoal,
      elbow_angle: frame.elbowAngle == null ? null : round(frame.elbowAngle, 1),
      shoulder_angle: frame.shoulderAngle == null ? null : round(frame.shoulderAngle, 1),
      target_elbow_min: config.targetExtensionMin,
      target_elbow_max: config.targetExtensionMax,
      range_of_motion: displayRange,
      push_depth_cm: recentCompletedRep?.push_depth_cm ?? details.pushDepthCm ?? round(state.maxPushDepthCm, 1),
      sensor_linearity_score: round(details.sensorLinearity ?? 0, 2),
      hold_time_sec: round(displayHoldTime, 1) || 0,
      rep_duration_sec: displayRepDuration,
      pace: displayPace,
      jitter_score: round(details.jitterScore ?? 0, 2),
      shoulder_drift: round(state.shoulderDrift, 1) || 0,
      sensor_valid: frame.sensorValid,
      calibration_complete: frame.calibrationComplete,
      calibration_travel_cm: round(frame.calibrationTravelCm, 2),
      calibration_quality: frame.calibrationComplete && frame.calibrationTravelCm < 1 ? "low_travel" : frame.calibrationComplete ? "ok" : "missing",
      calibration_compressed_cm: round(frame.calibrationCompressedCm, 1),
      calibration_stretched_cm: round(frame.calibrationStretchedCm, 1),
      calibrated_position: round(frame.calibratedPosition, 3),
      baseline_distance_cm: round(state.baselineDistanceCm, 1),
      current_distance_cm: round(frame.distanceCm, 1),
      coach_state: displayCoachState,
      physio_score: displayScore,
      local_coach_message: recentCompletedRep && !details.completedRep
        ? COACH_MESSAGES.rep_complete
        : details.coachMessage || COACH_MESSAGES[displayCoachState],
      current_rep: {
        min_elbow_angle: round(state.minElbowAngle, 1),
        max_elbow_angle: round(state.maxElbowAngle, 1),
        max_push_depth_cm: round(state.maxPushDepthCm, 1),
        started_at_ms: state.repStartMs
      },
      completed_rep: recentCompletedRep,
      completed_reps: state.completedReps.slice()
    };
  }

  function preview(frame = {}) {
    const normalizedFrame = normalizeFrame(frame);
    const output = {
      exercise_id: config.exerciseId,
      exercise_name: config.exerciseName,
      side: config.side,
      phase: "WAITING_FOR_TRACKING",
      rep_count: 0,
      rep_goal: config.repGoal,
      elbow_angle: normalizedFrame.elbowAngle == null ? null : round(normalizedFrame.elbowAngle, 1),
      shoulder_angle: normalizedFrame.shoulderAngle == null ? null : round(normalizedFrame.shoulderAngle, 1),
      target_elbow_min: config.targetExtensionMin,
      target_elbow_max: config.targetExtensionMax,
      range_of_motion: 0,
      push_depth_cm: 0,
      sensor_linearity_score: 0,
      hold_time_sec: 0,
      rep_duration_sec: null,
      pace: "unknown",
      jitter_score: 0,
      shoulder_drift: 0,
      sensor_valid: normalizedFrame.sensorValid,
      coach_state: normalizedFrame.validLandmarks ? "good_form" : "low_confidence",
      physio_score: null,
      local_coach_message: normalizedFrame.validLandmarks
        ? COACH_MESSAGES.start_bent
        : COACH_MESSAGES.low_confidence,
      current_rep: null,
      completed_rep: null,
      completed_reps: state.completedReps.slice()
    };
    state.lastOutput = output;
    return output;
  }

  function reset() {
    state.phase = "WAITING_FOR_TRACKING";
    state.repCount = 0;
    state.completedReps = [];
    state.lastCompletedRep = null;
    state.lastFrameTimestampMs = null;
    resetRep(null);
    state.lastOutput = null;
  }

  function extendRepGoal(n) {
    config.repGoal += n;
    if (state.phase === "SESSION_COMPLETE") {
      state.phase = "START_BENT_READY";
      resetRep(Date.now());
    }
  }

  return {
    analyze,
    preview,
    reset,
    extendRepGoal,
    getState: () => ({ ...state, completedReps: state.completedReps.slice() })
  };
}
