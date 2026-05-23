import React, { useCallback, useEffect, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { useSpeechToText } from "../../hooks/useSpeechToText.js";
import { requestSpeechSttTest } from "../../api/speechClient.js";

/**
 * Shared record → ElevenLabs Scribe STT input used in check-in and debug.
 */
export default function VoiceRecordInput({
  value,
  onChange,
  placeholder = "Tap Record and speak, or type your message…",
  rows = 3,
  disabled = false,
  onBeforeRecord,
  onStatusChange,
  stopRef,
  showClear = false,
  showDebug = false,
  showMicMeter = false,
  showSttTest = false,
  recordLabel = "Record voice",
  stopLabel = "Stop recording",
  className = "",
  hideActions = false,
}) {
  const [internalText, setInternalText] = useState("");
  const controlled = typeof value === "string" && typeof onChange === "function";
  const text = controlled ? value : internalText;
  const setText = controlled ? onChange : setInternalText;

  const appendTranscript = useCallback((piece) => {
    setText((current) => (current ? `${current} ${piece}` : piece).trim());
  }, [setText]);

  const {
    supported: speechSupported,
    listening,
    transcribing,
    error: speechError,
    setError: setSpeechError,
    lastDebug,
    micLevel,
    toggleListening,
    stopListening,
  } = useSpeechToText({ onFinalTranscript: appendTranscript });

  useEffect(() => () => stopListening(), [stopListening]);

  useEffect(() => {
    if (stopRef) stopRef.current = stopListening;
  }, [stopListening, stopRef]);

  useEffect(() => {
    onStatusChange?.({ listening, transcribing, speechSupported, speechError, lastDebug, micLevel });
  }, [listening, transcribing, speechSupported, speechError, lastDebug, micLevel, onStatusChange]);

  async function handleToggleListening() {
    setSpeechError("");
    if (listening) {
      stopListening();
      return;
    }
    onBeforeRecord?.();
    await toggleListening();
  }

  function handleClear() {
    stopListening();
    setText("");
    setSpeechError("");
  }

  const [sttTestResult, setSttTestResult] = useState(null);
  const [sttTestLoading, setSttTestLoading] = useState(false);

  async function runSttTest() {
    setSttTestLoading(true);
    setSttTestResult(null);
    try {
      const result = await requestSpeechSttTest();
      setSttTestResult(result);
    } catch (err) {
      setSttTestResult({ ok: false, error: err.message });
    } finally {
      setSttTestLoading(false);
    }
  }

  return (
    <div className={`voice-record-input${className ? ` ${className}` : ""}`}>
      <div className={`patient-checkin-input-wrap${listening ? " patient-checkin-input-wrap--recording" : ""}`}>
        <textarea
          className="patient-checkin-input"
          placeholder={placeholder}
          value={text}
          onChange={(event) => {
            if (!listening && !transcribing) setText(event.target.value);
          }}
          readOnly={listening || transcribing}
          rows={rows}
          disabled={disabled}
        />
        {listening && (
          <div className="recording-banner" role="status" aria-live="polite">
            <span className="recording-dot" aria-hidden="true" />
            Recording… tap Stop when finished
            {showMicMeter && (
              <span className="voice-mic-meter">
                {" "}
                mic {Math.round(micLevel * 100)}%
              </span>
            )}
          </div>
        )}
        {transcribing && (
          <div className="recording-banner" role="status" aria-live="polite">
            Transcribing…
          </div>
        )}
      </div>

      {speechError && <p className="coach-error">{speechError}</p>}
      {!speechSupported && (
        <p className="muted-sub">Voice input works best in Chrome or Edge on localhost/HTTPS. You can type instead.</p>
      )}

      {!hideActions && (
        <div className="voice-record-input__actions">
          {speechSupported && (
            <button
              type="button"
              className={`secondary-btn voice-record-btn${listening ? " voice-record-btn--active" : ""}`}
              onClick={handleToggleListening}
              disabled={disabled || transcribing}
              aria-pressed={listening}
            >
              {listening ? <MicOff size={16} /> : <Mic size={16} />}
              {listening ? stopLabel : recordLabel}
            </button>
          )}
          {showClear && (
            <button
              type="button"
              className="secondary-btn"
              onClick={handleClear}
              disabled={disabled || (!text && !listening && !transcribing)}
            >
              Clear
            </button>
          )}
          {showSttTest && (
            <button
              type="button"
              className="secondary-btn"
              onClick={runSttTest}
              disabled={disabled || sttTestLoading || listening || transcribing}
            >
              {sttTestLoading ? "Testing STT…" : "Test STT (noise file)"}
            </button>
          )}
        </div>
      )}

      {showSttTest && sttTestResult && (
        <pre className="voice-debug-json">{JSON.stringify(sttTestResult, null, 2)}</pre>
      )}

      {showDebug && lastDebug && (
        <pre className="voice-debug-json">{JSON.stringify(lastDebug, null, 2)}</pre>
      )}
    </div>
  );
}
