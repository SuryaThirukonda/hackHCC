export const SESSION_ANALYSIS_VERSION = "session_analysis_v2";

export const ZERO_REP_REASONS = {
  NO_VALID_REPS: "no_valid_reps_completed",
  TRACKING_LOST: "tracking_lost",
  TARGET_NOT_REACHED: "target_flexion_not_reached",
  HOLD_TOO_SHORT: "hold_too_short",
  EXTENSION_NOT_DETECTED: "extension_not_detected",
  SESSION_TOO_SHORT: "session_too_short"
};

export const SESSION_ANALYSIS_STATUS = {
  IDLE: "idle",
  LOADING: "loading",
  READY: "ready",
  FALLBACK: "fallback",
  ERROR: "error"
};
