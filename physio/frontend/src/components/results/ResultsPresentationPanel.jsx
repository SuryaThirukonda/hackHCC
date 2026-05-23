import React from "react";
import GeminiSessionAnalysisPanel from "./GeminiSessionAnalysisPanel.jsx";
import ResultsCoachCompanion from "./ResultsCoachCompanion.jsx";
import SessionReplayOverlay from "./SessionReplayOverlay.jsx";

/**
 * ResultsPresentationPanel
 *
 * Layout:
 *   Top row: [ Blob coach + Gemini text + voice ] | [ Movement replay ]
 *   Bottom:  Gemini structured analysis + metrics
 */
export default function ResultsPresentationPanel({
  geminiResult,
  geminiStatus,
  sessionId,
  summary,
  recording,
  finalAnalysisPacket,
  geminiCache,
  geminiError,
  onVoiceStatusChange,
  exerciseId,
}) {
  const analysis = geminiResult?.analysis;
  const samples = recording?.samples || [];
  const reps = recording?.reps || summary?.completed_reps || [];
  const localRecommendation = summary?.recommendation_text || summary?.local_recommendation || "";
  const resolvedExerciseId = exerciseId || summary?.exercise || finalAnalysisPacket?.exercise_id;
  const isForwardPress = resolvedExerciseId === "seated_one_arm_forward_press";

  const metrics = isForwardPress
    ? [
        { label: "Reps", value: `${summary?.total_reps ?? summary?.completed_reps?.length ?? 0} / ${summary?.rep_goal || 3}` },
        { label: "Best Press", value: summary?.best_push_depth_cm != null ? `${summary.best_push_depth_cm} cm` : "—" },
        { label: "Sensor Quality", value: summary?.average_sensor_linearity_score != null ? summary.average_sensor_linearity_score.toFixed(2) : "—" },
        { label: "Extension", value: summary?.average_extension_angle != null ? `${summary.average_extension_angle}°` : "—" },
        { label: "Avg Score", value: summary?.average_physio_score != null ? summary.average_physio_score : "—" },
      ]
    : [
        { label: "Reps", value: `${summary?.total_reps ?? summary?.completed_reps ?? 0} / ${summary?.rep_goal || 3}` },
        { label: "Best ROM", value: summary?.best_range_of_motion != null ? `${summary.best_range_of_motion}°` : (summary?.best_angle != null ? `${summary.best_angle}°` : "—") },
        { label: "Avg Score", value: summary?.average_physio_score != null ? summary.average_physio_score : "—" },
        { label: "Avg Hold", value: summary?.average_hold_time_sec != null ? `${summary.average_hold_time_sec}s` : "—" },
        { label: "Jitter", value: summary?.average_jitter_score != null ? summary.average_jitter_score.toFixed(2) : "—" },
      ];

  return (
    <div className="results-presentation-panel">
      <div className="results-top-row">
        <div className="results-left">
          <ResultsCoachCompanion
            geminiAnalysis={analysis}
            sessionId={sessionId}
            geminiStatus={geminiStatus}
            onVoiceStatusChange={onVoiceStatusChange}
          />
        </div>

        <div className="results-right">
          <SessionReplayOverlay samples={samples} reps={reps} />
        </div>
      </div>

      <div className="results-bottom-row">
        <GeminiSessionAnalysisPanel
          packet={finalAnalysisPacket || geminiCache?.packet}
          geminiResult={geminiResult}
          status={geminiStatus}
          localRecommendation={localRecommendation}
          cachedResult={geminiCache}
          error={geminiError}
        />

        {summary && (
          <div className="metrics-strip">
            {metrics.map(({ label, value }) => (
              <div key={label} className="metric-chip">
                <span className="metric-label">{label}</span>
                <span className="metric-value">{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
