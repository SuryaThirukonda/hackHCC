import React, { useCallback, useEffect, useRef, useState } from "react";
import { requestElevenLabsSummary } from "../../api/sessionRecordingV2Client.js";

const STATUS_LABEL = {
  idle: "Not started",
  loading: "Generating audio…",
  playing: "Playing",
  ready: "Ready",
  error: "Audio unavailable",
  blocked: "Click play to enable audio",
};

/**
 * ElevenLabsSummaryPlayer
 * Receives Gemini spoken_summary text and plays it via ElevenLabs.
 */
export default function ElevenLabsSummaryPlayer({
  spokenSummary,
  sessionId,
  autoPlay = false,
  onAudioUrl,
}) {
  const [status, setStatus] = useState("idle");
  const [audioUrl, setAudioUrl] = useState(null);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const audioRef = useRef(null);
  const fetchedRef = useRef(false);

  const synthesize = useCallback(async () => {
    if (!spokenSummary) return;
    setStatus("loading");
    setError("");
    try {
      const result = await requestElevenLabsSummary(spokenSummary, sessionId);
      if (result.ok && result.audio_url) {
        setAudioUrl(result.audio_url);
        setStatus("ready");
        onAudioUrl?.(result.audio_url);
      } else {
        setStatus("error");
        setError(result.error_message_sanitized || "TTS unavailable");
      }
    } catch (err) {
      setStatus("error");
      setError(err.message);
    }
  }, [spokenSummary, sessionId, onAudioUrl]);

  // Auto-fetch when summary text arrives
  useEffect(() => {
    if (spokenSummary && !fetchedRef.current) {
      fetchedRef.current = true;
      synthesize();
    }
  }, [spokenSummary, synthesize]);

  // Auto-play once audio is ready (only if user has interacted)
  useEffect(() => {
    if (autoPlay && status === "ready" && audioUrl) {
      playAudio();
    }
  }, [autoPlay, status, audioUrl]);

  function playAudio() {
    if (!audioUrl || muted) return;
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    setStatus("playing");
    audio.onended = () => setStatus("ready");
    audio.onerror = () => setStatus("error");
    audio.play().catch(() => {
      setStatus("blocked");
    });
  }

  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setStatus("ready");
  }

  const isPlaying = status === "playing";

  return (
    <div className="elevenlabs-player">
      <div className="player-header">
        <span className="player-title">Voice Summary</span>
        <span className={`status-badge status-${status}`}>{STATUS_LABEL[status] || status}</span>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="player-controls">
        {status === "idle" && (
          <button className="btn-primary" onClick={synthesize} disabled={!spokenSummary}>
            Generate Voice
          </button>
        )}
        {status === "loading" && (
          <button className="btn-primary" disabled>
            <span className="spinner" /> Generating…
          </button>
        )}
        {(status === "ready" || status === "blocked") && (
          <button className="btn-primary" onClick={playAudio}>
            ▶ Play Summary
          </button>
        )}
        {status === "error" && (
          <button className="btn-secondary" onClick={synthesize}>
            Retry
          </button>
        )}
        {isPlaying && (
          <button className="btn-secondary" onClick={stopAudio}>
            ■ Stop
          </button>
        )}
        {audioUrl && (
          <button
            className={`btn-icon ${muted ? "muted" : ""}`}
            onClick={() => setMuted((m) => !m)}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        )}
      </div>

      {spokenSummary && (
        <p className="spoken-text muted">{spokenSummary}</p>
      )}
    </div>
  );
}
