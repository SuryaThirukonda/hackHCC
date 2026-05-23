import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeSpeechAudio } from "../api/speechClient.js";
import { PcmMicRecorder } from "../utils/pcmMicRecorder.js";

export function isSpeechRecognitionSupported() {
  return typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof AudioContext !== "undefined";
}

/**
 * Record mic PCM via Web Audio, encode WAV, transcribe via ElevenLabs Scribe.
 */
export function useSpeechToText({ onFinalTranscript } = {}) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState("");
  const [lastDebug, setLastDebug] = useState(null);
  const [micLevel, setMicLevel] = useState(0);
  const recorderRef = useRef(null);
  const sessionRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const listeningRef = useRef(false);
  const levelTimerRef = useRef(null);
  const onFinalTranscriptRef = useRef(onFinalTranscript);

  onFinalTranscriptRef.current = onFinalTranscript;

  const supported = isSpeechRecognitionSupported();

  const stopLevelMeter = useCallback(() => {
    if (levelTimerRef.current) {
      window.clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
    setMicLevel(0);
  }, []);

  const abortRecording = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    sessionRef.current += 1;
    stopLevelMeter();
    recorderRef.current?.abort();
    recorderRef.current = null;
  }, [stopLevelMeter]);

  const finishRecording = useCallback(async (session) => {
    if (session !== sessionRef.current) return;

    const recorder = recorderRef.current;
    recorderRef.current = null;
    stopLevelMeter();
    setListening(false);

    if (!recorder) return;

    const livePeakLast = recorder.getLivePeak?.() || 0;

    setTranscribing(true);
    try {
      const captured = await recorder.stop();
      const elapsedMs = Date.now() - recordingStartedAtRef.current;

      const convertDebug = {
        capture_mode: captured.captureMode,
        track_label: captured.trackLabel,
        track_muted: captured.trackMuted,
        pcm_samples: captured.pcmSamples,
        pcm_peak: captured.pcmPeak,
        capture_peak: captured.capturePeak,
        wav_bytes: captured.wavBytes,
        duration_sec: captured.durationSec,
        elapsed_ms: elapsedMs,
        live_peak_last: livePeakLast,
      };

      if (elapsedMs < 600) {
        setError("Recording was too short. Hold Record for at least one second, then Stop.");
        setLastDebug(convertDebug);
        return;
      }

      const peak = Math.max(captured.pcmPeak, captured.capturePeak, captured.peak);
      if (peak < 0.0005) {
        setError(
          `No audio signal captured (peak ${peak.toFixed(5)}). ` +
          `Mic track: "${captured.trackLabel}". ` +
          "The browser has mic permission but this device/track is sending silence — pick a different input in Windows Sound Settings."
        );
        setLastDebug(convertDebug);
        return;
      }

      const result = await transcribeSpeechAudio(captured.wavBlob, "audio/wav");
      const text = (result?.text || "").trim();
      const debug = { ...convertDebug, ...(result?.debug || {}) };
      setLastDebug(debug);

      if (text) {
        onFinalTranscriptRef.current?.(text);
        setError("");
      } else {
        const hint = [
          `peak ${peak.toFixed(4)}`,
          debug.raw_text ? `raw: ${JSON.stringify(debug.raw_text)}` : null,
        ].filter(Boolean).join(" · ");
        setError((result?.error_message_sanitized || "No speech detected.") + (hint ? ` (${hint})` : ""));
      }
    } catch (err) {
      setError(err?.message || "Transcription failed. Is the backend running?");
    } finally {
      setTranscribing(false);
    }
  }, [stopLevelMeter]);

  const stopListening = useCallback(() => {
    if (!listeningRef.current) return;
    listeningRef.current = false;
    const session = sessionRef.current;
    finishRecording(session);
  }, [finishRecording]);

  const startListening = useCallback(async () => {
    setError("");

    if (!supported) {
      setError("Voice recording is not supported in this browser.");
      return false;
    }

    if (!window.isSecureContext) {
      setError("Voice input requires HTTPS or localhost.");
      return false;
    }

    if (listeningRef.current) {
      abortRecording();
    }

    const session = sessionRef.current;
    const recorder = new PcmMicRecorder();
    recorderRef.current = recorder;

    try {
      await recorder.start();
    } catch (err) {
      recorderRef.current = null;
      const denied = err?.name === "NotAllowedError" || err?.name === "NotFoundError";
      setError(
        denied
          ? "Microphone access was blocked. Allow mic permission in your browser settings."
          : "Could not access the microphone."
      );
      return false;
    }

    recordingStartedAtRef.current = Date.now();
    listeningRef.current = true;
    setListening(true);

    levelTimerRef.current = window.setInterval(() => {
      const level = recorderRef.current?.getLivePeak?.() || 0;
      setMicLevel(level);
    }, 100);

    return true;
  }, [abortRecording, supported]);

  const toggleListening = useCallback(async () => {
    if (listeningRef.current) {
      stopListening();
      return;
    }
    await startListening();
  }, [startListening, stopListening]);

  useEffect(() => () => {
    abortRecording();
  }, [abortRecording]);

  return {
    supported,
    listening,
    transcribing,
    micLevel,
    interimText: "",
    error,
    setError,
    lastDebug,
    startListening,
    stopListening,
    toggleListening,
  };
};
