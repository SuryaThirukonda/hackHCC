// All smoothing and hysteresis threshold constants live here.
// Changing a number here affects the entire smoothing pipeline.

export const SMOOTHING = {
  // Rolling median window (number of valid raw samples to median over)
  MEDIAN_WINDOW: 5,

  // EMA weight for the most-recent sample (0 = ignore new, 1 = no smoothing)
  EMA_ALPHA: 0.35,

  // Minimum required valid frames before reporting a smoothed value
  MIN_VALID_FRAMES: 3,

  // Number of consecutive valid frames required before flagging a stable position
  REQUIRED_STABLE_FRAMES: 4,

  // If tracking is lost, keep the last smoothed value for this long before invalidating
  INVALID_GRACE_MS: 250,

  // Minimum landmark confidence to accept a frame as valid
  MIN_LANDMARK_CONFIDENCE: 0.45,

  // Elbow angle bounds for physical plausibility gate
  ELBOW_ANGLE_MIN: 20,
  ELBOW_ANGLE_MAX: 180,
};

// Hysteresis thresholds prevent flicker on phase boundary crossings.
// Enter/leave thresholds intentionally differ.
export const HYSTERESIS = {
  // Arm is considered "straight" when angle climbs above ENTER_STRAIGHT.
  // It stays "straight" until it falls below LEAVE_STRAIGHT.
  ENTER_STRAIGHT: 150,
  LEAVE_STRAIGHT: 135,

  // Arm is considered at "target flexion" when angle drops below ENTER_FLEXED.
  // It stays "flexed" until it rises above LEAVE_FLEXED.
  ENTER_FLEXED: 100,
  LEAVE_FLEXED: 115,
};

// Jitter scoring constants
export const JITTER = {
  // Residual = abs(raw - smoothed). This divisor normalises it to 0–1 range.
  RESIDUAL_NORMALISER: 20,

  // Number of recent smoothed samples used to estimate velocity jitter
  VELOCITY_WINDOW: 5,

  // Blend weight for residual vs velocity-jitter components
  RESIDUAL_WEIGHT: 0.7,
  VELOCITY_WEIGHT: 0.3,
};

// Trend estimation window (number of smoothed angle samples)
export const TREND = {
  WINDOW: 5,
  // Degrees-per-second considered "stable" (not clearly flexing or extending)
  STABLE_VELOCITY_THRESHOLD: 8,
};
