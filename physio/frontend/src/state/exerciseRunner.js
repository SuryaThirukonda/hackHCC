export const RUNNER_STATES = {
  IDLE: "idle",
  SELECTED: "selected",
  INSTRUCTIONS: "instructions",
  COUNTDOWN: "countdown",
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETE: "complete",
  SUMMARY: "summary"
};

export const RUNNER_EVENTS = {
  SELECT_EXERCISE: "SELECT_EXERCISE",
  START_INSTRUCTIONS: "START_INSTRUCTIONS",
  START_COUNTDOWN: "START_COUNTDOWN",
  COUNTDOWN_COMPLETE: "COUNTDOWN_COMPLETE",
  START_SESSION: "START_SESSION",
  PAUSE_SESSION: "PAUSE_SESSION",
  RESUME_SESSION: "RESUME_SESSION",
  END_SESSION: "END_SESSION",
  RESET_SESSION: "RESET_SESSION"
};

export function exerciseRunnerReducer(state, event) {
  switch (event.type) {
    case RUNNER_EVENTS.SELECT_EXERCISE:
      return {
        ...state,
        status: RUNNER_STATES.SELECTED,
        exercise: event.exercise,
        sessionId: null,
        startedAt: null,
        endedAt: null,
        activePackets: [],
        completedReps: [],
        latestAnalyzerOutput: null
      };
    case RUNNER_EVENTS.START_INSTRUCTIONS:
      return { ...state, status: RUNNER_STATES.INSTRUCTIONS };
    case RUNNER_EVENTS.START_COUNTDOWN:
      return {
        ...state,
        status: RUNNER_STATES.COUNTDOWN,
        sessionId: event.sessionId,
        startedAt: null,
        endedAt: null,
        activePackets: [],
        completedReps: [],
        latestAnalyzerOutput: null
      };
    case RUNNER_EVENTS.COUNTDOWN_COMPLETE:
    case RUNNER_EVENTS.START_SESSION:
      return {
        ...state,
        status: RUNNER_STATES.ACTIVE,
        startedAt: event.startedAt || new Date().toISOString()
      };
    case RUNNER_EVENTS.PAUSE_SESSION:
      return { ...state, status: RUNNER_STATES.PAUSED };
    case RUNNER_EVENTS.RESUME_SESSION:
      return { ...state, status: RUNNER_STATES.ACTIVE };
    case RUNNER_EVENTS.END_SESSION:
      return {
        ...state,
        status: RUNNER_STATES.COMPLETE,
        endedAt: event.endedAt || new Date().toISOString()
      };
    case RUNNER_EVENTS.RESET_SESSION:
      return createInitialExerciseRunnerState(state.exercise);
    case "PACKET_RECORDED":
      if (event.completedRep && state.completedReps.some((rep) => rep.rep_index === event.completedRep.rep_index)) {
        return {
          ...state,
          activePackets: [...state.activePackets, event.packet].slice(-1200),
          latestAnalyzerOutput: event.analyzerOutput || state.latestAnalyzerOutput
        };
      }
      return {
        ...state,
        activePackets: [...state.activePackets, event.packet].slice(-1200),
        latestAnalyzerOutput: event.analyzerOutput || state.latestAnalyzerOutput,
        completedReps: event.completedRep
          ? [...state.completedReps, event.completedRep]
          : state.completedReps
      };
    default:
      return state;
  }
}

export function createInitialExerciseRunnerState(exercise = null) {
  return {
    status: exercise ? RUNNER_STATES.SELECTED : RUNNER_STATES.IDLE,
    exercise,
    sessionId: null,
    startedAt: null,
    endedAt: null,
    activePackets: [],
    completedReps: [],
    latestAnalyzerOutput: null
  };
}

