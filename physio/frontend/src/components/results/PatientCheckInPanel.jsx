import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Send } from "lucide-react";
import { requestElevenLabsSummary } from "../../api/sessionRecordingV2Client.js";
import { buildCoachSessionContext } from "../../analysis/coach/buildCoachSessionContext.js";
import {
  FEEDBACK_CHIPS,
  classifyPatientFeedback
} from "../../analysis/patient/classifyPatientFeedback.js";
import VoiceRecordInput from "../voice/VoiceRecordInput.jsx";
import HeyGenSessionCoach from "./HeyGenSessionCoach.jsx";

const COMPARE_CHIPS = FEEDBACK_CHIPS.filter((chip) =>
  ["easier_than_last", "harder_than_last", "same_as_last"].includes(chip.id)
);

function buildCheckInFeedback({ feelText, selectedChip, painLevel, compareChip, coachContext }) {
  const combinedText = [
    feelText,
    Number.isFinite(painLevel) && painLevel > 0 ? `Pain level ${painLevel}/10` : painLevel === 0 ? "No pain" : "",
    compareChip?.label || "",
  ].filter(Boolean).join(". ");

  const feedback = classifyPatientFeedback(combinedText, selectedChip || compareChip?.id || null);
  if (Number.isFinite(painLevel)) {
    feedback.pain_level = Math.max(feedback.pain_level || 0, painLevel);
    feedback.sharp_pain = feedback.sharp_pain || painLevel >= 7;
  }
  if (compareChip?.id) {
    if (compareChip.id === "easier_than_last") feedback.difficulty_vs_last = "easier";
    if (compareChip.id === "harder_than_last") feedback.difficulty_vs_last = "harder";
    if (compareChip.id === "same_as_last") feedback.difficulty_vs_last = "same";
  }

  feedback.check_in_answers = {
    feel: feelText || selectedChip || null,
    pain_level: Number.isFinite(painLevel) ? painLevel : null,
    compare: compareChip?.id || null,
  };
  feedback.exercise_id = coachContext?.exercise_id || null;
  feedback.exercise_name = coachContext?.exercise_name || null;
  feedback.coach_context = coachContext?.brief_lines || [];
  return feedback;
}

