export const DEMO_SESSION_ID = "demo-sample-session";

export function buildSampleSessionBundle() {
  const summary = {
    session_id: DEMO_SESSION_ID,
    user_id: "demo-user",
    exercise: "seated_one_arm_forward_press",
    exercise_name: "Seated One-Arm Forward Press",
    side: "right",
    started_at_ms: Date.now() - 95000,
    ended_at_ms: Date.now(),
    duration_sec: 95,
    rep_goal: 3,
    total_reps: 3,
    clean_reps: 2,
    best_push_depth_cm: 11.2,
    average_push_depth_cm: 9.8,
    average_extension_angle: 156,
    average_sensor_linearity_score: 0.82,
    average_physio_score: 78,
    average_hold_time_sec: 1.1,
    average_jitter_score: 0.24,
    best_range_of_motion: 91,
    average_range_of_motion: 86,
    common_issue: "moved_too_fast",
    issue_label: "moved too fast",
    recommendation_text: "Slow the return phase and keep the hold steady.",
    summary_text: "User completed 3 presses with 11.2 cm best push depth.",
    completed_reps: [
      { rep_index: 1, push_depth_cm: 10.5, hold_time_sec: 1.0, rep_duration_sec: 4.2, physio_score: 76, clean: true, issue: "none" },
      { rep_index: 2, push_depth_cm: 11.2, hold_time_sec: 1.2, rep_duration_sec: 3.9, physio_score: 82, clean: true, issue: "none" },
      { rep_index: 3, push_depth_cm: 9.6, hold_time_sec: 1.0, rep_duration_sec: 3.5, physio_score: 74, clean: false, issue: "moved_too_fast", pace: "too_fast" }
    ],
    tracking_quality: { data_quality: "high", valid_frame_ratio: 0.91 },
    is_demo: true
  };

  const finalAnalysisPacket = {
    schema_version: "session_analysis_v2",
    exercise_id: "seated_one_arm_forward_press",
    exercise_name: "Seated One-Arm Forward Press",
    session: {
      session_id: DEMO_SESSION_ID,
      user_id: "demo-user",
      side: "right",
      duration_sec: 95
    },
    goals: { rep_goal: 3, required_hold_sec: 1.2 },
    aggregate_metrics: {
      total_reps: 3,
      clean_reps: 2,
      average_physio_score: 78,
      best_push_depth_cm: 11.2,
      average_push_depth_cm: 9.8,
      average_extension_angle: 156,
      average_sensor_linearity_score: 0.82,
      average_hold_time_sec: 1.1,
      average_jitter_score: 0.24
    },
    tracking_quality: { data_quality: "high", valid_frame_ratio: 0.91 },
    issue_summary: { common_issue: "moved_too_fast", zero_rep_reason: null },
    rep_breakdown: summary.completed_reps,
    sensor_quality: {
      sensor_status: "ok",
      calibration_complete: true,
      calibration_quality: "ok",
      average_sensor_linearity_score: 0.82,
      sensor_available_ratio: 0.94
    },
    local_summary: {
      summary_text: summary.summary_text,
      recommendation_text: summary.recommendation_text
    }
  };

  const geminiSessionAnalysis = {
    ok: true,
    provider: "demo",
    model: "demo-sample",
    fallback_used: true,
    analysis: {
      spoken_summary: "You completed 3 of 3 forward presses with 11.2 centimeters best push depth. The return phase was a little fast on the last rep. Keep the same controlled pace next session.",
      written_summary: "You completed all 3 planned forward presses. Push depth reached 11.2 cm with good sensor tracking. Hold times were consistent around 1.1 seconds. The last rep returned slightly fast — focus on a slower, steadier return next time.",
      what_went_well: "Strong push depth and stable sensor readings across the session.",
      focus_next_time: "Slow the return phase and keep your arm level through the full rep.",
      safety_note: "Stop if you feel sharp pain and follow your therapist's plan.",
      bonus_rep_suggestion: "If it feels comfortable, try one extra controlled rep next time.",
      return_suggestion: "Follow your therapist's plan. Based on today's session, return for another short practice session when scheduled."
    }
  };

  const sessionRecording = {
    session_id: DEMO_SESSION_ID,
    samples: [
      { timestamp_ms: 0, smoothed_elbow_angle: 92, push_depth_cm: 0, rep_count: 0 },
      { timestamp_ms: 1200, smoothed_elbow_angle: 118, push_depth_cm: 2.1, rep_count: 0 },
      { timestamp_ms: 2400, smoothed_elbow_angle: 154, push_depth_cm: 10.5, rep_count: 1 },
      { timestamp_ms: 4800, smoothed_elbow_angle: 96, push_depth_cm: 1.2, rep_count: 1 },
      { timestamp_ms: 7200, smoothed_elbow_angle: 158, push_depth_cm: 11.2, rep_count: 2 },
      { timestamp_ms: 9000, smoothed_elbow_angle: 94, push_depth_cm: 0.8, rep_count: 3 }
    ],
    reps: summary.completed_reps
  };

  const therapistNote = {
    exercise: "Seated One-Arm Forward Press",
    completed: "3 of 3 reps",
    movement_quality: "Controlled overall, with mild jitter during the return phase",
    main_issue: "Return phase was slightly fast",
    sensor_tracking_quality: "Sensor connected, camera tracking stable",
    patient_feedback: "Reported mild fatigue, no sharp pain",
    next_focus: "Slower return phase and steadier hold",
    safety_note: "Follow your therapist's plan and stop if sharp pain occurs"
  };

  return {
    summary,
    finalAnalysisPacket,
    geminiSessionAnalysis,
    sessionRecording,
    therapistNote,
    isDemo: true
  };
}
