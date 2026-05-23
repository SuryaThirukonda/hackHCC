function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function buildSessionHealthPacket(summary) {
  if (!summary) return {};
  return {
    exercise: summary.exercise,
    duration_sec: summary.duration_sec,
    total_reps: summary.total_reps,
    clean_reps: summary.clean_reps,
    rep_goal: summary.rep_goal,
    best_range_of_motion: summary.best_range_of_motion ?? summary.best_angle,
    average_range_of_motion: summary.average_range_of_motion ?? summary.average_angle,
    average_physio_score: summary.average_physio_score,
    average_jitter_score: summary.average_jitter_score,
    average_hold_time_sec: summary.average_hold_time_sec,
    average_rep_duration_sec: summary.average_rep_duration_sec,
    common_issue: summary.common_issue,
    issue_label: summary.issue_label,
    pain_level: summary.pain_level,
    fatigue_level: summary.fatigue_level,
    completed_reps: (summary.completed_reps || []).map((rep) => ({
      rep_index: rep.rep_index,
      range_of_motion: round(rep.range_of_motion),
      hold_time_sec: round(rep.hold_time_sec),
      rep_duration_sec: round(rep.rep_duration_sec),
      pace: rep.pace,
      jitter_score: round(rep.jitter_score, 2),
      shoulder_drift: round(rep.shoulder_drift),
      physio_score: rep.physio_score,
      issue: rep.issue,
      clean: Boolean(rep.clean)
    }))
  };
}
