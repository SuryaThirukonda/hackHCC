import React from "react";
import { ChevronRight } from "lucide-react";
import SessionSummary from "../SessionSummary.jsx";
import SessionReplayOverlay from "./SessionReplayOverlay.jsx";
import ElevenLabsSummaryPlayer from "./ElevenLabsSummaryPlayer.jsx";
import HeyGenSessionCoach from "./HeyGenSessionCoach.jsx";

// Fallback script when Gemini API is unavailable — jitter-aware based on MediaPipe session data.
// Used when MediaPipe detected significant jitter (total_jitter_events >= 4 or avg score >= 0.3)
const MOCK_HEYGEN_SCRIPT_JITTERY =
  "Good effort on completing your set today! I noticed some shakiness in your movement — that's " +
  "totally normal, especially if your muscles are fatigued or you're still building strength. " +
  "A few things that can really help: make sure you do a proper warm-up before your session, " +
  "focus on slow controlled movement rather than speed, and if the tremors feel uncomfortable " +
  "or unusual, have a chat with your physio — they'll want to know. Keep at it, you're making progress!";

// Used when movement was clean — low jitter detected
const MOCK_HEYGEN_SCRIPT_CLEAN =
  "Nice job on completing the set! Your elbow flexion stayed consistent throughout the session " +
  "and your movement quality really showed. The MediaPipe tracking picked up solid form across " +
  "your reps. Keep up this effort and you will see real progress in your recovery. See you at your next session!";

// Picks the right fallback based on MediaPipe jitter data from the session summary
function pickMockScript(summary) {
  const jitterEvents = summary?.total_jitter_events ?? 0;
  const avgJitter = summary?.average_jitter_score ?? 0;
  const hasSignificantJitter = jitterEvents >= 4 || avgJitter >= 0.3;
  return hasSignificantJitter ? MOCK_HEYGEN_SCRIPT_JITTERY : MOCK_HEYGEN_SCRIPT_CLEAN;
}

/**
 * Step 1 — left: local metrics + manual analysis; right: replay graph + AI summary/voice.
 * HeyGen coach video is shown below when the session ends.
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
  showFlowActions = true,
}) {
  const analysis = geminiResult?.analysis;
  const spoken = analysis?.spoken_summary || "";
  const samples = recording?.samples || [];
  const reps = recording?.reps || summary?.completed_reps || [];
  const loading = geminiStatus === "loading";

  // API result takes priority; fall back to jitter-aware hardcoded script if Gemini is unavailable.
  const heygenScript = spoken || pickMockScript(summary);

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
              <>
                {(geminiStatus === "error" || geminiStatus === "fallback") && (
                  <p className="muted-sub">Gemini unavailable — showing local session analysis.</p>
                )}
                <p className="muted-sub">{summary?.recommendation_text || "Summary will appear after analysis."}</p>
              </>
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

      {/* HeyGen avatar coach video — generates async from MediaPipe + Gemini analysis */}
      <div className="heygen-coach-section">
        <HeyGenSessionCoach
          spokenSummary={heygenScript}
          sessionId={sessionId}
          enableGeneratedVideo
        />
      </div>

      {showFlowActions && (
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
      )}
    </section>
  );
}
