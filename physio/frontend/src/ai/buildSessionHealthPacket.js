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
    best_push_depth_cm: summary.best_push_depth_cm,
    average_push_depth_cm: summary.average_push_depth_cm,
    average_extension_angle: summary.average_extension_angle,
    average_shoulder_drift: summary.average_shoulder_drift,
    average_sensor_linearity_score: summary.average_sensor_linearity_score,
    average_physio_score: summary.average_physio_score,
    average_jitter_score: summary.average_jitter_score,
    total_jitter_events: summary.total_jitter_events ?? summary.tracking_quality?.total_jitter_events ?? 0,
    average_hold_time_sec: summary.average_hold_time_sec,
    average_rep_duration_sec: summary.average_rep_duration_sec,
    common_issue: summary.common_issue,
    issue_label: summary.issue_label,
    pain_level: summary.pain_level,
    fatigue_level: summary.fatigue_level,
    completed_reps: (summary.completed_reps || []).map((rep) => ({
      rep_index: rep.rep_index,
      start_elbow_angle: round(rep.start_elbow_angle),
      return_elbow_angle: round(rep.return_elbow_angle),
      max_extension_angle: round(rep.max_extension_angle),
      range_of_motion: round(rep.range_of_motion),
      push_depth_cm: round(rep.push_depth_cm),
      sensor_linearity_score: round(rep.sensor_linearity_score, 2),
      hold_time_sec: round(rep.hold_time_sec),
      rep_duration_sec: round(rep.rep_duration_sec),
      pace: rep.pace,
      jitter_score: round(rep.jitter_score, 2),
      jitter_count: rep.jitter_count ?? null,
      shoulder_drift: round(rep.shoulder_drift),
      physio_score: rep.physio_score,
      issue: rep.issue,
      clean: Boolean(rep.clean)
    }))
  };
}
