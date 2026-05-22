const COACH_MESSAGES = {
  good_form: "Good control. Keep the same pace.",
  bend_more: "Bend your elbow a little more.",
  straighten_more: "Straighten your arm fully.",
  too_fast: "Slow down and control the movement.",
  too_slow: "Keep moving smoothly.",
  too_jittery: "Keep the motion steady.",
  hold_longer: "Hold the bend briefly.",
  keep_upper_arm_still: "Keep your upper arm still.",
  low_confidence: "Move your full arm into view.",
  rep_complete: "Good rep.",
  session_complete: "Session complete."
};

const DEFAULT_CONFIG = {
  exerciseId: "elbow_flexion_extension",
  exerciseName: "Elbow Flexion / Extension",
  side: "right",
  repGoal: 8,
  startElbowMin: 145,
  startElbowMax: 180,
  flexedElbowMin: 55,
  flexedElbowMax: 100,
  requiredHoldSeconds: 1.0,
  minRepSeconds: 2.0,
  maxRepSeconds: 6.0,
  minConfidence: 0.6,
  jitterWarning: 0.35,
  shoulderDriftWarning: 28,
  transitionDebounceMs: 180,
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
  if (pace === "too_fast") {
    return clamp((durationSec / config.minRepSeconds) * 100, 0, 100);
  }
  const overage = durationSec - config.maxRepSeconds;
  return clamp(100 - overage * 18, 0, 100);
}

function physioScore({ rangeOfMotion, jitterScore, pace, holdTimeSec, repDurationSec, shoulderDrift }, config) {
  const rangeScore = clamp((rangeOfMotion / 90) * 100, 0, 100);
  const smoothnessScore = clamp(100 - jitterScore * 100, 0, 100);
  const paceScore = scorePace(pace, repDurationSec, config);
  const holdScore = clamp((holdTimeSec / config.requiredHoldSeconds) * 100, 0, 100);
  const stabilityScore = clamp(100 - shoulderDrift * 3, 0, 100);
  return Math.round(
    rangeScore * 0.35 +
    smoothnessScore * 0.20 +
    paceScore * 0.20 +
    holdScore * 0.15 +
    stabilityScore * 0.10
  );
}

function normalizeConfig(exercise = {}) {
  return {
    ...DEFAULT_CONFIG,
    exerciseId: exercise.id || DEFAULT_CONFIG.exerciseId,
    exerciseName: exercise.name || DEFAULT_CONFIG.exerciseName,
    side: exercise.side || DEFAULT_CONFIG.side,
    repGoal: exercise.repGoal || DEFAULT_CONFIG.repGoal,
    startElbowMin: exercise.startPosition?.elbowAngleMin ?? DEFAULT_CONFIG.startElbowMin,
    startElbowMax: exercise.startPosition?.elbowAngleMax ?? DEFAULT_CONFIG.startElbowMax,
    flexedElbowMin: exercise.targetPosition?.elbowAngleMin ?? DEFAULT_CONFIG.flexedElbowMin,
    flexedElbowMax: exercise.targetPosition?.elbowAngleMax ?? DEFAULT_CONFIG.flexedElbowMax,
    requiredHoldSeconds: exercise.holdSeconds ?? DEFAULT_CONFIG.requiredHoldSeconds,
    minRepSeconds: exercise.minRepSeconds ?? DEFAULT_CONFIG.minRepSeconds,
    maxRepSeconds: exercise.maxRepSeconds ?? DEFAULT_CONFIG.maxRepSeconds,
    jitterWarning: exercise.jitterThreshold ?? DEFAULT_CONFIG.jitterWarning,
    shoulderDriftWarning: exercise.shoulderDriftThreshold ?? DEFAULT_CONFIG.shoulderDriftWarning
  };
}

