import React, { useCallback, useEffect, useState } from "react";
import ElevenLabsSummaryPlayer from "./ElevenLabsSummaryPlayer.jsx";

/**
 * Results coach panel — Gemini text + ElevenLabs voice.
 * The blob avatar lives in the global floating companion.
 */
export default function ResultsCoachCompanion({
  geminiAnalysis,
  sessionId,
  geminiStatus,
  onVoiceStatusChange,
}) {
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [speechProgress, setSpeechProgress] = useState(0);

  const spoken = geminiAnalysis?.spoken_summary || "";
  const written = geminiAnalysis?.written_summary || "";
  const displayText = written || spoken;

  const handleVoiceStatus = useCallback((nextStatus) => {
    setVoiceStatus(nextStatus);
    onVoiceStatusChange?.(nextStatus);
  }, [onVoiceStatusChange]);

  useEffect(() => {
    if (!spoken && geminiStatus !== "loading") {
      handleVoiceStatus("idle");
    }
  }, [spoken, geminiStatus, handleVoiceStatus]);

  const handlePlaybackStart = useCallback(() => setSpeechProgress(0), []);
  const handlePlaybackProgress = useCallback((progress) => setSpeechProgress(progress), []);
  const handlePlaybackEnd = useCallback(() => setSpeechProgress(1), []);

  const coachText = voiceStatus === "playing" && displayText
    ? revealTextByProgress(displayText, speechProgress)
    : displayText;

  const statusLabel = {
    idle: null,
    loading: "Preparing voice…",
    playing: "Speaking",
    ready: "Voice ready",
    blocked: "Tap play to hear summary",
    error: "Voice unavailable",
  }[voiceStatus];

  return (
    <div className="coach-blob-panel coach-blob-panel--text-only">
      <div className="coach-blob-header">
        <span className="coach-section-label">Session summary</span>
        {statusLabel && spoken && (
          <span className={`coach-blob-status coach-blob-status--${voiceStatus}`}>
            {voiceStatus === "playing" && <span className="voice-dot" />}
            {statusLabel}
          </span>
        )}
        {geminiStatus === "loading" && !displayText && (
          <span className="coach-blob-status coach-blob-status--thinking">
            <span className="spinner-xs" /> Analyzing session…
          </span>
        )}
      </div>

      <div className="coach-blob-body coach-blob-body--text-only">
        <div
          className={`coach-blob-speech${
            voiceStatus === "playing" ? " coach-blob-speech--speaking" : ""
          }${!displayText ? " coach-blob-speech--empty" : ""}`}
        >
          {displayText ? (
            <p>
              {coachText}
              {voiceStatus === "playing" && speechProgress < 0.99 ? " ▌" : ""}
            </p>
          ) : geminiStatus === "loading" ? (
            <p className="muted">
              <span className="spinner-xs" /> Preparing your AI summary…
            </p>
          ) : (
            <p className="muted">Your workout summary will appear here after analysis.</p>
          )}
        </div>
      </div>

      {spoken && (
        <ElevenLabsSummaryPlayer
          spokenSummary={spoken}
          sessionId={sessionId}
          autoPlay
          onStatusChange={handleVoiceStatus}
          onPlaybackStart={handlePlaybackStart}
          onPlaybackProgress={handlePlaybackProgress}
          onPlaybackEnd={handlePlaybackEnd}
          compact
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
