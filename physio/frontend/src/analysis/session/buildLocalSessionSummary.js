import { ZERO_REP_REASONS } from "./sessionAnalysisTypes.js";
import { isInSessionEdgeTimestamp } from "../smoothing/poseSignalSmoother.js";

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function uniqueReps(reps = []) {
  return Array.from(new Map(reps.filter(Boolean).map((rep) => [rep.rep_index, rep])).values());
}

function commonIssue(issueCounts) {
  const [issue, count] = Object.entries(issueCounts).sort((a, b) => b[1] - a[1])[0] || ["none", 0];
  return count > 0 ? issue : "none";
}

function inferZeroRepReasonForPress({ packets, exercise }) {
  if (!packets.length) return ZERO_REP_REASONS.SESSION_TOO_SHORT;
  const validPackets = packets.filter((packet) => packet?.angle_valid !== false && packet?.coach_state !== "low_confidence");
  if (!validPackets.length || validPackets.length / packets.length < 0.3) return ZERO_REP_REASONS.TRACKING_LOST;
  const sensorOffline = validPackets.every((packet) => packet?.sensor_status === "offline" || packet?.distance_cm == null);
  if (sensorOffline) return ZERO_REP_REASONS.SENSOR_UNAVAILABLE;
  const elbowAngles = validPackets.map((packet) => packet.smoothed_elbow_angle ?? packet.elbow_angle).filter(Number.isFinite);
  if (!elbowAngles.length) return ZERO_REP_REASONS.TRACKING_LOST;
  const maxElbow = Math.max(...elbowAngles);
  const minElbow = Math.min(...elbowAngles);
  const targetMin = exercise?.targetPosition?.elbowAngleMin ?? 145;
  const bentMax = exercise?.startPosition?.elbowAngleMax ?? 115;
  if (maxElbow < targetMin) return ZERO_REP_REASONS.EXTENSION_NOT_REACHED;
  if (packets.some((packet) => packet?.rep_phase === "holding" || packet?.analyzer_output?.phase === "EXTENDED_HOLD")) {
    return ZERO_REP_REASONS.HOLD_TOO_SHORT;
  }
  const pushDepths = validPackets.map((packet) => packet.push_depth_cm).filter(Number.isFinite);
  if (pushDepths.length && Math.max(...pushDepths) < (exercise?.minPushDepthCm ?? 6)) {
    return ZERO_REP_REASONS.SHORT_PUSH_DEPTH;
  }
  if (minElbow > bentMax) return ZERO_REP_REASONS.DID_NOT_RETURN_TO_BENT;
  return ZERO_REP_REASONS.NO_VALID_REPS;
}

function inferZeroRepReason({ packets, exercise }) {
  const isForwardPress = exercise?.movementType === "forward_press" || exercise?.id === "seated_one_arm_forward_press";
  if (isForwardPress) return inferZeroRepReasonForPress({ packets, exercise });
  if (!packets.length) return ZERO_REP_REASONS.SESSION_TOO_SHORT;
  const validPackets = packets.filter((packet) => packet?.angle_valid !== false && packet?.coach_state !== "low_confidence");
  if (!validPackets.length || validPackets.length / packets.length < 0.3) return ZERO_REP_REASONS.TRACKING_LOST;
  const elbowAngles = validPackets.map((packet) => packet.smoothed_elbow_angle ?? packet.elbow_angle).filter(Number.isFinite);
  if (!elbowAngles.length) return ZERO_REP_REASONS.TRACKING_LOST;
  const minElbow = Math.min(...elbowAngles);
  const maxElbow = Math.max(...elbowAngles);
  const targetMax = exercise?.targetPosition?.elbowAngleMax ?? 100;
  const straightMin = exercise?.startPosition?.elbowAngleMin ?? 145;
  if (minElbow > targetMax) return ZERO_REP_REASONS.TARGET_NOT_REACHED;
  if (packets.some((packet) => packet?.rep_phase === "holding")) return ZERO_REP_REASONS.HOLD_TOO_SHORT;
  if (maxElbow < straightMin) return ZERO_REP_REASONS.EXTENSION_NOT_DETECTED;
  return ZERO_REP_REASONS.NO_VALID_REPS;
}