export default function PatientCheckInPanel({
  sessionId,
  exercise,
  summary,
  geminiAnalysis,
  onSubmit,
  onCoachMessageChange,
  onVoiceStatusChange,
  onSpeechStatusChange,
  onNext,
  disabled = false,
  initialFeedback = null,
  initialConversation = null,
}) {
  const coachContext = useMemo(
    () => buildCoachSessionContext({ exercise, summary, geminiAnalysis, sessionId }),
    [exercise, summary, geminiAnalysis, sessionId]
  );
  const openingMessage = initialConversation?.[0]?.text || coachContext.opening_message;

  const [feelText, setFeelText] = useState(initialFeedback?.check_in_answers?.feel || initialFeedback?.raw_text || "");
  const [selectedChip, setSelectedChip] = useState(initialFeedback?.classification || null);
  const [painLevel, setPainLevel] = useState(initialFeedback?.check_in_answers?.pain_level ?? initialFeedback?.pain_level ?? 0);
  const [compareChip, setCompareChip] = useState(
    COMPARE_CHIPS.find((chip) => chip.id === initialFeedback?.check_in_answers?.compare)
    || COMPARE_CHIPS.find((chip) => chip.id === initialFeedback?.classification)
    || null
  );
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [speechStatus, setSpeechStatus] = useState({ listening: false, transcribing: false });
  const [coachMessage, setCoachMessage] = useState(
    initialFeedback?.response_text || openingMessage
  );
  const [conversation, setConversation] = useState(
    initialConversation || [{ role: "coach", text: openingMessage }]
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
      speakWithElevenLabs(coachContext.spoken_intro, "checkin-greeting");
    }, 900);
    return () => window.clearTimeout(timer);
  }, [submitted, speakWithElevenLabs, coachContext.spoken_intro]);

  useEffect(() => () => {
    stopListeningRef.current?.();
    stopCoachAudio();
  }, [stopCoachAudio]);

  useEffect(() => {
    onSpeechStatusChange?.(speechStatus);
  }, [speechStatus, onSpeechStatusChange]);

  async function handleSubmit(event) {
    event?.preventDefault?.();
    if (disabled || submitted || speechStatus.transcribing || speechStatus.listening) return;
    if (!feelText && !selectedChip && !compareChip && painLevel === 0) return;

    stopListeningRef.current?.();

    const feedback = buildCheckInFeedback({
      feelText,
      selectedChip,
      painLevel,
      compareChip,
      coachContext,
    });
    const patientMessage = {
      role: "patient",
      text: [
        feelText || selectedChip,
        `Pain: ${painLevel}/10`,
        compareChip?.label,
      ].filter(Boolean).join(" · "),
    };
    const nextConversation = [...conversation, patientMessage];
    setConversation(nextConversation);
    setSubmitted(true);

    const responseAudioUrl = await speakWithElevenLabs(feedback.response_text, "checkin-response");
    const coachReply = {
      role: "coach",
      text: feedback.response_text,
      audio_url: responseAudioUrl,
    };
    const fullConversation = [...nextConversation, coachReply];
    setConversation(fullConversation);
    setCoachMessage(feedback.response_text);

    onSubmit?.({
      ...feedback,
      check_in_conversation: fullConversation,
      voice_audio_url: responseAudioUrl,
      greeting_audio_url: conversation[0]?.audio_url || null,
    });
  }

  const { listening, transcribing, micLevel } = speechStatus;

  return (
    <section className="patient-checkin-panel patient-checkin-conversation">
      <div className="patient-checkin-header">
        <p className="eyebrow">Patient check-in</p>
        <h2>Talk with your coach about {coachContext.exercise_name}</h2>
        <p className="muted-sub">
          Your video coach knows what you just practiced. Share how it felt so we can log it for your therapist.
        </p>
      </div>

      <div className="checkin-coach-layout">
        <HeyGenSessionCoach
          sessionId={sessionId}
          exercise={exercise}
          summary={summary}
          geminiAnalysis={geminiAnalysis}
          enableGeneratedVideo={false}
        />
        <div className={`checkin-coach-speech${voiceStatus === "playing" ? " checkin-coach-speech--speaking" : ""}`}>
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
          <div className="checkin-question-block">
            <label className="checkin-question-label">How did this session feel?</label>
            <div className="feedback-chip-row">
              {FEEDBACK_CHIPS.filter((chip) => !["easier_than_last", "harder_than_last", "same_as_last"].includes(chip.id)).map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className={`feedback-chip${selectedChip === chip.id ? " active" : ""}`}
                  onClick={() => {
                    setSelectedChip(chip.id);
                    if (!feelText) setFeelText(chip.label);
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <VoiceRecordInput
              value={feelText}
              onChange={setFeelText}
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
          </div>

          <div className="checkin-question-block">
            <label className="checkin-question-label" htmlFor="checkin-pain">
              Any pain during or after the exercise? ({painLevel}/10)
            </label>
            <input
              id="checkin-pain"
              className="checkin-pain-slider"
              type="range"
              min="0"
              max="10"
              step="1"
              value={painLevel}
              onChange={(event) => setPainLevel(Number(event.target.value))}
              disabled={disabled}
            />
            <div className="checkin-pain-labels">
              <span>None</span>
              <span>Mild</span>
              <span>Severe</span>
            </div>
          </div>

          <div className="checkin-question-block">
            <span className="checkin-question-label">Compared to your last session</span>
            <div className="feedback-chip-row">
              {COMPARE_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className={`feedback-chip${compareChip?.id === chip.id ? " active" : ""}`}
                  onClick={() => setCompareChip(chip)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          <div className="patient-checkin-actions">
            <button
              type="submit"
              className="primary-btn"
              disabled={
                disabled
                || speechStatus.transcribing
                || speechStatus.listening
                || (!feelText && !selectedChip && !compareChip && painLevel === 0)
              }
            >
              <Send size={16} />
              Save check-in
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
