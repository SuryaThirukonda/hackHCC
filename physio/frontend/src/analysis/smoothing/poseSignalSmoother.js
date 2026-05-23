import { ELBOW_FLEXION_SMOOTHING_CONFIG } from "./smoothingConfig.js";
import { createRefinedJitterDetector } from "./refinedJitterDetector.js";

export function isInSessionEdgeTimestamp(timestampMs, sessionStartMs, sessionEndMs, config = ELBOW_FLEXION_SMOOTHING_CONFIG) {
  if (!Number.isFinite(timestampMs) || !Number.isFinite(sessionStartMs)) return false;
  if (timestampMs - sessionStartMs < config.edgeTrimMs) return true;
  if (Number.isFinite(sessionEndMs) && sessionEndMs - timestampMs < config.edgeTrimMs) return true;
  return false;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function finitePoint(point) {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function validityReason(frame, config) {
  const elbowAngle = finiteNumber(frame.elbowAngle);
  const shoulderAngle = finiteNumber(frame.shoulderAngle);
  if (elbowAngle == null) return "missing_elbow_angle";
  if (shoulderAngle == null) return "missing_shoulder_angle";
  if (!finitePoint(frame.shoulder) || !finitePoint(frame.elbow) || !finitePoint(frame.wrist)) {
    return "missing_shoulder_elbow_or_wrist";
  }
  if ((frame.landmarkConfidence ?? 0) < config.minLandmarkConfidence) return "low_landmark_confidence";
  if (elbowAngle < config.elbowAngleMin || elbowAngle > config.elbowAngleMax) return "implausible_elbow_angle";
  return "none";
}

export function createPoseSignalSmoother(configOverrides = {}) {
  const config = { ...ELBOW_FLEXION_SMOOTHING_CONFIG, ...configOverrides };
  const jitterDetector = createRefinedJitterDetector(config);
  const state = {
    validRawAngles: [],
    validRawShoulders: [],
    smoothedAngles: [],
    velocityResiduals: [],
    velocities: [],
    previousRawAngle: null,
    previousRawTimestampMs: null,
    previousSmoothedAngle: null,
    previousSmoothedTimestampMs: null,
    emaElbow: null,
    emaShoulder: null,
    lastValidAt: null,
    straightFrames: 0,
    flexedFrames: 0,
    trackingFrames: 0,
    wasStraight: false,
    wasFlexed: false,
    lastJitter: null
  };

  function reset() {
    state.validRawAngles = [];
    state.validRawShoulders = [];
    state.smoothedAngles = [];
    state.velocityResiduals = [];
    state.velocities = [];
    state.previousRawAngle = null;
    state.previousRawTimestampMs = null;
    state.previousSmoothedAngle = null;
    state.previousSmoothedTimestampMs = null;
    state.emaElbow = null;
    state.emaShoulder = null;
    state.lastValidAt = null;
    state.straightFrames = 0;
    state.flexedFrames = 0;
    state.trackingFrames = 0;
    state.wasStraight = false;
    state.wasFlexed = false;
    state.lastJitter = null;
    jitterDetector.reset();
  }

  function update(frame = {}) {
    const timestampMs = Math.round(frame.timestampMs ?? frame.timestamp_ms ?? Date.now());
    const rawElbow = finiteNumber(frame.elbowAngle ?? frame.elbow_angle);
    const rawShoulder = finiteNumber(frame.shoulderAngle ?? frame.shoulder_angle);
    const landmarkConfidence = clamp(frame.landmarkConfidence ?? frame.landmark_confidence ?? 0, 0, 1);
    const analyzerPhase = frame.analyzerPhase ?? frame.analyzer_phase ?? null;
    const reason = validityReason({
      ...frame,
      elbowAngle: rawElbow,
      shoulderAngle: rawShoulder,
      landmarkConfidence
    }, config);
    const rawValid = reason === "none";
    const withinGrace = !rawValid &&
      state.lastValidAt != null &&
      timestampMs - state.lastValidAt <= config.invalidGraceMs &&
      state.emaElbow != null &&
      state.emaShoulder != null;
    const analyzerValid = rawValid || withinGrace;
    let jitterResult = state.lastJitter || {
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

    if (rawValid) {
      state.lastValidAt = timestampMs;
      state.validRawAngles.push(rawElbow);
      state.validRawShoulders.push(rawShoulder);
      while (state.validRawAngles.length > config.medianWindowSize) state.validRawAngles.shift();
      while (state.validRawShoulders.length > config.medianWindowSize) state.validRawShoulders.shift();

      const medianElbow = state.validRawAngles.length >= 3 ? median(state.validRawAngles) : rawElbow;
      const medianShoulder = state.validRawShoulders.length >= 3 ? median(state.validRawShoulders) : rawShoulder;
      state.emaElbow = state.emaElbow == null
        ? medianElbow
        : state.emaElbow + config.emaAlpha * (medianElbow - state.emaElbow);
      state.emaShoulder = state.emaShoulder == null
        ? medianShoulder
        : state.emaShoulder + config.emaAlpha * (medianShoulder - state.emaShoulder);

      let velocityResidual = 0;
      if (
        state.previousRawAngle != null &&
        state.previousRawTimestampMs != null &&
        state.previousSmoothedAngle != null &&
        state.previousSmoothedTimestampMs != null
      ) {
        const rawDt = Math.max((timestampMs - state.previousRawTimestampMs) / 1000, 0.001);
        const smoothDt = Math.max((timestampMs - state.previousSmoothedTimestampMs) / 1000, 0.001);
        const rawVelocity = (rawElbow - state.previousRawAngle) / rawDt;
        const smoothVelocity = (state.emaElbow - state.previousSmoothedAngle) / smoothDt;
        velocityResidual = Math.abs(rawVelocity - smoothVelocity);
      }
      state.previousRawAngle = rawElbow;
      state.previousRawTimestampMs = timestampMs;
      state.previousSmoothedAngle = state.emaElbow;
      state.previousSmoothedTimestampMs = timestampMs;

      state.velocityResiduals.push(velocityResidual);
      while (state.velocityResiduals.length > config.velocityWindowSize) state.velocityResiduals.shift();

      jitterResult = jitterDetector.update({
        timestampMs,
        rawAngle: rawElbow,
        smoothedAngle: state.emaElbow,
        landmarkConfidence,
        analyzerPhase,
        rawValid: true
      });
      state.lastJitter = jitterResult;
    } else if (!analyzerValid) {
      jitterResult = {
        ...jitterResult,
        jitterEvent: false,
        jitterGroupedEvent: false,
        jitterSuspicious: false,
        jitterReason: reason === "low_landmark_confidence" ? "tracking_noise" : null,
        trackingNoise: reason === "low_landmark_confidence"
      };
    }

    const smoothedElbow = analyzerValid ? state.emaElbow : null;
    const smoothedShoulder = analyzerValid ? state.emaShoulder : null;

    if (smoothedElbow != null) {
      state.smoothedAngles.push({ timestampMs, angle: smoothedElbow });
      while (state.smoothedAngles.length > config.trendWindowSize) state.smoothedAngles.shift();
    }

    let velocity = 0;
    let direction = "unknown";
    if (state.smoothedAngles.length >= 2) {
      const first = state.smoothedAngles[0];
      const last = state.smoothedAngles[state.smoothedAngles.length - 1];
      const dt = Math.max((last.timestampMs - first.timestampMs) / 1000, 0.001);
      velocity = (last.angle - first.angle) / dt;
      state.velocities.push(velocity);
      while (state.velocities.length > config.velocityWindowSize) state.velocities.shift();
      if (Math.abs(velocity) <= config.stableVelocityDegPerSec) direction = "stable";
      else direction = velocity > 0 ? "increasing" : "decreasing";
    }

    const straightEnter = state.wasStraight ? config.straightLeaveAngle : config.straightEnterAngle;
    const flexedEnter = state.wasFlexed ? config.flexedLeaveAngle : config.flexedEnterAngle;
    const straightNow = smoothedElbow != null && smoothedElbow >= straightEnter;
    const flexedNow = smoothedElbow != null && smoothedElbow <= flexedEnter;
    state.wasStraight = straightNow;
    state.wasFlexed = flexedNow;
    state.straightFrames = analyzerValid && straightNow ? state.straightFrames + 1 : 0;
    state.flexedFrames = analyzerValid && flexedNow ? state.flexedFrames + 1 : 0;
    state.trackingFrames = analyzerValid ? state.trackingFrames + 1 : 0;

    const velocityResidualJitter = clamp(mean(state.velocityResiduals) / config.velocityResidualNormalizerDegPerSec, 0, 1);
    const accelerationJitter = clamp(stddev(state.velocities) / 360, 0, 1);
    const cameraJitterScore = clamp(
      (jitterResult.cameraJitterScore ?? 0) * 0.85 +
      velocityResidualJitter * 0.1 +
      accelerationJitter * 0.05,
      0,
      1
    );
    const lowSamplePenalty = state.validRawAngles.length < 3 ? 0.75 : 1;
    const confidenceLabel = analyzerValid
      ? rawValid
        ? (lowSamplePenalty < 1 ? "warming_up" : "good")
        : "grace_low_confidence"
      : "invalid";

    return {
      timestampMs,
      raw: {
        elbowAngle: round(rawElbow, 1),
        shoulderAngle: round(rawShoulder, 1),
        landmarkConfidence: round(landmarkConfidence, 3)
      },
      smoothed: {
        elbowAngle: round(smoothedElbow, 1),
        shoulderAngle: round(smoothedShoulder, 1)
      },
      validity: {
        valid: analyzerValid,
        rawValid,
        reason: rawValid ? "none" : reason,
        confidenceLabel
      },
      trend: {
        elbowDirection: direction,
        elbowVelocityDegPerSec: round(velocity, 1)
      },
      jitter: {
        cameraJitterScore: round(cameraJitterScore, 3),
        peakJitterScore: round(jitterResult.trendResidual != null
          ? clamp(jitterResult.trendResidual / config.movingTrendResidualDeg, 0, 1)
          : 0, 3),
        jitterEvent: Boolean(jitterResult.jitterGroupedEvent),
        jitterGroupedEvent: Boolean(jitterResult.jitterGroupedEvent),
        jitterSuspicious: Boolean(jitterResult.jitterSuspicious),
        jitterReason: jitterResult.jitterReason,
        trackingNoise: Boolean(jitterResult.trackingNoise),
        predictedTrendAngle: jitterResult.predictedTrendAngle,
        trendResidual: jitterResult.trendResidual,
        rawSmoothedResidual: jitterResult.rawSmoothedResidual,
        directionReversals: jitterResult.directionReversals ?? 0,
        angleResidual: jitterResult.trendResidual,
        velocityResidualDegPerSec: rawValid ? round(state.velocityResiduals.at(-1), 1) : null,
        debug: jitterResult.debug
      },
      stableFlags: {
        isStraightStable: state.straightFrames >= config.requiredStableFrames,
        isFlexedStable: state.flexedFrames >= config.requiredStableFrames,
        isTrackingStable: state.trackingFrames >= config.requiredStableFrames
      }
    };
  }

  return { update, reset, config };
}
