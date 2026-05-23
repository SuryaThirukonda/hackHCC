/**
 * buildFinalSessionAnalysisPacket
 *
 * Takes the output of summarizeRunnerSession() (+ runner state) and produces
 * the FinalSessionAnalysisPacket shape used by the backend V2 analysis routes
 * and by Gemini for post-session analysis.
 *
 * Nothing here calls Gemini. It is purely deterministic local logic.
 */

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function round1(v) {
  return v == null || !Number.isFinite(v) ? 0 : Math.round(v * 10) / 10;
}

function round2(v) {
  return v == null || !Number.isFinite(v) ? 0 : Math.round(v * 100) / 100;
}

function confidenceLabelFromRatio(ratio) {
  if (ratio >= 0.85) return "high";
  if (ratio >= 0.55) return "medium";
  return "low";
}

function jitterLevel(avgJitter) {
  if (avgJitter < 0.15) return "low";
  if (avgJitter < 0.35) return "medium";
  return "high";
}

function buildTrackingQuality(packets) {
  if (!packets.length) {
    return {
      valid_frame_ratio: 0,
      average_landmark_confidence: 0,
      dropped_frame_count: 0,
      jitter_level: "low",
      confidence_label: "low",
    };
  }
  const validCount = packets.filter(
    (p) => p?.angle_valid !== false && p?.coach_state !== "low_confidence"
  ).length;
  const ratio = round2(validCount / packets.length);
  const confidences = packets
    .map((p) => p?.landmark_confidence)
    .filter((v) => Number.isFinite(v));
  const avgConf = round2(avg(confidences));
  const jitters = packets
    .map((p) => p?.combined_jitter_score ?? p?.jitter_score)
    .filter((v) => Number.isFinite(v));
  const avgJitter = avg(jitters);
  const dropped = packets.length - validCount;

  return {
    valid_frame_ratio: ratio,
    average_landmark_confidence: avgConf,
    dropped_frame_count: dropped,
    jitter_level: jitterLevel(avgJitter),
    confidence_label: confidenceLabelFromRatio(ratio),
  };
}

function buildRepBreakdown(completedReps) {
  return completedReps.map((rep) => {
    const issue = rep.issue || "none";
    const issueLabel = {
      did_not_bend_enough: "incomplete_flexion",
      did_not_hold_long_enough: "short_hold",
      moved_too_fast: "too_fast",
      too_jittery: "too_jittery",
      shoulder_compensation: "shoulder_compensation",
      low_confidence: "low_confidence",
      none: "none",
    }[issue] || issue;

    return {
      rep_number: rep.rep_index,
      completed: true,
      clean: rep.clean ?? false,
      start_timestamp: rep.started_at_ms ?? null,
      end_timestamp: rep.ended_at_ms ?? null,
      duration_sec: round1(rep.rep_duration_sec),
      min_elbow_angle: round1(rep.min_elbow_angle ?? null),
      max_elbow_angle: round1(rep.max_elbow_angle ?? null),
      range_of_motion: round1(rep.range_of_motion),
      hold_time_sec: round1(rep.hold_time_sec),
      jitter_score: round2(rep.jitter_score),
      shoulder_drift: round1(rep.shoulder_drift),
      physio_score: rep.physio_score ?? null,
      issue_label: issueLabel,
      confidence_label: "medium",
      notes: issue !== "none" ? `Issue: ${issueLabel}` : null,
    };
  });
}

function buildAggregateMetrics(completedReps) {
  if (!completedReps.length) {
    return {
      best_range_of_motion: 0,
      average_range_of_motion: 0,
      average_hold_time_sec: 0,
      average_rep_duration_sec: 0,
      average_jitter_score: 0,
      average_shoulder_drift: 0,
      average_physio_score: 0,
      best_rep_number: null,
      weakest_rep_number: null,
    };
  }

  const roms = completedReps.map((r) => r.range_of_motion).filter(Number.isFinite);
  const holds = completedReps.map((r) => r.hold_time_sec).filter(Number.isFinite);
  const durations = completedReps.map((r) => r.rep_duration_sec).filter(Number.isFinite);
  const jitters = completedReps.map((r) => r.jitter_score).filter(Number.isFinite);
  const drifts = completedReps.map((r) => r.shoulder_drift).filter(Number.isFinite);
  const scores = completedReps.map((r) => r.physio_score).filter(Number.isFinite);

  const bestRepIdx = scores.length
    ? scores.indexOf(Math.max(...scores))
    : null;
  const weakestRepIdx = scores.length
    ? scores.indexOf(Math.min(...scores))
    : null;

  return {
    best_range_of_motion: round1(roms.length ? Math.max(...roms) : 0),
    average_range_of_motion: round1(avg(roms)),
    average_hold_time_sec: round1(avg(holds)),
    average_rep_duration_sec: round1(avg(durations)),
    average_jitter_score: round2(avg(jitters)),
    average_shoulder_drift: round1(avg(drifts)),
    average_physio_score: Math.round(avg(scores)),
    best_rep_number: bestRepIdx != null ? completedReps[bestRepIdx]?.rep_index ?? null : null,
    weakest_rep_number: weakestRepIdx != null ? completedReps[weakestRepIdx]?.rep_index ?? null : null,
  };
}

