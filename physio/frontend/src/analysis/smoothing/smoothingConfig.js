export const ELBOW_FLEXION_SMOOTHING_CONFIG = {
  minLandmarkConfidence: 0.45,
  invalidGraceMs: 250,
  medianWindowSize: 5,
  emaAlpha: 0.35,
  trendWindowSize: 5,
  residualWindowSize: 5,
  velocityWindowSize: 6,
  residualJitterNormalizerDeg: 12,
  velocityResidualNormalizerDegPerSec: 280,
  peakWindowSize: 4,
  peakJitterWeight: 0.45,
  smoothJitterWeight: 0.55,
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
  trendWindowSize: 5,
  residualWindowSize: 5,
  velocityWindowSize: 6,
  residualJitterNormalizerDeg: 12,
  velocityResidualNormalizerDegPerSec: 280,
  peakWindowSize: 4,
  peakJitterWeight: 0.45,
  smoothJitterWeight: 0.55,
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
  "shoulder_extension"
]);

export function smoothingConfigForExercise(exerciseId) {
  if (exerciseId === "seated_one_arm_forward_press") {
    return FORWARD_PRESS_SMOOTHING_CONFIG;
  }
  return ELBOW_FLEXION_SMOOTHING_CONFIG;
}
