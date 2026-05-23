import { generateGeminiSessionAnalysisV2, normalizeLocalSessionAnalysisV2 } from "../../api/client.js";

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
  const bestRom = metrics.best_range_of_motion;
  const recommendation = localSummary?.recommendation_text
    || finalPacket?.local_summary?.recommendation_text
    || "Keep the same controlled pace next session.";
  const romPhrase = Number.isFinite(bestRom) ? ` Best range was ${bestRom} degrees.` : "";
  return `You completed ${reps} of ${repGoal} reps.${romPhrase} ${recommendation}`.trim();
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
