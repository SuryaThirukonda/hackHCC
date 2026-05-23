import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Send } from "lucide-react";
import { requestElevenLabsSummary } from "../../api/sessionRecordingV2Client.js";
import {
  FEEDBACK_CHIPS,
  classifyPatientFeedback
} from "../../analysis/patient/classifyPatientFeedback.js";
import BlobCoachAvatar from "../coach/BlobCoachAvatar.jsx";
import VoiceRecordInput from "../voice/VoiceRecordInput.jsx";

const OPENING_MESSAGE = "How did that feel? Did you notice any pain, tightness, or fatigue? Was it easier or harder than last time?";

export default function PatientCheckInPanel({
  sessionId,
  onSubmit,
  onCoachMessageChange,
  onVoiceStatusChange,
  onSpeechStatusChange,
  onNext,
  disabled = false,
  initialFeedback = null,
  initialConversation = null,
}) {
  const [text, setText] = useState(initialFeedback?.raw_text || "");
  const [selectedChip, setSelectedChip] = useState(initialFeedback?.classification || null);
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [speechStatus, setSpeechStatus] = useState({ listening: false, transcribing: false });
  const [coachMessage, setCoachMessage] = useState(
    initialConversation?.[0]?.text || (initialFeedback ? initialFeedback.response_text : OPENING_MESSAGE)
  );
  const [conversation, setConversation] = useState(
    initialConversation || [{ role: "coach", text: OPENING_MESSAGE }]
  );
  const [submitted, setSubmitted] = useState(Boolean(initialFeedback));
  const audioRef = useRef(null);
  const greetingSpokenRef = useRef(Boolean(initialFeedback));
  const stopListeningRef = useRef(null);

  const updateVoiceStatus = useCallback((next) => {
    setVoiceStatus(next);
    onVoiceStatusChange?.(next);
  }, [onVoiceStatusChange]);

  const stopCoachAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);

  const speakWithElevenLabs = useCallback(async (message, persistKey) => {
    if (!message) return null;
    stopCoachAudio();
    updateVoiceStatus("loading");
    try {
      const result = await requestElevenLabsSummary(message, `${sessionId || "session"}-${persistKey}`);
      const url = result?.audio_url;
      if (!url) {
        updateVoiceStatus("error");
        return null;
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => updateVoiceStatus("ready");
      audio.onerror = () => updateVoiceStatus("error");
      await audio.play();
      updateVoiceStatus("playing");
      return url;
    } catch {
      updateVoiceStatus("error");
      return null;
    }
  }, [sessionId, stopCoachAudio, updateVoiceStatus]);

  useEffect(() => {
    onCoachMessageChange?.(coachMessage);
  }, [coachMessage, onCoachMessageChange]);

  useEffect(() => {
    if (submitted || greetingSpokenRef.current) return undefined;
    greetingSpokenRef.current = true;
    const timer = window.setTimeout(() => {
      speakWithElevenLabs(OPENING_MESSAGE, "checkin-greeting");
    }, 600);
    return () => window.clearTimeout(timer);
  }, [submitted, speakWithElevenLabs]);

  useEffect(() => () => {
    stopListeningRef.current?.();
    stopCoachAudio();
  }, [stopCoachAudio]);

  useEffect(() => {
    onSpeechStatusChange?.(speechStatus);
  }, [speechStatus, onSpeechStatusChange]);

  async function handleSubmit(event) {
    event?.preventDefault?.();
    if (disabled || submitted || speechStatus.transcribing || speechStatus.listening || (!text && !selectedChip)) return;

    stopListeningRef.current?.();

    const feedback = classifyPatientFeedback(text, selectedChip);
    const patientMessage = { role: "patient", text: text || selectedChip };
    const nextConversation = [...conversation, patientMessage];
    setConversation(nextConversation);
    setSubmitted(true);

    const responseAudioUrl = await speakWithElevenLabs(feedback.response_text, "checkin-response");
    const coachReply = {
      role: "coach",
      text: feedback.response_text,
      audio_url: responseAudioUrl
    };
    const fullConversation = [...nextConversation, coachReply];
    setConversation(fullConversation);
    setCoachMessage(feedback.response_text);

    onSubmit?.({
      ...feedback,
      check_in_conversation: fullConversation,
      voice_audio_url: responseAudioUrl,
      greeting_audio_url: conversation[0]?.audio_url || null
    });
  }

  const { listening, transcribing, micLevel } = speechStatus;
  const blobStatus = listening || transcribing
    ? "thinking"
    : voiceStatus === "playing"
      ? "speaking"
      : voiceStatus === "loading"
        ? "thinking"
        : "idle";

  return (
    <section className="patient-checkin-panel patient-checkin-conversation">
      <div className="patient-checkin-header">
        <p className="eyebrow">Patient check-in</p>
        <h2>Talk with your coach</h2>
        <p className="muted-sub">Share how the session felt. Your coach will listen and respond.</p>
      </div>

      <div className="checkin-coach-stage">
        <div className="checkin-coach-blob-wrap">
          <BlobCoachAvatar status={blobStatus} size="lg" />
        </div>
        <div className={`checkin-coach-speech${blobStatus === "speaking" ? " checkin-coach-speech--speaking" : ""}`}>
          <p>{coachMessage}</p>
          {listening && (
            <span className="recording-indicator">
              <span className="recording-dot" aria-hidden="true" />
              Recording — speak now, then tap Stop
              {micLevel != null && (
                <span className="voice-mic-meter"> · mic {Math.round(micLevel * 100)}%</span>
              )}
            </span>
          )}
          {!listening && transcribing && (
            <span className="muted-sub">Transcribing your message…</span>
          )}
          {!listening && !transcribing && voiceStatus === "loading" && <span className="muted-sub">Preparing voice…</span>}
          {!listening && !transcribing && voiceStatus === "playing" && <span className="muted-sub">Speaking…</span>}
          {!listening && !transcribing && voiceStatus === "error" && <span className="muted-sub">Voice unavailable — message shown above.</span>}
        </div>
      </div>

      <div className="checkin-thread">
        {conversation.map((entry, index) => (
          <div key={`${entry.role}-${index}`} className={`checkin-message checkin-message--${entry.role}`}>
            <span className="checkin-message-label">{entry.role === "coach" ? "Coach" : "You"}</span>
            <p>{entry.text}</p>
          </div>
        ))}
      </div>

      {!submitted ? (
        <form className="patient-checkin-form" onSubmit={handleSubmit}>
          <div className="feedback-chip-row">
            {FEEDBACK_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className={`feedback-chip${selectedChip === chip.id ? " active" : ""}`}
                onClick={() => {
                  setSelectedChip(chip.id);
                  if (!text) setText(chip.label);
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>

          <VoiceRecordInput
            value={text}
            onChange={setText}
            placeholder="Tell your coach how that felt, or tap Record and speak…"
            rows={3}
            disabled={disabled}
            onBeforeRecord={stopCoachAudio}
            onStatusChange={setSpeechStatus}
            stopRef={stopListeningRef}
            showMicMeter
            recordLabel="Record"
            stopLabel="Stop recording"
          />

          <div className="patient-checkin-actions">
            <button
              type="submit"
              className="primary-btn"
              disabled={disabled || speechStatus.transcribing || speechStatus.listening || (!text && !selectedChip)}
            >
              <Send size={16} />
              Send
            </button>
          </div>
        </form>
      ) : (
        <div className="results-flow-actions">
          <button type="button" className="primary-btn" onClick={onNext}>
            Next — Session notes
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </section>
  );
}
