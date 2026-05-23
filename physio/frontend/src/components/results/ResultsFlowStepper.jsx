import React, { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import SessionSummaryStep from "./SessionSummaryStep.jsx";
import PatientCheckInPanel from "./PatientCheckInPanel.jsx";
import TherapistSessionNotePanel from "./TherapistSessionNotePanel.jsx";

const STEPS = [
  { id: "summary", label: "Summary" },
  { id: "checkin", label: "Check-in" },
  { id: "notes", label: "Session notes" },
];

export default function ResultsFlowStepper({
  geminiResult,
  geminiStatus,
  sessionId,
  summary,
  recording,
  finalAnalysisPacket,
  geminiError,
  onVoiceStatusChange,
  onCheckInSubmit,
  onCheckInCoachMessage,
  onCheckInVoiceStatusChange,
  onCheckInSpeechStatusChange,
  patientFeedback,
  checkInConversation,
  therapistNote,
  therapistNoteStatus,
  therapistNoteError,
  onContinue,
  onFlowStepChange,
  isDemo = false,
  initialStep = "summary",
}) {
  const [step, setStep] = useState(initialStep);
  const [voiceFinished, setVoiceFinished] = useState(false);

  useEffect(() => {
    if (patientFeedback && therapistNote) {
      setStep("notes");
    } else if (patientFeedback) {
      setStep("checkin");
    } else {
      setStep("summary");
    }
    setVoiceFinished(false);
  }, [sessionId]);

  useEffect(() => {
    onFlowStepChange?.(step);
  }, [step, onFlowStepChange]);

  function goTo(nextStep) {
    setStep(nextStep);
  }

  function handleSummaryVoiceStatus(status) {
    onVoiceStatusChange?.(status);
    if (status === "ready" || status === "error" || status === "idle") {
      setVoiceFinished(true);
    }
  }

  const stepIndex = STEPS.findIndex((item) => item.id === step);

  return (
    <div className="results-flow-stepper">
      {isDemo && (
        <div className="demo-banner">
          Demo playback — not live tracking data
        </div>
      )}

      <div className="results-flow-progress" aria-label="Results flow progress">
        {STEPS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={`results-flow-dot${index <= stepIndex ? " active" : ""}${index === stepIndex ? " current" : ""}`}
            onClick={() => {
              if (index <= stepIndex || (item.id === "checkin" && patientFeedback) || (item.id === "notes" && therapistNote)) {
                goTo(item.id);
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {step === "summary" && (
        <SessionSummaryStep
          summary={summary}
          geminiResult={geminiResult}
          geminiStatus={geminiStatus}
          geminiError={geminiError}
          sessionId={sessionId}
          recording={recording}
          onVoiceStatusChange={handleSummaryVoiceStatus}
          onNext={() => goTo("checkin")}
          voiceFinished={voiceFinished}
        />
      )}

      {step === "checkin" && (
        <PatientCheckInPanel
          sessionId={sessionId}
          onSubmit={onCheckInSubmit}
          onCoachMessageChange={onCheckInCoachMessage}
          onVoiceStatusChange={onCheckInVoiceStatusChange}
          onSpeechStatusChange={onCheckInSpeechStatusChange}
          onNext={() => goTo("notes")}
          disabled={Boolean(patientFeedback)}
          initialFeedback={patientFeedback}
          initialConversation={checkInConversation}
        />
      )}

      {step === "notes" && (
        <>
          <TherapistSessionNotePanel
            note={therapistNote}
            status={therapistNoteStatus}
            error={therapistNoteError}
          />
          {therapistNote && (
            <div className="results-flow-actions">
              <button type="button" className="primary-btn" onClick={onContinue}>
                Continue to Progress
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          {therapistNoteStatus === "loading" && (
            <p className="muted-sub">Generating your session note…</p>
          )}
        </>
      )}
    </div>
  );
}
