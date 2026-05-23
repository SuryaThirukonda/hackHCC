function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const MOVING_PHASES = new Set([
  "FLEXING",
  "EXTENDING",
  "PUSHING",
  "RETURNING"
]);

const HOLD_PHASES = new Set([
  "FLEXED_HOLD",
  "EXTENDED_HOLD",
  "START_BENT_HOLD",
  "HOLD_COMPLETE"
]);

const TRANSITION_PHASES = new Set([
  "WAITING_FOR_START",
  "STRAIGHTEN_TO_START",
  "EXTENDED_READY",
  "REP_COMPLETE",
  "SESSION_COMPLETE",
  "WAITING_FOR_TRACKING",
  "MOVE_TO_BENT",
  "START_BENT_READY",
  "CALIBRATION_PENDING",
  "CALIBRATION_READY"
]);

function phaseCategory(phase) {
  if (!phase) return "unknown";
  if (HOLD_PHASES.has(phase)) return "hold";
  if (MOVING_PHASES.has(phase)) return "moving";
  if (TRANSITION_PHASES.has(phase)) return "transition";
  return "unknown";
}

function predictTrendAngle(samples, timestampMs) {
  if (!samples.length) return null;
  if (samples.length < 3) return samples.at(-1).angle;
  const originMs = samples[0].timestampMs;
  let sumT = 0;
  let sumA = 0;
  let sumTA = 0;
  let sumTT = 0;
  for (const sample of samples) {
    const t = (sample.timestampMs - originMs) / 1000;
    sumT += t;
    sumA += sample.angle;
    sumTA += t * sample.angle;
    sumTT += t * t;
  }
  const n = samples.length;
  const denom = n * sumTT - sumT * sumT;
  if (Math.abs(denom) < 1e-6) return samples.at(-1).angle;
  const slope = (n * sumTA - sumT * sumA) / denom;
  const intercept = (sumA - slope * sumT) / n;
  const tNow = (timestampMs - originMs) / 1000;
  return intercept + slope * tNow;
}

function countDirectionReversals(signedSteps, minMagnitude = 0.4) {
  const significant = signedSteps.filter((step) => Math.abs(step) >= minMagnitude);
  let reversals = 0;
  for (let i = 1; i < significant.length; i += 1) {
    if (Math.sign(significant[i]) !== Math.sign(significant[i - 1])) {
      reversals += 1;
    }
  }
  return reversals;
}

function isNearSmoothExtremum(samples, angle, toleranceDeg = 7) {
  if (samples.length < 4 || !Number.isFinite(angle)) return false;
  const angles = samples.map((sample) => sample.angle);
  const min = Math.min(...angles);
  const max = Math.max(...angles);
  const range = max - min;
  if (range < 12) return false;
  return Math.abs(angle - min) <= toleranceDeg || Math.abs(angle - max) <= toleranceDeg;
}

