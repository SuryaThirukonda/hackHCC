import { SESSION_ANALYSIS_VERSION } from "./sessionAnalysisTypes.js";
import { buildLocalSessionSummary } from "./buildLocalSessionSummary.js";

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function compactRep(rep) {
  return {
    rep_index: rep.rep_index,
    range_of_motion: round(rep.range_of_motion, 1),
    push_depth_cm: round(rep.push_depth_cm, 1),
    max_extension_angle: round(rep.max_extension_angle, 1),
    hold_time_sec: round(rep.hold_time_sec, 1),
    rep_duration_sec: round(rep.rep_duration_sec, 1),
    pace: rep.pace || "unknown",
    jitter_score: round(rep.jitter_score, 2),
    shoulder_drift: round(rep.shoulder_drift, 1),
    sensor_linearity_score: round(rep.sensor_linearity_score, 2),
    physio_score: Number.isFinite(rep.physio_score) ? Math.round(rep.physio_score) : null,
    issue: rep.issue || "none",
    clean: Boolean(rep.clean)
  };
}

export function buildFinalSessionAnalysisPacket({ runner, exercise, sessionId, painLevel = 2, fatigueLevel = 4 } = {}) {
  const localSummary = buildLocalSessionSummary({ runner, exercise, sessionId, painLevel, fatigueLevel });
  return {
    schema_version: SESSION_ANALYSIS_VERSION,
    exercise_id: localSummary.exercise,
    exercise_name: localSummary.exercise_name,
    mode: "post_session_analysis",
    session: {
      session_id: localSummary.session_id,
      user_id: localSummary.user_id,
      side: localSummary.side,
      started_at_ms: localSummary.started_at_ms,
      ended_at_ms: localSummary.ended_at_ms,
      duration_sec: localSummary.duration_sec
    },
    goals: {
      rep_goal: localSummary.rep_goal,
      target_elbow_range: exercise?.targetPosition
        ? `${exercise.targetPosition.elbowAngleMin}-${exercise.targetPosition.elbowAngleMax} degrees`
        : null,
      required_hold_sec: exercise?.holdSeconds ?? null
    },
    aggregate_metrics: {
      total_reps: localSummary.total_reps,
      clean_reps: localSummary.clean_reps,
      average_physio_score: localSummary.average_physio_score,
      best_range_of_motion: localSummary.best_range_of_motion,
      average_range_of_motion: localSummary.average_range_of_motion,
      average_hold_time_sec: localSummary.average_hold_time_sec,
      average_rep_duration_sec: localSummary.average_rep_duration_sec,
      average_jitter_score: localSummary.average_jitter_score,
      max_jitter_score: localSummary.max_jitter_score,
      raw_average_elbow_angle: localSummary.raw_average_elbow_angle,
      smoothed_average_elbow_angle: localSummary.smoothed_average_elbow_angle,
      raw_average_shoulder_angle: localSummary.raw_average_shoulder_angle,
      smoothed_average_shoulder_angle: localSummary.smoothed_average_shoulder_angle,
      best_push_depth_cm: localSummary.best_push_depth_cm,
      average_push_depth_cm: localSummary.average_push_depth_cm,
      average_extension_angle: localSummary.average_extension_angle,
      average_shoulder_drift: localSummary.average_shoulder_drift,
      average_sensor_linearity_score: localSummary.average_sensor_linearity_score
    },
    tracking_quality: localSummary.tracking_quality,
    movement_trace: localSummary.movement_trace || [],
    trace_summary: localSummary.trace_summary || {},
    issue_summary: {
      common_issue: localSummary.common_issue,
      issue_label: localSummary.issue_label,
      issue_counts: localSummary.issue_counts,
      zero_rep_reason: localSummary.zero_rep_reason,
      warnings: localSummary.warnings
    },
    rep_breakdown: (localSummary.completed_reps || []).map(compactRep),
    patient_reported: {
      pain_level: painLevel,
      fatigue_level: fatigueLevel
    },
    local_summary: {
      summary_text: localSummary.summary_text,
      recommendation_text: localSummary.recommendation_text
    }
  };
}
