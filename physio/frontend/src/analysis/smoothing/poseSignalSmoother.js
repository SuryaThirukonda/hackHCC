/**
 * poseSignalSmoother — processes raw MediaPipe frames into smooth, stable signals.
 *
 * Pipeline per frame:
 *   raw input
 *   → validity gate
 *   → rolling median (spike removal)
 *   → exponential moving average (lag smoothing)
 *   → trend estimation
 *   → jitter score
 *   → consecutive-frame stability flags
 *   → SmoothedPoseFrame output
 *
 * The analyzer should consume smoothedElbowAngle, not raw elbowAngle.
 * Both raw and smoothed values are preserved in the output for logging/results.
 */

import { HYSTERESIS, JITTER, SMOOTHING, TREND } from "./smoothingConfig.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function rollingMedian(samples) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function createPoseSignalSmoother() {
  // Raw valid elbow angle ring buffer for median filter
  const rawElbowBuffer = [];
  // Smoothed elbow angle ring buffer for trend + jitter
  const smoothedElbowHistory = [];
  // Timestamps paired with smoothed values for velocity estimation
  const smoothedTimestampHistory = [];

  let smoothedElbow = null;
  let smoothedShoulder = null;

  let lastValidMs = null;
  let invalidSinceMs = null;

  // Straight / flexed stability counters
  let straightCount = 0;
  let flexedCount = 0;
  let trackingValidCount = 0;

  // Hysteresis state (prevents flicker without debounce)
  let inStraightZone = false;
  let inFlexedZone = false;

  function pushRaw(value, buffer, maxLen) {
    buffer.push(value);
    while (buffer.length > maxLen) buffer.shift();
  }

  function pushHistory(value, ts, valueArr, tsArr, maxLen) {
    valueArr.push(value);
    tsArr.push(ts);
    while (valueArr.length > maxLen) {
      valueArr.shift();
      tsArr.shift();
    }
  }

  function isPhysicallyValid(elbowAngle) {
    return (
      typeof elbowAngle === "number" &&
      !Number.isNaN(elbowAngle) &&
      elbowAngle >= SMOOTHING.ELBOW_ANGLE_MIN &&
      elbowAngle <= SMOOTHING.ELBOW_ANGLE_MAX
    );
  }

  function computeJitter(rawElbow) {
    if (smoothedElbow == null || rawElbow == null) return 0;

    // Residual component
    const residual = Math.abs(rawElbow - smoothedElbow);
    const residualScore = clamp(residual / JITTER.RESIDUAL_NORMALISER, 0, 1);

    // Velocity jitter component
    const recentSmoothed = smoothedElbowHistory.slice(-JITTER.VELOCITY_WINDOW);
    const recentTs = smoothedTimestampHistory.slice(-JITTER.VELOCITY_WINDOW);
    const velocities = [];
    for (let i = 1; i < recentSmoothed.length; i++) {
      const dt = Math.max((recentTs[i] - recentTs[i - 1]) / 1000, 0.001);
      velocities.push((recentSmoothed[i] - recentSmoothed[i - 1]) / dt);
    }
    const velJitter = velocities.length >= 2
      ? clamp(stddev(velocities) / 120, 0, 1)
      : 0;

    return clamp(
      residualScore * JITTER.RESIDUAL_WEIGHT + velJitter * JITTER.VELOCITY_WEIGHT,
      0,
      1
    );
  }

  function computeTrend(timestampMs) {
    const n = smoothedElbowHistory.length;
    if (n < 2) return { direction: "unknown", velocityDegPerSec: 0 };

    const recent = smoothedElbowHistory.slice(-TREND.WINDOW);
    const recentTs = smoothedTimestampHistory.slice(-TREND.WINDOW);
    const dt = Math.max((recentTs[recentTs.length - 1] - recentTs[0]) / 1000, 0.001);
    const deltaAngle = recent[recent.length - 1] - recent[0];
    const velocity = deltaAngle / dt;

    let direction;
    if (Math.abs(velocity) < TREND.STABLE_VELOCITY_THRESHOLD) {
      direction = "stable";
    } else if (velocity > 0) {
      direction = "increasing"; // arm extending
    } else {
      direction = "decreasing"; // arm flexing / curling
    }

    return { direction, velocityDegPerSec: Math.round(velocity) };
  }

  function updateHysteresis(elbowAngle) {
    // Straight zone (hysteresis)
    if (!inStraightZone && elbowAngle >= HYSTERESIS.ENTER_STRAIGHT) {
      inStraightZone = true;
    } else if (inStraightZone && elbowAngle < HYSTERESIS.LEAVE_STRAIGHT) {
      inStraightZone = false;
    }

    // Flexed zone (hysteresis)
    if (!inFlexedZone && elbowAngle <= HYSTERESIS.ENTER_FLEXED) {
      inFlexedZone = true;
    } else if (inFlexedZone && elbowAngle > HYSTERESIS.LEAVE_FLEXED) {
      inFlexedZone = false;
    }

    // Stability counters
    if (inStraightZone) {
      straightCount++;
    } else {
      straightCount = 0;
    }

    if (inFlexedZone) {
      flexedCount++;
    } else {
      flexedCount = 0;
    }

    trackingValidCount++;
  }

  /**
   * Process one raw frame.
   * @param {object} rawFrame - must have: timestampMs, elbowAngle, shoulderAngle, landmarkConfidence, validLandmarks
   * @returns {SmoothedPoseFrame}
   */
  function process(rawFrame) {
    const timestampMs = rawFrame.timestampMs ?? rawFrame.timestamp_ms ?? Date.now();
    const rawElbow = rawFrame.elbowAngle ?? rawFrame.elbow_angle ?? null;
    const rawShoulder = rawFrame.shoulderAngle ?? rawFrame.shoulder_angle ?? null;
    const confidence = rawFrame.landmarkConfidence ?? rawFrame.landmark_confidence ?? 0;
    const landmarksPresent = rawFrame.validLandmarks ?? rawFrame.angle_valid ?? false;

    // ---- Validity gate ----
    const gatePass =
      landmarksPresent &&
      isPhysicallyValid(rawElbow) &&
      confidence >= SMOOTHING.MIN_LANDMARK_CONFIDENCE;

    if (!gatePass) {
      const inGrace = lastValidMs != null &&
        (timestampMs - lastValidMs) <= SMOOTHING.INVALID_GRACE_MS;

      if (!inGrace) {
        // Full invalidation after grace window
        straightCount = 0;
        flexedCount = 0;
        trackingValidCount = 0;
      }

      if (invalidSinceMs == null) invalidSinceMs = timestampMs;

      return {
        timestampMs,
        raw: { elbowAngle: rawElbow, shoulderAngle: rawShoulder, landmarkConfidence: confidence },
        smoothed: { elbowAngle: smoothedElbow, shoulderAngle: smoothedShoulder },
        validity: {
          valid: false,
          reason: !landmarksPresent ? "landmarks_missing"
            : !isPhysicallyValid(rawElbow) ? "angle_out_of_range"
            : "low_confidence",
          confidenceLabel: "low",
          inGrace,
        },
        trend: { direction: "unknown", velocityDegPerSec: 0 },
        jitter: { cameraJitterScore: 0, angleResidual: 0 },
        stableFlags: {
          isStraightStable: straightCount >= SMOOTHING.REQUIRED_STABLE_FRAMES,
          isFlexedStable: flexedCount >= SMOOTHING.REQUIRED_STABLE_FRAMES,
          isTrackingStable: false,
        },
      };
    }

    // Valid frame
    lastValidMs = timestampMs;
    invalidSinceMs = null;

    // ---- Rolling median ----
    pushRaw(rawElbow, rawElbowBuffer, SMOOTHING.MEDIAN_WINDOW);
    const medianElbow = rawElbowBuffer.length >= SMOOTHING.MIN_VALID_FRAMES
      ? rollingMedian(rawElbowBuffer)
      : rawElbow;

    // ---- EMA on median-filtered signal ----
    const alpha = SMOOTHING.EMA_ALPHA;
    smoothedElbow = smoothedElbow == null
      ? medianElbow
      : smoothedElbow * (1 - alpha) + medianElbow * alpha;

    // Simple EMA for shoulder angle
    smoothedShoulder = smoothedShoulder == null
      ? rawShoulder
      : (rawShoulder != null
          ? smoothedShoulder * (1 - alpha) + rawShoulder * alpha
          : smoothedShoulder);

    // ---- History for trend + jitter ----
    pushHistory(smoothedElbow, timestampMs, smoothedElbowHistory, smoothedTimestampHistory, TREND.WINDOW + 2);

    // ---- Jitter score ----
    const angleResidual = Math.abs(rawElbow - smoothedElbow);
    const cameraJitterScore = computeJitter(rawElbow);

    // ---- Trend ----
    const trend = computeTrend(timestampMs);

    // ---- Hysteresis + stability ----
    updateHysteresis(smoothedElbow);

    const confidenceLabel =
      confidence >= 0.8 ? "high" : confidence >= 0.6 ? "medium" : "low";

    return {
      timestampMs,
      raw: { elbowAngle: rawElbow, shoulderAngle: rawShoulder, landmarkConfidence: confidence },
      smoothed: { elbowAngle: Math.round(smoothedElbow * 10) / 10, shoulderAngle: smoothedShoulder != null ? Math.round(smoothedShoulder * 10) / 10 : null },
      validity: { valid: true, reason: "ok", confidenceLabel, inGrace: false },
      trend,
      jitter: { cameraJitterScore: Math.round(cameraJitterScore * 100) / 100, angleResidual: Math.round(angleResidual * 10) / 10 },
      stableFlags: {
        isStraightStable: straightCount >= SMOOTHING.REQUIRED_STABLE_FRAMES,
        isFlexedStable: flexedCount >= SMOOTHING.REQUIRED_STABLE_FRAMES,
        isTrackingStable: trackingValidCount >= SMOOTHING.REQUIRED_STABLE_FRAMES,
      },
    };
  }

  function reset() {
    rawElbowBuffer.length = 0;
    smoothedElbowHistory.length = 0;
    smoothedTimestampHistory.length = 0;
    smoothedElbow = null;
    smoothedShoulder = null;
    lastValidMs = null;
    invalidSinceMs = null;
    straightCount = 0;
    flexedCount = 0;
    trackingValidCount = 0;
    inStraightZone = false;
    inFlexedZone = false;
  }

  return { process, reset };
}
