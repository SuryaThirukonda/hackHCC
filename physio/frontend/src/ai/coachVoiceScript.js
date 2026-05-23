const PHASE_VOICE = {
  CALIBRATION_READY: "Calibration set. Begin now.",
  WAITING_FOR_START: "Arm straight to start.",
  STRAIGHTEN_TO_START: "Straighten first.",
  EXTENDED_READY: "Bend slowly.",
  FLEXING: "Curl slowly.",
  FLEXED_HOLD: "Hold there.",
  HOLD_COMPLETE: "Extend now.",
  EXTENDING: "Straighten slowly.",
  WAITING_FOR_TRACKING: "Bend to start.",
  MOVE_TO_BENT: "Move to bent.",
  START_BENT_HOLD: "Hold bent.",
  START_BENT_READY: "Press forward.",
  PUSHING: "Press smoothly.",
  EXTENDED_HOLD: "Hold reach.",
  RETURNING: "Return slowly.",
  REP_COMPLETE: "Good rep.",
  SESSION_COMPLETE: "Session complete."
};

const STATE_VOICE = {
  straighten_more: "Straighten more.",
  bend_more: "Bend deeper.",
  hold_longer: "Hold briefly.",
  too_fast: "Slow down.",
  too_jittery: "Move smoothly.",
  keep_upper_arm_still: "Keep arm level.",
  low_confidence: "Keep arm visible.",
  good_form: "Keep control.",
  almost_there: "Stay with it.",
  rep_complete: "Good rep.",
  // Chest-press framing cues — spoken when arm is outside optimal camera zone
  frame_too_far: "Come closer to the camera.",
  frame_too_close: "Step back from the camera.",
  frame_arm_missing: "Move your arm fully into view.",
  frame_arm_cut: "Reframe — part of your arm is cut off.",
};

export function phaseVoiceLine(phase) {
  return PHASE_VOICE[phase] || null;
}

export function stateVoiceLine(coachState) {
  return STATE_VOICE[coachState] || null;
}

export function resolveSpokenCoachCue({ aiCue, packet, analyzerOutput }) {
  const phase = analyzerOutput?.phase || packet?.analyzer_output?.phase;
  const coachState = analyzerOutput?.coach_state || packet?.coach_state;

  const phaseLine = phaseVoiceLine(phase);
  if (phaseLine) return { text: phaseLine, source: "phase_cue" };

  const stateLine = stateVoiceLine(coachState);
  if (stateLine) return { text: stateLine, source: "local_fallback" };

  const local = packet?.local_coach_message || analyzerOutput?.local_coach_message;
  if (local) return { text: local, source: "local_fallback" };

  return { text: "Move slowly and stay in control.", source: "local_fallback" };
}

export function resolveOverlayCoachMessage({ aiCue, packet, analyzerOutput }) {
  const scripted = resolveSpokenCoachCue({ aiCue: null, packet, analyzerOutput });
  return scripted.text;
}
