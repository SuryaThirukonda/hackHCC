import React, { useState } from "react";
import ElevenLabsSummaryPlayer from "./ElevenLabsSummaryPlayer.jsx";
import HeyGenSessionCoach from "./HeyGenSessionCoach.jsx";

/**
 * ResultsCoachCompanion
 *
 * Left column of the results panel:
 *   - HeyGen coach (LiveAvatar embed or video)
 *   - Speech bubble with Gemini summary text
 *   - ElevenLabs audio player
 */
export default function ResultsCoachCompanion({
  geminiAnalysis,
  sessionId,
  embedHtml,
  geminiStatus,
}) {
  const [audioUrl, setAudioUrl] = useState(null);

  const spoken = geminiAnalysis?.spoken_summary || "";
  const written = geminiAnalysis?.written_summary || "";
  const displayText = written || spoken;
  const hasContent = Boolean(displayText);

  return (
    <div className="coach-companion">
      <HeyGenSessionCoach
        spokenSummary={spoken}
        audioUrl={audioUrl}
        sessionId={sessionId}
        embedHtml={embedHtml}
      />

      {hasContent && (
        <div className="speech-bubble">
          <p>{displayText}</p>
        </div>
      )}

      {!hasContent && geminiStatus === "loading" && (
        <div className="speech-bubble speech-bubble--loading">
          <span className="spinner" />
          <span className="muted"> Preparing your summary…</span>
        </div>
      )}

      {!hasContent && geminiStatus === "idle" && (
        <div className="speech-bubble speech-bubble--idle">
          <span className="muted">Your analysis will appear here after your session.</span>
        </div>
      )}

      {spoken && (
        <ElevenLabsSummaryPlayer
          spokenSummary={spoken}
          sessionId={sessionId}
          autoPlay={false}
          onAudioUrl={setAudioUrl}
        />
      )}
    </div>
  );
}