function recommendationForIssue(issue) {
  return {
    no_valid_reps_completed: "Complete a full bend, short hold, and controlled straighten cycle.",
    tracking_lost: "Keep your shoulder, elbow, and wrist visible for the full rep.",
    target_flexion_not_reached: "Bend into the target zone before starting the return.",
    hold_too_short: "Pause briefly in the bent position before straightening.",
    extension_not_detected: "Return to a mostly straight arm to finish each rep.",
    moved_too_fast: "Slow down the bend and return so each rep stays controlled.",
    too_jittery: "Use a steadier pace and avoid sudden jumps.",
    shoulder_compensation: "Keep the upper arm quiet while the elbow moves.",
    none: "Keep the same controlled pace next session."
  }[issue] || "Repeat the session with steady, controlled movement.";
}

function buildLowFrameRateTrace(packets, targetGapMs = 500, limit = 40) {
  const trace = [];
  let lastAt = -Infinity;
  for (const packet of packets) {
    const timestampMs = packet?.timestamp_ms ?? packet?.timestampMs;
    if (!Number.isFinite(timestampMs) || timestampMs - lastAt < targetGapMs) continue;
    const rawElbow = packet.raw_elbow_angle ?? packet.elbow_angle;
    const smoothedElbow = packet.smoothed_elbow_angle ?? packet.elbow_angle;
    if (!Number.isFinite(rawElbow) && !Number.isFinite(smoothedElbow)) continue;
    trace.push({
      t_sec: trace.length === 0 ? 0 : round((timestampMs - (packets[0]?.timestamp_ms ?? timestampMs)) / 1000, 2),
      raw_elbow_angle: round(rawElbow, 1),
      smoothed_elbow_angle: round(smoothedElbow, 1),
      angle_residual: round(packet.angle_residual, 1),
      jitter_score: round(packet.smoothing_jitter_score ?? packet.combined_jitter_score, 3),
      distance_cm: round(packet.distance_cm, 1),
      push_depth_cm: round(packet.push_depth_cm ?? packet.analyzer_output?.push_depth_cm, 1),
      phase: packet.analyzer_output?.phase || packet.rep_phase || null,
      rep_count: packet.rep_count ?? 0,
      confidence: round(packet.landmark_confidence, 2),
      valid: packet.angle_valid !== false
    });
    lastAt = timestampMs;
    if (trace.length >= limit) break;
  }
  return trace;
}

