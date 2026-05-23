export const ELBOW_FLEXION_SMOOTHING_CONFIG = {
  minLandmarkConfidence: 0.45,
  invalidGraceMs: 250,
  medianWindowSize: 5,
  emaAlpha: 0.35,
  trendWindowSize: 8,
  velocityWindowSize: 6,
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
  velocityResidualNormalizerDegPerSec: 280,
  requiredStableFrames: 4,
  elbowAngleMin: 20,
  elbowAngleMax: 180,
  straightEnterAngle: 150,
  straightLeaveAngle: 135,
  flexedEnterAngle: 100,
  flexedLeaveAngle: 115,
  stableVelocityDegPerSec: 12
};

export const FORWARD_PRESS_SMOOTHING_CONFIG = {
  minLandmarkConfidence: 0.45,
  invalidGraceMs: 250,
  medianWindowSize: 5,
  emaAlpha: 0.35,
  trendWindowSize: 8,
  velocityWindowSize: 6,
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
  velocityResidualNormalizerDegPerSec: 280,
  requiredStableFrames: 4,
  elbowAngleMin: 55,
  elbowAngleMax: 180,
  straightEnterAngle: 150,
  straightLeaveAngle: 135,
  flexedEnterAngle: 100,
  flexedLeaveAngle: 115,
  stableVelocityDegPerSec: 12
};

export const SMOOTHED_EXERCISE_IDS = new Set([
  "elbow_flexion_extension",
  "shoulder_extension",
  "seated_one_arm_forward_press"
]);

export function smoothingConfigForExercise(exerciseId) {
  if (exerciseId === "seated_one_arm_forward_press") {
    return FORWARD_PRESS_SMOOTHING_CONFIG;
  }
  return ELBOW_FLEXION_SMOOTHING_CONFIG;
}
