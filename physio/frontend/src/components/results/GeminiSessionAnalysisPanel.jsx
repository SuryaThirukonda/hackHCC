import React from "react";

const STATUS_LABEL = {
  idle: "Waiting…",
  loading: "Analyzing session…",
  ready: "Analysis ready",
  fallback: "Local analysis",
  error: "Analysis unavailable",
};

export default function GeminiSessionAnalysisPanel({ geminiResult, status = "idle", localRecommendation }) {
  const analysis = geminiResult?.analysis;
  const isFallback = geminiResult?.fallback_used;

  return (
    <div className="gemini-analysis-panel">
      <div className="panel-header">
        <span className="panel-title">Session Analysis</span>
        <span className={`status-badge status-${status}`}>
          {STATUS_LABEL[status] || status}
          {isFallback && status === "ready" && (
            <span className="fallback-note"> (local)</span>
          )}
        </span>
      </div>

      {(status === "idle" || status === "loading") && (
        <div className="analysis-placeholder">
          {status === "loading" ? (
            <div className="loading-row">
              <span className="spinner" />
              <span>Generating personalized summary…</span>
            </div>
          ) : (
            <span className="muted">Analysis will appear after your session.</span>
          )}
        </div>
      )}

      {(status === "ready" || status === "fallback") && analysis && (
        <div className="analysis-body">
          {analysis.written_summary && (
            <p className="written-summary">{analysis.written_summary}</p>
          )}

          <div className="analysis-cards">
            {analysis.what_went_well && (
              <div className="analysis-card card-good">
                <span className="card-label">What went well</span>
                <p>{analysis.what_went_well}</p>
              </div>
            )}
            {analysis.focus_next_time && (
              <div className="analysis-card card-focus">
                <span className="card-label">Focus next time</span>
                <p>{analysis.focus_next_time}</p>
              </div>
            )}
          </div>

          {analysis.safety_note && (
            <p className="safety-note">{analysis.safety_note}</p>
          )}

          {analysis.bonus_rep_suggestion && (
            <div className="analysis-card card-bonus">
              <span className="card-label">Optional challenge</span>
              <p>{analysis.bonus_rep_suggestion}</p>
            </div>
          )}

          {analysis.return_suggestion && (
            <p className="return-suggestion muted">{analysis.return_suggestion}</p>
          )}
        </div>
      )}

      {status === "error" && (
        <div className="analysis-body">
          <p className="muted">{localRecommendation || "Session complete. Keep the same controlled pace next time."}</p>
        </div>
      )}
    </div>
  );
}
