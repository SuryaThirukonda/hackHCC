const PHASE_VOICE = {
  WAITING_FOR_START: "Hold your arm straight to start.",
  STRAIGHTEN_TO_START: "Nice and easy. Straighten your arm before the next curl.",
  EXTENDED_READY: "Great. Now bend your elbow slowly.",
  FLEXING: "Beautiful control. Curl inward, slow and smooth.",
  FLEXED_HOLD: "Great. Now hold it right there.",
  HOLD_COMPLETE: "Now slowly extend your arm.",
  EXTENDING: "Great work. Straighten your arm with control.",
  REP_COMPLETE: "Wonderful rep. Rest a moment, then continue.",
  SESSION_COMPLETE: "Great work. Session complete. Follow your therapist's plan for your next session."
};

const STATE_VOICE = {
  straighten_more: "Gently extend your elbow a little more.",
  bend_more: "Bend a little deeper into the target zone.",
  hold_longer: "Pause at the bend for one calm breath.",
  too_fast: "Slow down. Smooth movement keeps you safe.",
  too_jittery: "Steady your arm. Smaller movements feel better.",
  keep_upper_arm_still: "Keep your upper arm quiet while you move.",
  low_confidence: "Shift so your shoulder, elbow, and wrist stay visible.",
  good_form: "You're on track. Keep this calm pace.",
  rep_complete: "Strong rep. Settle your breath before the next one."
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
