import React from "react";
import GeminiSessionAnalysisPanel from "./GeminiSessionAnalysisPanel.jsx";
import ResultsCoachCompanion from "./ResultsCoachCompanion.jsx";
import SessionReplayOverlay from "./SessionReplayOverlay.jsx";

/**
 * ResultsPresentationPanel
 *
 * Layout:
 *   Top row: [ Coach companion / HeyGen / speech bubble ] | [ Movement replay ]
 *   Bottom:  Gemini structured analysis + metrics
 */
export default function ResultsPresentationPanel({
  // Gemini
  geminiResult,
  geminiStatus,
  // Session info
  sessionId,
  summary,
  // Recording data
  recording,
  presentationStatus,
  // Presentation config
  embedHtml,
  finalAnalysisPacket,
  geminiCache,
}) {
  const analysis = geminiResult?.analysis;
  const samples = recording?.samples || [];
  const reps = recording?.reps || summary?.completed_reps || [];
  const localRecommendation = summary?.recommendation_text || summary?.local_recommendation || "";

  return (
    <div className="results-presentation-panel">
      <div className="results-top-row">
        {/* Left: Coach companion + voice */}
        <div className="results-left">
          <ResultsCoachCompanion
            geminiAnalysis={analysis}
            sessionId={sessionId}
            embedHtml={embedHtml}
            geminiStatus={geminiStatus}
            heygenConfigured={Boolean(presentationStatus?.heygen_configured)}
          />
        </div>

        {/* Right: Replay overlay */}
        <div className="results-right">
          <SessionReplayOverlay samples={samples} reps={reps} />
        </div>
      </div>

      {/* Structured analysis */}
      <div className="results-bottom-row">
        <GeminiSessionAnalysisPanel
          packet={finalAnalysisPacket || geminiCache?.packet}
          geminiResult={geminiResult}
          status={geminiStatus}
          localRecommendation={localRecommendation}
          cachedResult={geminiCache}
        />

        {/* Quick metrics strip */}
        {summary && (
          <div className="metrics-strip">
            {[
              { label: "Reps", value: `${summary.total_reps ?? summary.completed_reps ?? 0} / ${summary.rep_goal || 3}` },
              { label: "Best ROM", value: summary.best_range_of_motion != null ? `${summary.best_range_of_motion}°` : (summary.best_angle != null ? `${summary.best_angle}°` : "—") },
              { label: "Avg Score", value: summary.average_physio_score != null ? summary.average_physio_score : "—" },
              { label: "Avg Hold", value: summary.average_hold_time_sec != null ? `${summary.average_hold_time_sec}s` : "—" },
              { label: "Jitter", value: summary.average_jitter_score != null ? summary.average_jitter_score.toFixed(2) : "—" },
            ].map(({ label, value }) => (
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
