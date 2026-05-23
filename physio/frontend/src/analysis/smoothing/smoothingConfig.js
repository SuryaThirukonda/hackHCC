export const ELBOW_FLEXION_SMOOTHING_CONFIG = {
  minLandmarkConfidence: 0.45,
  invalidGraceMs: 250,
  medianWindowSize: 5,
  emaAlpha: 0.35,
  trendWindowSize: 5,
  // Smaller windows make the score react faster to individual spikes
  residualWindowSize: 5,
  velocityWindowSize: 6,
  // Lower normalizer = spikes score higher (18° spike → 1.0 instead of needing 36°)
  residualJitterNormalizerDeg: 12,
  velocityResidualNormalizerDegPerSec: 280,
  // Peak jitter window: max residual in last N frames blended into final score
  peakWindowSize: 4,
  peakJitterWeight: 0.45,          // how much the peak (worst frame) contributes
  smoothJitterWeight: 0.55,        // how much the running average contributes
  requiredStableFrames: 4,
  elbowAngleMin: 20,
  elbowAngleMax: 180,
  straightEnterAngle: 150,
  straightLeaveAngle: 135,
  flexedEnterAngle: 100,
  flexedLeaveAngle: 115,
  stableVelocityDegPerSec: 12
};

export const SMOOTHED_EXERCISE_IDS = new Set([
  "elbow_flexion_extension",
  "shoulder_extension"
]);
