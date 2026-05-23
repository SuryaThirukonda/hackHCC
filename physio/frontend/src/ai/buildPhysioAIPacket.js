function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const PHASE_INSTRUCTIONS = {
  WAITING_FOR_START: "Guide the user to straighten the arm to begin.",
  STRAIGHTEN_TO_START: "User began bent; guide them to straighten before curling.",
  EXTENDED_READY: "Arm is straight; tell them to bend the elbow slowly.",
  FLEXING: "User is curling; encourage a controlled bend.",
  FLEXED_HOLD: "User should hold the bent position briefly.",
  EXTENDING: "User is straightening; encourage a calm extension.",
  WAITING_FOR_TRACKING: "Guide the user to start with the elbow bent.",
  START_BENT_READY: "User is ready to press; cue a slow forward push.",
  PUSHING: "User is pressing forward; cue steady linear motion.",
  EXTENDED_HOLD: "User should hold the forward reach briefly.",
  RETURNING: "User is returning; encourage a controlled bend.",
  REP_COMPLETE: "Celebrate the completed rep briefly.",
  SESSION_COMPLETE: "Session is done; give a calm closing line."
};

export function buildPhysioAIPacket({ exercise, analyzerOutput, packet, summary, mode = "live_coaching" }) {
  const output = analyzerOutput || packet?.analyzer_output || {};
  const coachState = output.coach_state || packet?.coach_state || "low_confidence";
  const phase = output.phase || packet?.analyzer_output?.phase || null;
  return {
    exercise_id: exercise?.id || output.exercise_id || packet?.exercise || "elbow_flexion_extension",
    exercise_name: exercise?.name || output.exercise_name || "Elbow Flexion / Extension",
    mode,
    phase,
    phase_label: packet?.analyzer_phase_label || phase,
    movement_instruction: PHASE_INSTRUCTIONS[phase] || "Give one short calming coaching cue for the current step.",
    rep_count: output.rep_count ?? packet?.rep_count ?? summary?.total_reps ?? 0,
    rep_goal: output.rep_goal ?? exercise?.repGoal ?? summary?.rep_goal ?? 8,
    elbow_angle: round(output.elbow_angle ?? packet?.elbow_angle),
    target_elbow_range: exercise?.targetPosition
      ? `${exercise.targetPosition.elbowAngleMin}-${exercise.targetPosition.elbowAngleMax} degrees`
      : `${output.target_elbow_min ?? 55}-${output.target_elbow_max ?? 100} degrees`,
    hold_time_sec: round(output.hold_time_sec ?? packet?.hold_time_sec),
    push_depth_cm: round(output.push_depth_cm ?? packet?.push_depth_cm),
    sensor_linearity_score: round(output.sensor_linearity_score ?? packet?.sensor_linearity_score, 2),
    distance_cm: round(packet?.distance_cm),
    pace: output.pace || packet?.pace || "unknown",
    jitter_score: round(output.jitter_score ?? packet?.combined_jitter_score, 2),
    shoulder_drift: round(output.shoulder_drift ?? packet?.shoulder_drift),
    coach_state: coachState,
    local_coach_message: output.local_coach_message || packet?.local_coach_message || "Move your full arm into view.",
    physio_score: Number.isFinite(output.physio_score ?? packet?.physio_score)
      ? Math.round(output.physio_score ?? packet?.physio_score)
      : null
  };
}
