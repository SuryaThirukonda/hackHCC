import React from "react";
import { ChevronRight } from "lucide-react";
import SessionSummary from "../SessionSummary.jsx";
import SessionReplayOverlay from "./SessionReplayOverlay.jsx";
import ElevenLabsSummaryPlayer from "./ElevenLabsSummaryPlayer.jsx";

/**
 * Step 1 — left: local metrics + manual analysis; right: replay graph + AI summary/voice.
 */
export default function SessionSummaryStep({
  summary,
  geminiResult,
  geminiStatus,
  geminiError,
  sessionId,
  recording,
  onVoiceStatusChange,
  onNext,
  voiceFinished,
}) {
  const analysis = geminiResult?.analysis;
  const spoken = analysis?.spoken_summary || "";
  const samples = recording?.samples || [];
  const reps = recording?.reps || summary?.completed_reps || [];
  const loading = geminiStatus === "loading";

  return (
    <section className="session-summary-step">
      <div className="summary-step-layout">
        <aside className="summary-step-left">
          <SessionSummary
            summary={summary}
            showAiSummary={false}
            localAnalysisOnly
          />
        </aside>

        <div className="summary-step-right">
          <div className="summary-step-replay">
            <SessionReplayOverlay samples={samples} reps={reps} />
          </div>

          <div className="summary-step-ai">
            <p className="eyebrow">AI assistant summary</p>
            <h3>Your session review</h3>

            {loading && !analysis && (
              <p className="muted-sub"><span className="spinner-xs" /> Analyzing your session…</p>
            )}

            {analysis && (
              <div className="ai-summary-compact">
                <p>{analysis.written_summary}</p>
                {analysis.what_went_well && (
                  <div className="ai-highlight">
                    <span className="eyebrow">What went well</span>
                    <p>{analysis.what_went_well}</p>
                  </div>
                )}
                {analysis.focus_next_time && (
                  <div className="ai-highlight">
                    <span className="eyebrow">Focus next time</span>
                    <p>{analysis.focus_next_time}</p>
                  </div>
                )}
                {analysis.safety_note && (
                  <p className="safety-disclaimer-inline">{analysis.safety_note}</p>
                )}
              </div>
            )}

            {!analysis && !loading && (
              <p className="muted-sub">{summary?.recommendation_text || "Summary will appear after analysis."}</p>
            )}

            {geminiError && <p className="coach-error">{geminiError}</p>}

            {spoken && (
              <div className="summary-step-voice">
                <p className="eyebrow">Listen to your summary</p>
                <ElevenLabsSummaryPlayer
                  spokenSummary={spoken}
                  sessionId={sessionId}
                  autoPlay
                  onStatusChange={onVoiceStatusChange}
                  compact
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="results-flow-actions">
        <button
          type="button"
          className="primary-btn"
          onClick={onNext}
          disabled={loading}
        >
          Next — Check in with your coach
          <ChevronRight size={16} />
        </button>
        {!voiceFinished && spoken && (
          <span className="muted-sub">You can continue while the summary plays.</span>
        )}
      </div>
    </section>
  );
}
