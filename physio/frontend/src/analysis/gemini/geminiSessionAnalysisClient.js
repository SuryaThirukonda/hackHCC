import { generateGeminiSessionAnalysisV2, generateTherapistSessionNote, normalizeLocalSessionAnalysisV2 } from "../../api/client.js";

const GEMINI_ANALYSIS_TIMEOUT_MS = 45000;
const GEMINI_TRACE_LIMIT = 16;

function trimMovementTrace(trace = [], limit = GEMINI_TRACE_LIMIT) {
  if (!trace.length) return [];
  if (trace.length <= limit) {
    return trace.map((point) => ({
      t_sec: point.t_sec,
      angle: point.smoothed_elbow_angle ?? point.raw_elbow_angle ?? null,
      phase: point.phase ?? null,
      rep_count: point.rep_count ?? 0
    }));
  }
  const step = Math.max(1, Math.ceil(trace.length / limit));
  return trace
    .filter((_, index) => index % step === 0)
    .slice(0, limit)
    .map((point) => ({
      t_sec: point.t_sec,
      angle: point.smoothed_elbow_angle ?? point.raw_elbow_angle ?? null,
      phase: point.phase ?? null,
      rep_count: point.rep_count ?? 0
    }));
}

export function trimPacketForGeminiApi(packet) {
  if (!packet) return packet;
  return {
    ...packet,
    movement_trace: trimMovementTrace(packet.movement_trace)
  };
}

export async function normalizeFinalSessionAnalysisPacket(packet) {
  return normalizeLocalSessionAnalysisV2(packet);
}

function buildSpokenSummary(localSummary, finalPacket) {
  const metrics = finalPacket?.aggregate_metrics || {};
  const reps = metrics.total_reps || 0;
  const repGoal = finalPacket?.goals?.rep_goal || 0;
  const isPress = finalPacket?.exercise_id === "seated_one_arm_forward_press";
  const recommendation = localSummary?.recommendation_text
    || finalPacket?.local_summary?.recommendation_text
    || "Keep the same controlled pace next session.";
  let metricPhrase = "";
  if (isPress && Number.isFinite(metrics.best_push_depth_cm)) {
    metricPhrase = ` Best push depth was ${metrics.best_push_depth_cm} cm.`;
  } else if (Number.isFinite(metrics.best_range_of_motion)) {
    metricPhrase = ` Best range was ${metrics.best_range_of_motion} degrees.`;
  }
  return `You completed ${reps} of ${repGoal} reps.${metricPhrase} ${recommendation}`.trim();
}

export function buildLocalGeminiFallbackResult(finalPacket, localSummary, errorMessage = "gemini_unavailable") {
  const summaryText = localSummary?.summary_text || finalPacket?.local_summary?.summary_text || "Session complete.";
  const recommendation = localSummary?.recommendation_text || finalPacket?.local_summary?.recommendation_text || "Keep the same controlled pace next session.";
  const metrics = finalPacket?.aggregate_metrics || {};
  const repGoal = finalPacket?.goals?.rep_goal || 0;
  const reps = metrics.total_reps || 0;
  const exerciseName = finalPacket?.exercise_name || "your exercise";
  const wentWell = repGoal && reps >= repGoal
    ? "You completed the planned goal with controlled reps."
    : "You completed structured practice data for review.";
  const spokenSummary = buildSpokenSummary(localSummary, finalPacket);

  return {
    ok: false,
    provider: "local",
    model: "local-fallback",
    fallback_used: true,
    error_message_sanitized: errorMessage,
    analysis: {
      spoken_summary: spokenSummary,
      written_summary: `You completed ${reps} of ${repGoal} target reps for ${exerciseName}. ${summaryText}`,
      what_went_well: wentWell,
      focus_next_time: recommendation,
      safety_note: "Stop if you feel pain and follow your therapist's plan.",
      bonus_rep_suggestion: "",
      return_suggestion: "Follow your therapist's plan for your next session."
    }
  };
}

function withTimeout(promise, timeoutMs, label = "gemini_timeout") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(label)), timeoutMs);
    })
  ]);
}

export async function generateGeminiSessionAnalysis(packet, localSummary = null) {
  const trimmedPacket = trimPacketForGeminiApi(packet);
  try {
    const result = await withTimeout(
      generateGeminiSessionAnalysisV2(trimmedPacket),
      GEMINI_ANALYSIS_TIMEOUT_MS
    );
    if (result?.fallback_used && result?.analysis?.spoken_summary) {
      return result;
    }
    if (result?.analysis && !result.analysis.spoken_summary) {
      result.analysis.spoken_summary = buildSpokenSummary(localSummary, packet);
    }
    return result;
  } catch (error) {
    return buildLocalGeminiFallbackResult(packet, localSummary, error?.message || "gemini_unavailable");
  }
}

export function buildLocalTherapistNoteFallback(sessionPacket, patientFeedback, geminiAnalysis = null) {
  const metrics = sessionPacket?.aggregate_metrics || {};
  const repGoal = sessionPacket?.goals?.rep_goal || 3;
  const reps = metrics.total_reps || 0;
  const issue = (sessionPacket?.issue_summary?.common_issue || "none").replaceAll("_", " ");
  const isPress = sessionPacket?.exercise_id === "seated_one_arm_forward_press";
  const sharpPain = patientFeedback?.sharp_pain || patientFeedback?.classification === "sharp_pain";
  return {
    ok: false,
    provider: "local",
    model: "local-fallback",
    fallback_used: true,
    note: {
      exercise: sessionPacket?.exercise_name || "Exercise session",
      completed: `${reps} of ${repGoal} reps`,
      movement_quality: isPress && metrics.best_push_depth_cm
        ? `Controlled overall; best push depth ${metrics.best_push_depth_cm} cm`
        : "Controlled overall",
      main_issue: issue === "none" ? "No major issue detected" : issue,
      sensor_tracking_quality: isPress ? "Sensor and camera tracking recorded" : `Camera tracking ${sessionPacket?.tracking_quality?.data_quality || "recorded"}`,
      patient_feedback: patientFeedback?.raw_text || patientFeedback?.classification?.replaceAll("_", " ") || "No feedback recorded",
      next_focus: geminiAnalysis?.focus_next_time || sessionPacket?.local_summary?.recommendation_text || "Keep movements slow and controlled.",
      safety_note: sharpPain
        ? "Patient reported sharp pain. Stop here and follow therapist guidance before continuing."
        : "Follow your therapist's plan and stop if sharp pain occurs."
    }
  };
}

export async function generateTherapistNote(sessionPacket, patientFeedback, geminiAnalysis = null) {
  try {
    return await withTimeout(
      generateTherapistSessionNote({
        session_packet: sessionPacket,
        patient_feedback: patientFeedback,
        gemini_analysis: geminiAnalysis || {}
      }),
      GEMINI_ANALYSIS_TIMEOUT_MS
    );
  } catch (error) {
    return buildLocalTherapistNoteFallback(sessionPacket, patientFeedback, geminiAnalysis?.analysis || geminiAnalysis);
  }
}