export function buildLocalSessionSummary({ runner, exercise, sessionId, painLevel = 2, fatigueLevel = 4 } = {}) {
  const packets = runner?.activePackets || [];
  const reps = uniqueReps(runner?.completedReps || []);
  const validPackets = packets.filter((packet) => packet?.angle_valid !== false && packet?.coach_state !== "low_confidence");
  const rawElbows = packets.map((packet) => packet.raw_elbow_angle).filter(Number.isFinite);
  const smoothedElbows = packets.map((packet) => packet.smoothed_elbow_angle ?? packet.elbow_angle).filter(Number.isFinite);
  const rawShoulders = packets.map((packet) => packet.raw_shoulder_angle).filter(Number.isFinite);
  const smoothedShoulders = packets.map((packet) => packet.smoothed_shoulder_angle ?? packet.shoulder_angle).filter(Number.isFinite);
  const jitterValues = packets.map((packet) => packet.smoothing_jitter_score ?? packet.combined_jitter_score).filter(Number.isFinite);
  const residualValues = packets.map((packet) => packet.angle_residual).filter(Number.isFinite);
  const velocityResidualValues = packets.map((packet) => packet.velocity_residual_deg_per_sec).filter(Number.isFinite);
  const confidenceValues = packets.map((packet) => packet.landmark_confidence).filter(Number.isFinite);
  const scoreValues = [
    ...reps.map((rep) => rep.physio_score),
    ...validPackets.map((packet) => packet.physio_score)
  ].filter(Number.isFinite);
  const isForwardPress = exercise?.movementType === "forward_press" || exercise?.id === "seated_one_arm_forward_press";
  const rangeValues = reps.map((rep) => rep.range_of_motion).filter(Number.isFinite);
  const pushDepthValues = reps.map((rep) => rep.push_depth_cm).filter(Number.isFinite);
  const extensionAngleValues = reps.map((rep) => rep.max_extension_angle).filter(Number.isFinite);
  const shoulderDriftValues = reps.map((rep) => rep.shoulder_drift).filter(Number.isFinite);
  const linearityValues = reps.map((rep) => rep.sensor_linearity_score).filter(Number.isFinite);
  const holdValues = reps.map((rep) => rep.hold_time_sec).filter(Number.isFinite);
  const durationValues = reps.map((rep) => rep.rep_duration_sec).filter(Number.isFinite);
  const issueCounts = {
    short_push_depth: reps.filter((rep) => rep.issue === "short_push_depth").length,
    did_not_bend_enough: reps.filter((rep) => rep.issue === "did_not_bend_enough").length,
    did_not_hold_long_enough: reps.filter((rep) => (rep.hold_time_sec ?? 0) < (exercise?.holdSeconds ?? 1)).length,
    moved_too_fast: reps.filter((rep) => rep.pace === "too_fast").length,
    too_jittery: reps.filter((rep) => (rep.jitter_score ?? 0) > (exercise?.jitterThreshold ?? 0.35)).length,
    shoulder_compensation: reps.filter((rep) => (rep.shoulder_drift ?? 0) > (exercise?.shoulderDriftThreshold ?? 28)).length,
    low_confidence: packets.filter((packet) => packet?.coach_state === "low_confidence" || packet?.angle_valid === false).length
  };
  let issue = commonIssue(issueCounts);
  const zeroRepReason = reps.length ? null : inferZeroRepReason({ packets, exercise });
  if (!reps.length) issue = zeroRepReason;
  const endedAt = new Date();
  const startedAt = runner?.startedAt ? new Date(runner.startedAt) : endedAt;
  const durationSec = Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
  const sessionStartMs = packets[0]?.timestamp_ms ?? packets[0]?.timestampMs ?? startedAt.getTime();
  const sessionEndMs = packets.at(-1)?.timestamp_ms ?? packets.at(-1)?.timestampMs ?? endedAt.getTime();
  const jitterEvents = packets.filter((packet) => {
    if (!(packet?.jitter_grouped_event ?? packet?.jitter_event)) return false;
    const timestampMs = packet.timestamp_ms ?? packet.timestampMs;
    return !isInSessionEdgeTimestamp(timestampMs, sessionStartMs, sessionEndMs);
  });
  const totalJitterEvents = jitterEvents.length;
  const averageJitterScore = round(average(jitterValues) ?? 0, 2);
  const validFrameRatio = packets.length ? validPackets.length / packets.length : 0;
  const dataQuality = validFrameRatio >= 0.8 && averageJitterScore < 0.35
    ? "high"
    : validFrameRatio >= 0.55
      ? "medium"
      : "low";

  return {
    session_id: sessionId || runner?.sessionId || "local-webcam-session",
    user_id: "demo-user",
    exercise: exercise?.id || runner?.exercise?.id || "elbow_flexion_extension",
    exercise_name: exercise?.name || runner?.exercise?.name || "Elbow Flexion / Extension",
    side: exercise?.side || runner?.exercise?.side || "right",
    started_at_ms: startedAt.getTime(),
    ended_at_ms: endedAt.getTime(),
    duration_sec: durationSec,
    rep_goal: exercise?.repGoal || runner?.exercise?.repGoal || 8,
    total_reps: Math.max(reps.length, ...packets.map((packet) => packet?.rep_count || 0), 0),
    clean_reps: reps.filter((rep) => rep.clean).length,
    zero_rep_reason: zeroRepReason,
    best_angle: round(Math.max(...rangeValues, 0), 1),
    average_angle: round(average(rangeValues) ?? 0, 1),
    best_range_of_motion: round(Math.max(...rangeValues, 0), 1),
    average_range_of_motion: round(average(rangeValues) ?? 0, 1),
    best_push_depth_cm: round(Math.max(...pushDepthValues, 0), 1),
    average_push_depth_cm: round(average(pushDepthValues) ?? 0, 1),
    average_extension_angle: round(average(extensionAngleValues) ?? 0, 1),
    average_shoulder_drift: round(average(shoulderDriftValues) ?? 0, 1),
    average_sensor_linearity_score: round(average(linearityValues) ?? 0, 2),
    average_hold_time_sec: round(average(holdValues) ?? 0, 1),
    average_rep_duration_sec: round(average(durationValues) ?? 0, 1),
    average_physio_score: Math.round(average(scoreValues) ?? 0),
    max_jitter_score: round(Math.max(...jitterValues, 0), 2),
    average_jitter_score: averageJitterScore,
    total_jitter_events: totalJitterEvents,
    raw_average_elbow_angle: round(average(rawElbows), 1),
    smoothed_average_elbow_angle: round(average(smoothedElbows), 1),
    raw_average_shoulder_angle: round(average(rawShoulders), 1),
    smoothed_average_shoulder_angle: round(average(smoothedShoulders), 1),
    pain_level: painLevel,
    fatigue_level: fatigueLevel,
    common_issue: issue,
    issue_label: issue?.replaceAll("_", " ") || "none",
    issue_counts: issueCounts,
    tracking_quality: {
      data_quality: dataQuality,
      total_frames: packets.length,
      valid_frames: validPackets.length,
      invalid_frames: Math.max(0, packets.length - validPackets.length),
      valid_frame_ratio: round(validFrameRatio, 2),
      average_landmark_confidence: round(average(confidenceValues) ?? 0, 3),
      average_jitter_score: averageJitterScore,
      total_jitter_events: totalJitterEvents
    },
    movement_trace: buildLowFrameRateTrace(packets),
    trace_summary: {
      trace_sample_rate_hz: 4,
      trace_points: buildLowFrameRateTrace(packets).length,
      average_angle_residual: round(average(residualValues) ?? 0, 2),
      max_angle_residual: round(Math.max(...residualValues, 0), 1),
      average_velocity_residual_deg_per_sec: round(average(velocityResidualValues) ?? 0, 1),
      high_jitter_frame_count: jitterValues.filter((value) => value >= (exercise?.jitterThreshold ?? 0.35)).length,
      jitter_event_count: totalJitterEvents
    },
    completed_reps: reps,
    summary_text: reps.length
      ? (isForwardPress
        ? `User completed ${reps.length} ${reps.length === 1 ? "press" : "presses"} with ${round(Math.max(...pushDepthValues, 0), 1)} cm best push depth.`
        : `User completed ${reps.length} ${reps.length === 1 ? "rep" : "reps"} with ${round(Math.max(...rangeValues, 0), 1)} degrees best range of motion.`)
      : `No valid reps were completed. Reason: ${zeroRepReason?.replaceAll("_", " ")}.`,
    recommendation_text: recommendationForIssue(issue),
    warnings: [
      ...(packets.length ? [] : ["no_tracking_packets_recorded"]),
      ...(validFrameRatio < 0.55 ? ["low_tracking_quality"] : []),
      ...(reps.length ? [] : [zeroRepReason])
    ].filter(Boolean)
  };
}
