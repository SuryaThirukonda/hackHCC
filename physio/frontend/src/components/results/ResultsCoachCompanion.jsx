import React, { useCallback, useMemo, useState } from "react";
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
  heygenConfigured = false,
}) {
  const [audioUrl, setAudioUrl] = useState(null);
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [speechProgress, setSpeechProgress] = useState(0);

  const spoken = geminiAnalysis?.spoken_summary || "";
  const written = geminiAnalysis?.written_summary || "";
  const displayText = spoken || written;
  const coachText = useMemo(() => {
    if (voiceStatus !== "playing" || !displayText) return displayText;
    return revealTextByProgress(displayText, speechProgress);
  }, [displayText, speechProgress, voiceStatus]);
  const hasContent = Boolean(displayText);

  const handlePlaybackStart = useCallback(() => {
    setSpeechProgress(0);
  }, []);

  const handlePlaybackProgress = useCallback((progress) => {
    setSpeechProgress(progress);
  }, []);

  const handlePlaybackEnd = useCallback(() => {
    setSpeechProgress(1);
  }, []);

  return (
    <div className="coach-companion">
      <HeyGenSessionCoach
        spokenSummary={spoken}
        audioUrl={audioUrl}
        sessionId={sessionId}
        embedHtml={embedHtml}
        enableGeneratedVideo={heygenConfigured}
      />

      {hasContent && (
        <div className={`speech-bubble ${voiceStatus === "playing" ? "speech-bubble--speaking" : ""}`}>
          <p>{coachText}</p>
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
          autoPlay
          onAudioUrl={setAudioUrl}
          onStatusChange={setVoiceStatus}
          onPlaybackStart={handlePlaybackStart}
          onPlaybackProgress={handlePlaybackProgress}
          onPlaybackEnd={handlePlaybackEnd}
        />
      )}
    </div>
  );
}

function revealTextByProgress(text, progress) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const visibleWords = Math.max(1, Math.ceil(words.length * clamped));
  return words.slice(0, visibleWords).join(" ");
}