function buildIssueSummary(completedReps, packets, exercise) {
  const jitterThreshold = exercise?.jitterThreshold ?? 0.35;
  const holdSeconds = exercise?.holdSeconds ?? 1;
  const shoulderDriftThreshold = exercise?.shoulderDriftThreshold ?? 28;

  const tooFast = completedReps.filter((r) => r.pace === "too_fast").length;
  const tooJittery = completedReps.filter((r) => (r.jitter_score ?? 0) > jitterThreshold).length;
  const shortHold = completedReps.filter((r) => (r.hold_time_sec ?? 0) < holdSeconds).length;
  const incompleteExt = completedReps.filter((r) => r.issue === "did_not_bend_enough").length;
  const trackingLost = packets.filter(
    (p) => p?.coach_state === "low_confidence" || p?.angle_valid === false
  ).length;
  const shoulderComp = completedReps.filter(
    (r) => (r.shoulder_drift ?? 0) > shoulderDriftThreshold
  ).length;

  const counts = {
    too_fast: tooFast,
    too_jittery: tooJittery,
    short_hold: shortHold,
    incomplete_extension: incompleteExt,
    shoulder_compensation: shoulderComp,
  };
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const commonIssue = sorted[0] && sorted[0][1] > 0 ? sorted[0][0] : "none";

  return {
    common_issue: commonIssue,
    too_fast_count: tooFast,
    too_jittery_count: tooJittery,
    short_hold_count: shortHold,
    incomplete_extension_count: incompleteExt,
    tracking_lost_count: trackingLost,
    shoulder_compensation_count: shoulderComp,
  };
}

function buildLocalRecommendation(completedReps, repGoal, issueSummary) {
  const n = completedReps.length;
  const goal = repGoal || 3;

  if (n === 0) {
    return "No reps were recorded. Make sure your full arm is visible and start with your arm mostly straight.";
  }

  const issue = issueSummary.common_issue;
  const focusMap = {
    too_fast: "Slow down each rep and control the return phase.",
    too_jittery: "Use a steady, deliberate pace and avoid sudden angle changes.",
    short_hold: "Pause briefly at the bent position before extending your arm.",
    incomplete_extension: "Focus on bending deeper into the target zone each rep.",
    shoulder_compensation: "Keep your upper arm still — only bend at the elbow.",
    none: "Keep the same controlled pace next session.",
  };
  const focus = focusMap[issue] || focusMap.none;

  const roms = completedReps.map((r) => r.range_of_motion).filter(Number.isFinite);
  const bestRom = roms.length ? Math.max(...roms) : 0;
  const bestRepIndex = roms.length ? roms.indexOf(bestRom) + 1 : null;

  let text = `You completed ${n} out of ${goal} rep${goal !== 1 ? "s" : ""}.`;
  if (bestRepIndex && bestRom > 0) {
    text += ` Your range of motion was strongest on rep ${bestRepIndex} at ${bestRom.toFixed(0)} degrees.`;
  }
  text += ` ${focus}`;

  return text;
}

function zeroRepReason(packets, exercise) {
  if (!packets.length) return "session_too_short";

  const lowConf = packets.filter(
    (p) => p?.coach_state === "low_confidence" || p?.angle_valid === false
  );
  if (lowConf.length / Math.max(packets.length, 1) > 0.6) return "tracking_lost";

  const minFlexion = exercise?.targetPosition?.elbowAngleMax ?? 100;
  const lowestAngle = Math.min(...packets.map((p) => p?.elbow_angle ?? 180).filter(Number.isFinite));
  if (lowestAngle > minFlexion) return "target_flexion_not_reached";

  return "no_valid_reps_completed";
}

/**
 * @param {object} runnerSummary - output of summarizeRunnerSession()
 * @param {object} runnerState - the full runner state (has activePackets, completedReps)
 * @param {object} exercise - selected exercise config
 * @returns {FinalSessionAnalysisPacket} - ready to send to backend V2 route
 */
export function buildFinalSessionAnalysisPacket(runnerSummary, runnerState, exercise) {
  const packets = runnerState?.activePackets || [];
  const completedReps = runnerSummary?.completed_reps || runnerState?.completedReps || [];
  const uniqueReps = Array.from(
    new Map(completedReps.map((r) => [r.rep_index, r])).values()
  );

  const repBreakdown = buildRepBreakdown(uniqueReps);
  const aggregateMetrics = buildAggregateMetrics(uniqueReps);
  const issueSummary = buildIssueSummary(uniqueReps, packets, exercise);
  const trackingQuality = buildTrackingQuality(packets);

  const repGoal = exercise?.repGoal ?? runnerSummary?.rep_goal ?? 3;
  const localRecommendation = buildLocalRecommendation(uniqueReps, repGoal, issueSummary);

  const localSummary = uniqueReps.length === 0
    ? `No completed reps. Reason: ${zeroRepReason(packets, exercise)}`
    : `Completed ${uniqueReps.length}/${repGoal} reps. ${
        uniqueReps.filter((r) => r.clean).length
      } clean. Average physio score: ${aggregateMetrics.average_physio_score}.`;

  return {
    session_id: runnerSummary?.session_id || "unknown",
    exercise_id: exercise?.id || runnerSummary?.exercise || "elbow_flexion_extension",
    exercise_name: exercise?.name || "Elbow Flexion / Extension",
    timestamp_start: runnerSummary?.started_at_ms || Date.now(),
    timestamp_end: runnerSummary?.ended_at_ms || Date.now(),
    duration_sec: runnerSummary?.duration_sec || 0,
    rep_goal: repGoal,
    completed_reps: uniqueReps.length,
    clean_reps: uniqueReps.filter((r) => r.clean).length,
    bonus_rep_attempted: false,
    bonus_rep_completed: false,
    tracking_quality: trackingQuality,
    local_summary: localSummary,
    aggregate_metrics: aggregateMetrics,
    rep_breakdown: repBreakdown,
    issue_summary: issueSummary,
    confidence_notes: `Tracking quality: ${trackingQuality.confidence_label}. Valid frame ratio: ${(trackingQuality.valid_frame_ratio * 100).toFixed(0)}%.`,
    local_recommendation: localRecommendation,
  };
}