export function createRefinedJitterDetector(config = {}) {
  const settings = {
    trendWindowSize: 8,
    signedDeltaWindow: 7,
    movingTrendResidualDeg: 12,
    holdTrendResidualDeg: 6,
    smoothedResidualAssistDeg: 14,
    minReversalsMoving: 2,
    phaseTransitionGraceMs: 300,
    minEventSpacingMs: 320,
    edgeTrimMs: 1500,
    edgeTrimFrames: 12,
    jitterMinConfidence: 0.55,
    scoreWindowSize: 40,
    ...config
  };

  const state = {
    trendSamples: [],
    signedSteps: [],
    sessionStartMs: null,
    validFrameCount: 0,
    lastPhase: null,
    lastPhaseChangeMs: null,
    lastGroupedEventMs: -Infinity,
    recentGroupedEvents: [],
    holdResidualSum: 0,
    holdFrameCount: 0
  };

  function reset() {
    state.trendSamples = [];
    state.signedSteps = [];
    state.sessionStartMs = null;
    state.validFrameCount = 0;
    state.lastPhase = null;
    state.lastPhaseChangeMs = null;
    state.lastGroupedEventMs = -Infinity;
    state.recentGroupedEvents = [];
    state.holdResidualSum = 0;
    state.holdFrameCount = 0;
  }

  function update({
    timestampMs,
    rawAngle,
    smoothedAngle,
    landmarkConfidence = 1,
    analyzerPhase = null,
    rawValid = true
  } = {}) {
    const empty = {
      jitterEvent: false,
      jitterGroupedEvent: false,
      jitterSuspicious: false,
      jitterReason: null,
      trackingNoise: false,
      predictedTrendAngle: null,
      trendResidual: null,
      rawSmoothedResidual: null,
      directionReversals: 0,
      cameraJitterScore: 0,
      debug: null
    };

    if (!rawValid || !Number.isFinite(rawAngle)) return empty;

    if (state.sessionStartMs == null) state.sessionStartMs = timestampMs;
    state.validFrameCount += 1;

    const phase = analyzerPhase || state.lastPhase || "unknown";
    if (phase !== state.lastPhase) {
      state.lastPhase = phase;
      state.lastPhaseChangeMs = timestampMs;
    }

    const category = phaseCategory(phase);
    const inStartEdge =
      timestampMs - state.sessionStartMs < settings.edgeTrimMs ||
      state.validFrameCount <= settings.edgeTrimFrames;
    const inPhaseGrace =
      state.lastPhaseChangeMs != null &&
      timestampMs - state.lastPhaseChangeMs < settings.phaseTransitionGraceMs;

    state.trendSamples.push({ timestampMs, angle: rawAngle });
    while (state.trendSamples.length > settings.trendWindowSize) state.trendSamples.shift();

    const previousAngle = state.trendSamples.length >= 2
      ? state.trendSamples[state.trendSamples.length - 2].angle
      : rawAngle;
    const signedStep = rawAngle - previousAngle;
    state.signedSteps.push(signedStep);
    while (state.signedSteps.length > settings.signedDeltaWindow) state.signedSteps.shift();

    const predictedTrendAngle = predictTrendAngle(state.trendSamples, timestampMs);
    const trendResidual = Number.isFinite(predictedTrendAngle)
      ? Math.abs(rawAngle - predictedTrendAngle)
      : 0;
    const rawSmoothedResidual = Number.isFinite(smoothedAngle)
      ? Math.abs(rawAngle - smoothedAngle)
      : trendResidual;
    const directionReversals = countDirectionReversals(state.signedSteps);
    const nearExtremum = isNearSmoothExtremum(state.trendSamples, rawAngle);

    if (landmarkConfidence < settings.jitterMinConfidence) {
      return {
        ...empty,
        trackingNoise: true,
        predictedTrendAngle: round(predictedTrendAngle, 1),
        trendResidual: round(trendResidual, 1),
        rawSmoothedResidual: round(rawSmoothedResidual, 1),
        directionReversals,
        debug: {
          timestampMs,
          phase,
          rawAngle: round(rawAngle, 1),
          smoothedAngle: round(smoothedAngle, 1),
          predictedTrendAngle: round(predictedTrendAngle, 1),
          residual: round(trendResidual, 1),
          reason: "tracking_noise"
        }
      };
    }

    if (inStartEdge || inPhaseGrace || category === "transition") {
      return {
        ...empty,
        predictedTrendAngle: round(predictedTrendAngle, 1),
        trendResidual: round(trendResidual, 1),
        rawSmoothedResidual: round(rawSmoothedResidual, 1),
        directionReversals,
        debug: {
          timestampMs,
          phase,
          rawAngle: round(rawAngle, 1),
          smoothedAngle: round(smoothedAngle, 1),
          predictedTrendAngle: round(predictedTrendAngle, 1),
          residual: round(trendResidual, 1),
          reason: inStartEdge ? "session_edge" : inPhaseGrace ? "phase_transition" : "transition_phase"
        }
      };
    }

    let suspicious = false;
    let reason = null;

    if (category === "hold") {
      state.holdFrameCount += 1;
      state.holdResidualSum += trendResidual;
      if (trendResidual >= settings.holdTrendResidualDeg) {
        suspicious = true;
        reason = "hold_instability";
      }
    } else if (category === "moving") {
      const trendDeviation = trendResidual >= settings.movingTrendResidualDeg;
      const assistedDeviation =
        trendResidual >= settings.movingTrendResidualDeg - 2 &&
        rawSmoothedResidual >= settings.smoothedResidualAssistDeg &&
        directionReversals >= settings.minReversalsMoving;
      const reversalShake =
        directionReversals >= settings.minReversalsMoving + 1 &&
        trendResidual >= settings.holdTrendResidualDeg + 1;

      if (nearExtremum && directionReversals < settings.minReversalsMoving) {
        suspicious = false;
      } else if (reversalShake) {
        suspicious = true;
        reason = "repeated_reversal";
      } else if (trendDeviation && directionReversals >= settings.minReversalsMoving) {
        suspicious = true;
        reason = "trend_deviation";
      } else if (assistedDeviation) {
        suspicious = true;
        reason = "trend_deviation";
      }
    }

    const groupedEvent = suspicious &&
      timestampMs - state.lastGroupedEventMs >= settings.minEventSpacingMs;
    if (groupedEvent) {
      state.lastGroupedEventMs = timestampMs;
      state.recentGroupedEvents.push(timestampMs);
      while (state.recentGroupedEvents.length > settings.scoreWindowSize) {
        state.recentGroupedEvents.shift();
      }
    }

    const holdInstability = state.holdFrameCount > 0
      ? clamp(state.holdResidualSum / state.holdFrameCount / settings.holdTrendResidualDeg, 0, 1)
      : 0;
    const groupedRate = clamp(state.recentGroupedEvents.length / 6, 0, 1);
    const reversalRate = clamp(directionReversals / (settings.minReversalsMoving + 2), 0, 1);
    const cameraJitterScore = clamp(
      groupedRate * 0.55 +
      holdInstability * 0.25 +
      (suspicious ? reversalRate * 0.2 : 0),
      0,
      1
    );

    return {
      jitterEvent: groupedEvent,
      jitterGroupedEvent: groupedEvent,
      jitterSuspicious: suspicious,
      jitterReason: groupedEvent ? reason : suspicious ? reason : null,
      trackingNoise: false,
      predictedTrendAngle: round(predictedTrendAngle, 1),
      trendResidual: round(trendResidual, 1),
      rawSmoothedResidual: round(rawSmoothedResidual, 1),
      directionReversals,
      cameraJitterScore: round(cameraJitterScore, 3),
      debug: groupedEvent || suspicious
        ? {
          timestampMs,
          phase,
          rawAngle: round(rawAngle, 1),
          smoothedAngle: round(smoothedAngle, 1),
          predictedTrendAngle: round(predictedTrendAngle, 1),
          residual: round(trendResidual, 1),
          reason: groupedEvent ? reason : reason
        }
        : null
    };
  }

  return { update, reset, settings };
}