export function isRecordingState(status) {
  return status === RUNNER_STATES.ACTIVE;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function issueLabel(issue) {
  return {
    did_not_bend_enough: "did not bend enough",
    short_push_depth: "short push depth",
    did_not_hold_long_enough: "short hold time",
    moved_too_fast: "moving too fast",
    too_jittery: "motion not steady",
    shoulder_compensation: "upper arm moving",
    low_confidence: "low confidence",
    none: "good control"
  }[issue] || issue;
}

function recommendationForIssue(issue) {
  return {
    did_not_bend_enough: "Focus on bending deeper into the target zone.",
    short_push_depth: "Press a little farther while keeping the motion smooth.",
    did_not_hold_long_enough: "Pause briefly at the bent position before extending.",
    moved_too_fast: "Slow down each rep and control the return.",
    too_jittery: "Use a steadier pace and avoid sudden changes.",
    shoulder_compensation: "Keep your upper arm more still during the curl.",
    low_confidence: "Keep your full arm visible to the camera.",
    none: "Keep the same controlled pace next session."
  }[issue] || "Repeat the exercise with steady, controlled motion.";
}

export function summarizeRunnerSession(state, { sessionId, exercise, painLevel = 2, fatigueLevel = 4 } = {}) {
  const packets = state.activePackets || [];
  const completedReps = state.completedReps || [];
  const uniqueReps = Array.from(new Map(completedReps.map((rep) => [rep.rep_index, rep])).values());
  const validPackets = packets.filter((packet) => packet?.angle_valid !== false);
  const rangeValues = uniqueReps.map((rep) => rep.range_of_motion).filter((value) => Number.isFinite(value));
  const pushDepthValues = uniqueReps.map((rep) => rep.push_depth_cm).filter((value) => Number.isFinite(value));
  const linearityValues = uniqueReps.map((rep) => rep.sensor_linearity_score).filter((value) => Number.isFinite(value));
  const extensionAngleValues = uniqueReps.map((rep) => rep.max_extension_angle).filter((value) => Number.isFinite(value));
  const shoulderDriftValues = uniqueReps.map((rep) => rep.shoulder_drift).filter((value) => Number.isFinite(value));
  const holdValues = uniqueReps.map((rep) => rep.hold_time_sec).filter((value) => Number.isFinite(value));
  const durationValues = uniqueReps.map((rep) => rep.rep_duration_sec).filter((value) => Number.isFinite(value));
  const scoreValues = [
    ...uniqueReps.map((rep) => rep.physio_score),
    ...validPackets.map((packet) => packet.physio_score)
  ].filter((value) => Number.isFinite(value));
  const jitterValues = validPackets
    .map((packet) => packet.combined_jitter_score ?? packet.jitter_score)
    .filter((value) => Number.isFinite(value));

  const issueCounts = {
    did_not_bend_enough: uniqueReps.filter((rep) => rep.issue === "did_not_bend_enough").length,
    short_push_depth: uniqueReps.filter((rep) => rep.issue === "short_push_depth").length,
    did_not_hold_long_enough: uniqueReps.filter((rep) => (rep.hold_time_sec ?? 0) < (exercise?.holdSeconds ?? 1)).length,
    moved_too_fast: uniqueReps.filter((rep) => rep.pace === "too_fast").length,
    too_jittery: uniqueReps.filter((rep) => (rep.jitter_score ?? 0) > (exercise?.jitterThreshold ?? 0.35)).length,
    shoulder_compensation: uniqueReps.filter((rep) => (rep.shoulder_drift ?? 0) > (exercise?.shoulderDriftThreshold ?? 28)).length,
    low_confidence: packets.filter((packet) => packet?.coach_state === "low_confidence" || packet?.angle_valid === false).length
  };
  const commonIssue = Object.entries(issueCounts).sort((a, b) => b[1] - a[1])[0];
  const commonIssueKey = commonIssue && commonIssue[1] > 0 ? commonIssue[0] : "none";
  const endedAt = new Date();
  const startedAt = state.startedAt ? new Date(state.startedAt) : endedAt;
  const totalReps = Math.max(
    uniqueReps.length,
    ...packets.map((packet) => packet?.rep_count || 0),
    0
  );
  const isForwardPress = exercise?.movementType === "forward_press" || state.exercise?.movementType === "forward_press";
  const bestRange = Math.max(...rangeValues, 0);
  const bestPushDepth = Math.max(...pushDepthValues, 0);

  return {
    session_id: sessionId || state.sessionId || "local-webcam-session",
    user_id: "demo-user",
    exercise: exercise?.id || state.exercise?.id || "elbow_flexion_extension",
    side: exercise?.side || state.exercise?.side || "right",
    started_at_ms: startedAt.getTime(),
    ended_at_ms: endedAt.getTime(),
    duration_sec: Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)),
    total_reps: totalReps,
    clean_reps: uniqueReps.filter((rep) => rep.clean).length,
    rep_goal: exercise?.repGoal || state.exercise?.repGoal || 8,
    best_angle: Number(bestRange.toFixed(1)),
    average_angle: Number(average(rangeValues).toFixed(1)),
    best_range_of_motion: Number(bestRange.toFixed(1)),
    average_range_of_motion: Number(average(rangeValues).toFixed(1)),
    best_push_depth_cm: Number(bestPushDepth.toFixed(1)),
    average_push_depth_cm: Number(average(pushDepthValues).toFixed(1)),
    average_extension_angle: Number(average(extensionAngleValues).toFixed(1)),
    average_shoulder_drift: Number(average(shoulderDriftValues).toFixed(1)),
    average_sensor_linearity_score: Number(average(linearityValues).toFixed(2)),
    average_hold_time_sec: Number(average(holdValues).toFixed(1)),
    average_rep_duration_sec: Number(average(durationValues).toFixed(1)),
    average_physio_score: Math.round(average(scoreValues)),
    max_jitter_score: Number((Math.max(...jitterValues, 0)).toFixed(2)),
    average_jitter_score: Number(average(jitterValues).toFixed(2)),
    pain_level: painLevel,
    fatigue_level: fatigueLevel,
    common_issue: commonIssueKey,
    shoulder_compensation_count: issueCounts.shoulder_compensation,
    summary_text: isForwardPress
      ? `User completed ${totalReps} ${totalReps === 1 ? "press" : "presses"} with a best push depth of ${bestPushDepth.toFixed(1)} cm.`
      : `User completed ${totalReps} ${totalReps === 1 ? "rep" : "reps"} with a best range of motion of ${bestRange.toFixed(1)} degrees.`,
    recommendation_text: recommendationForIssue(commonIssueKey),
    issue_label: issueLabel(commonIssueKey),
    completed_reps: uniqueReps
  };
}
