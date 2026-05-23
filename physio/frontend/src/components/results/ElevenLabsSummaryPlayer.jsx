import React, { useCallback, useEffect, useRef, useState } from "react";
import { requestElevenLabsSummary } from "../../api/sessionRecordingV2Client.js";

const STATUS_LABEL = {
  idle: "Not started",
  loading: "Generating audio...",
  playing: "Playing",
  ready: "Ready",
  error: "Audio unavailable",
  blocked: "Click play to enable audio",
};

/**
 * ElevenLabsSummaryPlayer
 * Receives Gemini spoken_summary text, generates audio, and auto-plays it when
 * the browser allows playback. The parent receives playback progress so the
 * coach speech bubble can reveal the same text as the voice speaks.
 */
export default function ElevenLabsSummaryPlayer({
  spokenSummary,
  sessionId,
  autoPlay = true,
  onAudioUrl,
  onStatusChange,
  onPlaybackStart,
  onPlaybackProgress,
  onPlaybackEnd,
  compact = false,
}) {
  const [status, setStatus] = useState("idle");
  const [audioUrl, setAudioUrl] = useState(null);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const audioRef = useRef(null);
  const fetchedRef = useRef(false);
  const requestKeyRef = useRef("");
  const autoPlayAttemptedRef = useRef(false);
  const onStatusChangeRef = useRef(onStatusChange);
  const onAudioUrlRef = useRef(onAudioUrl);
  const onPlaybackStartRef = useRef(onPlaybackStart);
  const onPlaybackProgressRef = useRef(onPlaybackProgress);
  const onPlaybackEndRef = useRef(onPlaybackEnd);
  onStatusChangeRef.current = onStatusChange;
  onAudioUrlRef.current = onAudioUrl;
  onPlaybackStartRef.current = onPlaybackStart;
  onPlaybackProgressRef.current = onPlaybackProgress;
  onPlaybackEndRef.current = onPlaybackEnd;

  const updateStatus = useCallback((nextStatus) => {
    setStatus(nextStatus);
    onStatusChangeRef.current?.(nextStatus);
  }, []);

  const stopAudio = useCallback((nextStatus = "ready") => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    onPlaybackEndRef.current?.();
    updateStatus(nextStatus);
  }, [updateStatus]);

  const synthesize = useCallback(async () => {
    if (!spokenSummary) return;
    updateStatus("loading");
    setError("");
    try {
      const result = await requestElevenLabsSummary(spokenSummary, sessionId);
      if (result.ok && result.audio_url) {
        setAudioUrl(result.audio_url);
        updateStatus("ready");
        onAudioUrlRef.current?.(result.audio_url);
      } else {
        updateStatus("error");
        setError(result.error_message_sanitized || "TTS unavailable");
      }
    } catch (err) {
      updateStatus("error");
      setError(err.message);
    }
  }, [spokenSummary, sessionId, updateStatus]);

  useEffect(() => {
    const requestKey = `${sessionId || "session"}:${spokenSummary || ""}`;
    if (requestKeyRef.current !== requestKey) {
      requestKeyRef.current = requestKey;
      fetchedRef.current = false;
      autoPlayAttemptedRef.current = false;
      setAudioUrl(null);
      setError("");
      stopAudio("idle");
    }
    if (spokenSummary && !fetchedRef.current) {
      fetchedRef.current = true;
      synthesize();
    }
  }, [sessionId, spokenSummary, synthesize, stopAudio]);

  const playAudio = useCallback(() => {
    if (!audioUrl || muted) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    audio.onplay = () => {
      updateStatus("playing");
      onPlaybackStartRef.current?.();
      onPlaybackProgressRef.current?.(0);
    };
    audio.ontimeupdate = () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 1;
      onPlaybackProgressRef.current?.(Math.min(1, audio.currentTime / duration));
    };
    audio.onended = () => {
      audioRef.current = null;
      onPlaybackProgressRef.current?.(1);
      onPlaybackEndRef.current?.();
      updateStatus("ready");
    };
    audio.onerror = () => {
      audioRef.current = null;
      onPlaybackEndRef.current?.();
      updateStatus("error");
      setError("Browser could not play the generated audio.");
    };

    updateStatus("playing");
    audio.play().catch(() => {
      audioRef.current = null;
      onPlaybackEndRef.current?.();
      updateStatus("blocked");
    });
  }, [audioUrl, muted, updateStatus]);

  useEffect(() => {
    if (autoPlay && status === "ready" && audioUrl && !muted && !autoPlayAttemptedRef.current) {
      autoPlayAttemptedRef.current = true;
      playAudio();
    }
  }, [autoPlay, status, audioUrl, muted, playAudio]);

  const isPlaying = status === "playing";

  return (
    <div className={`elevenlabs-player${compact ? " elevenlabs-player--compact" : ""}`}>
      {!compact && (
        <div className="player-header">
          <span className="player-title">Voice Summary</span>
          <span className={`status-badge status-${status}`}>{STATUS_LABEL[status] || status}</span>
        </div>
      )}

      {error && !compact && <p className="error-text">{error}</p>}

      <div className="player-controls">
        {status === "idle" && (
          <button className="btn-primary" onClick={synthesize} disabled={!spokenSummary}>
            {compact ? "▶ Play summary" : "Generate Voice"}
          </button>
        )}
        {status === "loading" && (
          <button className="btn-primary" disabled>
            <span className="spinner" /> {compact ? "Preparing…" : "Generating..."}
          </button>
        )}
        {(status === "ready" || status === "blocked") && (
          <button className="btn-primary" onClick={playAudio}>
            ▶ Play Summary
          </button>
        )}
        {status === "error" && (
          <button className="btn-secondary" onClick={synthesize}>
            Retry Voice
          </button>
        )}
        {isPlaying && (
          <button className="btn-secondary" onClick={() => stopAudio("ready")}>
            ◼ Stop
          </button>
        )}
        {!compact && audioUrl && (
          <button
            className={`btn-icon ${muted ? "muted" : ""}`}
            onClick={() => setMuted((value) => !value)}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? "Mute" : "Audio"}
          </button>
        )}
        {compact && (
          <span className={`compact-status-badge status-${status}`}>
            {STATUS_LABEL[status] || status}
          </span>
        )}
      </div>

      {!compact && spokenSummary && (
        <p className="spoken-text muted">{spokenSummary}</p>
      )}
    </div>
  );
}