export function createElbowFlexionAnalyzer(exercise) {
  const config = normalizeConfig(exercise);

  const state = {
    phase: "WAITING_FOR_START",
    repCount: 0,
    repStartMs: null,
    holdStartMs: null,
    holdTimeSec: 0,
    minElbowAngle: null,
    maxElbowAngle: null,
    startShoulderAngle: null,
    shoulderDrift: 0,
    lastRepDurationSec: null,
    lastRepCompletedAtMs: 0,
    lastCompletedRep: null,
    completedReps: [],
    angleSamples: [],
    pendingTransition: null,
    lastOutput: null,
    lastFrameTimestampMs: null
  };

  function resetRep(timestampMs) {
    state.repStartMs = timestampMs;
    state.holdStartMs = null;
    state.holdTimeSec = 0;
    state.minElbowAngle = null;
    state.maxElbowAngle = null;
    state.startShoulderAngle = null;
    state.shoulderDrift = 0;
    state.lastRepDurationSec = null;
    state.pendingTransition = null;
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
    if (timestampMs - state.pendingTransition.sinceMs < config.transitionDebounceMs) {
      return false;
    }
    state.phase = nextPhase;
    state.pendingTransition = null;
    return true;
  }

  function updateRepRange(elbowAngle, shoulderAngle) {
    state.minElbowAngle = state.minElbowAngle == null ? elbowAngle : Math.min(state.minElbowAngle, elbowAngle);
    state.maxElbowAngle = state.maxElbowAngle == null ? elbowAngle : Math.max(state.maxElbowAngle, elbowAngle);
    if (state.startShoulderAngle == null && shoulderAngle != null) {
      state.startShoulderAngle = shoulderAngle;
    }
    if (state.startShoulderAngle != null && shoulderAngle != null) {
      state.shoulderDrift = Math.max(state.shoulderDrift, Math.abs(shoulderAngle - state.startShoulderAngle));
    }
  }

  function straightEnoughAngle() {
    return Math.max(125, config.startElbowMin - 10);
  }

  function normalizeFrame(frame = {}) {
    const timestampMs = frame.timestampMs ?? frame.timestamp_ms ?? Date.now();
    const elbowAngle = frame.elbowAngle ?? frame.elbow_angle ?? null;
    const shoulderAngle = frame.shoulderAngle ?? frame.shoulder_angle ?? null;
    const landmarkConfidence = frame.landmarkConfidence ?? frame.landmark_confidence ?? 0;
    const validLandmarks = frame.validLandmarks ?? frame.angle_valid ?? frame.valid_landmarks ?? false;
    return {
      timestampMs,
      elbowAngle,
      shoulderAngle,
      landmarkConfidence,
      jitterScore: frame.jitterScore ?? frame.jitter_score ?? null,
      validLandmarks
    };
  }

  function fallbackJitter(timestampMs, elbowAngle) {
    if (elbowAngle == null) {
      state.angleSamples = [];
      return 0;
    }
    state.angleSamples.push({ timestampMs, elbowAngle });
    while (state.angleSamples.length > 10) state.angleSamples.shift();
    if (state.angleSamples.length < 4) return 0;

    const velocities = [];
    for (let i = 1; i < state.angleSamples.length; i += 1) {
      const previous = state.angleSamples[i - 1];
      const current = state.angleSamples[i];
      const dt = Math.max((current.timestampMs - previous.timestampMs) / 1000, 0.001);
      velocities.push((current.elbowAngle - previous.elbowAngle) / dt);
    }
    const changes = [];
    for (let i = 1; i < velocities.length; i += 1) {
      changes.push(Math.abs(velocities[i] - velocities[i - 1]));
    }
    const averageChange = changes.reduce((sum, value) => sum + value, 0) / Math.max(changes.length, 1);
    return clamp(averageChange / 240, 0, 1);
  }

  function classifyCoach({ valid, elbowAngle, jitterScore, pace, repJustCompleted }) {
    if (!valid) return "low_confidence";
    if (state.repCount >= config.repGoal) return "session_complete";
    if (repJustCompleted) return pace === "too_fast" ? "too_fast" : "rep_complete";
    if (state.phase === "FLEXED_HOLD" && state.holdTimeSec < config.requiredHoldSeconds) return "hold_longer";
    if (jitterScore > config.jitterWarning) return "too_jittery";
    if (state.shoulderDrift > config.shoulderDriftWarning) return "keep_upper_arm_still";
    if (state.phase === "WAITING_FOR_START" && elbowAngle < config.startElbowMin) return "straighten_more";
    if (state.phase === "FLEXING" && elbowAngle > config.flexedElbowMax) return "bend_more";
    if (state.phase === "EXTENDING" && elbowAngle < config.startElbowMin) return "straighten_more";
    return "good_form";
  }

  function currentMetrics(jitterScore, timestampMs) {
    const rangeOfMotion =
      state.minElbowAngle == null || state.maxElbowAngle == null
        ? 0
        : state.maxElbowAngle - state.minElbowAngle;
    const repDurationSec =
      state.repStartMs == null
        ? state.lastRepDurationSec
        : (timestampMs - state.repStartMs) / 1000;
    const pace = paceForDuration(state.lastRepDurationSec || repDurationSec, config);
    return {
      rangeOfMotion: round(rangeOfMotion, 1) || 0,
      repDurationSec: round(repDurationSec, 1),
      pace,
      physioScore: physioScore({
        rangeOfMotion,
        jitterScore,
        pace,
        holdTimeSec: state.holdTimeSec,
        repDurationSec,
        shoulderDrift: state.shoulderDrift
      }, config)
    };
  }

  function analyze(frame) {
    const normalizedFrame = normalizeFrame(frame);
    const timestampMs = normalizedFrame.timestampMs;
    const elbowAngle = normalizedFrame.elbowAngle;
    const shoulderAngle = normalizedFrame.shoulderAngle;
    const jitterScore = normalizedFrame.jitterScore ?? fallbackJitter(timestampMs, elbowAngle);
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

    let repJustCompleted = false;
    let completedRep = null;

    if (!valid) {
      state.pendingTransition = null;
      const output = makeOutput(normalizedFrame, {
        valid,
        coachState: "low_confidence",
        pace: "unknown",
        rangeOfMotion: 0,
        repDurationSec: state.lastRepDurationSec,
        physioScore: null
      });
      state.lastOutput = output;
      return output;
    }

    updateRepRange(elbowAngle, shoulderAngle);

    const straightEnough = straightEnoughAngle();

    if (state.phase === "WAITING_FOR_START" && elbowAngle >= straightEnough) {
      if (acceptTransition("EXTENDED_READY", timestampMs)) {
        resetRep(timestampMs);
        updateRepRange(elbowAngle, shoulderAngle);
      }
    } else if (state.phase === "EXTENDED_READY" && elbowAngle < straightEnough) {
      if (acceptTransition("FLEXING", timestampMs)) {
        state.lastCompletedRep = null;
      }
    } else if (state.phase === "FLEXING" && elbowAngle <= config.flexedElbowMax) {
      if (acceptTransition("FLEXED_HOLD", timestampMs)) {
        state.holdStartMs = timestampMs;
        state.holdTimeSec = 0;
      }
    } else if (state.phase === "FLEXED_HOLD") {
      if (elbowAngle >= config.flexedElbowMin && elbowAngle <= config.flexedElbowMax) {
        state.holdTimeSec = state.holdStartMs ? (timestampMs - state.holdStartMs) / 1000 : 0;
      } else if (state.holdTimeSec >= config.requiredHoldSeconds && elbowAngle > config.flexedElbowMax) {
        acceptTransition("EXTENDING", timestampMs);
      } else if (elbowAngle > config.flexedElbowMax) {
        state.holdStartMs = null;
        state.holdTimeSec = 0;
        acceptTransition("FLEXING", timestampMs);
      }
    } else if (state.phase === "EXTENDING" && elbowAngle >= straightEnough) {
      if (acceptTransition("REP_COMPLETE", timestampMs)) {
        const durationSec = state.repStartMs ? (timestampMs - state.repStartMs) / 1000 : 0;
        const rangeOfMotion = (state.maxElbowAngle ?? elbowAngle) - (state.minElbowAngle ?? elbowAngle);
        const pace = paceForDuration(durationSec, config);
        const score = physioScore({
          rangeOfMotion,
          jitterScore,
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
          range_of_motion: round(rangeOfMotion, 1),
          hold_time_sec: round(state.holdTimeSec, 1),
          rep_duration_sec: round(durationSec, 1),
          pace,
          jitter_score: round(jitterScore, 2),
          shoulder_drift: round(state.shoulderDrift, 1),
          physio_score: score,
          issue:
            state.holdTimeSec < config.requiredHoldSeconds
              ? "did_not_hold_long_enough"
              : pace === "too_fast"
                ? "moved_too_fast"
                : jitterScore > config.jitterWarning
                  ? "too_jittery"
                  : state.shoulderDrift > config.shoulderDriftWarning
                    ? "shoulder_compensation"
                    : "none",
          clean:
            state.holdTimeSec >= config.requiredHoldSeconds &&
            pace === "good" &&
            jitterScore <= config.jitterWarning &&
            state.shoulderDrift <= config.shoulderDriftWarning
        };
        state.completedReps.push(completedRep);
        state.lastCompletedRep = completedRep;
        repJustCompleted = true;
        state.phase = state.repCount >= config.repGoal ? "SESSION_COMPLETE" : "EXTENDED_READY";
        resetRep(timestampMs);
        updateRepRange(elbowAngle, shoulderAngle);
      }
    }

    const metrics = currentMetrics(jitterScore, timestampMs);
    const coachState = classifyCoach({
      valid,
      elbowAngle,
      jitterScore,
      pace: completedRep?.pace || metrics.pace,
      repJustCompleted
    });

    const output = makeOutput(normalizedFrame, {
      valid,
      coachState,
      pace: completedRep?.pace || metrics.pace,
      rangeOfMotion: completedRep?.range_of_motion ?? metrics.rangeOfMotion,
      repDurationSec: completedRep?.rep_duration_sec ?? metrics.repDurationSec,
      physioScore: completedRep?.physio_score ?? metrics.physioScore,
      completedRep
    });
    state.lastOutput = output;
    return output;
  }

  function makeOutput(frame, details) {
    const timestampMs = frame.timestampMs ?? Date.now();
    const recentCompletedRep = details.completedRep ||
      (state.lastCompletedRep && timestampMs - state.lastRepCompletedAtMs <= 1400
        ? state.lastCompletedRep
        : null);
    const displayCompletedRep = state.phase === "SESSION_COMPLETE" ? null : recentCompletedRep;
    const displayPhase = displayCompletedRep ? "REP_COMPLETE" : state.phase;
    const displayRange = displayCompletedRep?.range_of_motion ?? details.rangeOfMotion;
    const displayRepDuration = displayCompletedRep?.rep_duration_sec ?? details.repDurationSec;
    const displayHoldTime = displayCompletedRep?.hold_time_sec ?? state.holdTimeSec;
    const displayPace = displayCompletedRep?.pace ?? details.pace;
    const displayScore = displayCompletedRep?.physio_score ?? details.physioScore;
    const displayCoachState = displayCompletedRep && !details.completedRep
      ? displayCompletedRep.pace === "too_fast" ? "too_fast" : "rep_complete"
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
      target_elbow_min: config.flexedElbowMin,
      target_elbow_max: config.flexedElbowMax,
      range_of_motion: displayRange,
      hold_time_sec: round(displayHoldTime, 1) || 0,
      rep_duration_sec: displayRepDuration,
      pace: displayPace,
      jitter_score: round(frame.jitterScore ?? 0, 2),
      shoulder_drift: round(state.shoulderDrift, 1) || 0,
      coach_state: displayCoachState,
      physio_score: displayScore,
      local_coach_message: COACH_MESSAGES[displayCoachState],
      current_rep: {
        min_elbow_angle: round(state.minElbowAngle, 1),
        max_elbow_angle: round(state.maxElbowAngle, 1),
        started_at_ms: state.repStartMs
      },
      completed_rep: displayCompletedRep,
      completed_reps: state.completedReps.slice()
    };
  }

  function preview(frame = {}) {
    const normalizedFrame = normalizeFrame(frame);
    const output = {
      exercise_id: config.exerciseId,
      exercise_name: config.exerciseName,
      side: config.side,
      phase: "WAITING_FOR_START",
      rep_count: 0,
      rep_goal: config.repGoal,
      elbow_angle: normalizedFrame.elbowAngle == null ? null : round(normalizedFrame.elbowAngle, 1),
      shoulder_angle: normalizedFrame.shoulderAngle == null ? null : round(normalizedFrame.shoulderAngle, 1),
      target_elbow_min: config.flexedElbowMin,
      target_elbow_max: config.flexedElbowMax,
      range_of_motion: 0,
      hold_time_sec: 0,
      rep_duration_sec: null,
      pace: "unknown",
      jitter_score: round(normalizedFrame.jitterScore ?? 0, 2),
      shoulder_drift: 0,
      coach_state: normalizedFrame.validLandmarks ? "good_form" : "low_confidence",
      physio_score: null,
      local_coach_message: normalizedFrame.validLandmarks
        ? "Start with your arm mostly straight."
        : COACH_MESSAGES.low_confidence,
      current_rep: null,
      completed_rep: null,
      completed_reps: state.completedReps.slice()
    };
    state.lastOutput = output;
    return output;
  }

  function reset() {
    state.phase = "WAITING_FOR_START";
    state.repCount = 0;
    state.completedReps = [];
    state.lastCompletedRep = null;
    state.angleSamples = [];
    state.lastFrameTimestampMs = null;
    resetRep(null);
    state.lastOutput = null;
  }

  return {
    analyze,
    preview,
    reset,
    getState: () => ({ ...state, completedReps: state.completedReps.slice() })
  };
}
