import { Radio, Volume2, VolumeX } from "lucide-react";

function sourceLabel(source) {
  if (source === "phase_cue") return "phase cue";
  if (source === "local_fallback") return "local";
  if (source === "gemini_summary") return "AI summary";
  return source || "local";
}

export default function CoachPanel({
  packet,
  cue,
  aiCue,
  overlayCoachMessage = "",
  voiceEnabled,
  voiceMuted,
  voiceStatus,
  voiceError,
  onToggleVoiceEnabled,
  onToggleVoiceMuted
}) {
  const localMessage = packet?.local_coach_message || cue?.message || "Begin a live session to receive movement cues.";
  const message = overlayCoachMessage || aiCue?.text || localMessage;
  const cueSource = aiCue?.source || "local_fallback";

  return (
    <section className="coach-panel coach-panel--compact">
      <div className="coach-copy">
        <p className="eyebrow">Coach cue</p>
        <h2>{message}</h2>
        <div className="ai-coach-box">
          <div>
            <p className="eyebrow">Guidance source</p>
            <strong>{localMessage}</strong>
          </div>
          <span className="ai-status ai-status-ready">
            {sourceLabel(cueSource)}
          </span>
        </div>
        <div className="coach-stats">
          <span><Radio size={15} /> {sourceLabel(cueSource)}</span>
          <span><Volume2 size={15} /> {voiceStatus || "idle"}</span>
          <span>{cue?.avatar_status || "disabled"} avatar</span>
          <span>follow your therapist&apos;s plan</span>
        </div>
        <div className="coach-toggle-row">
          <button type="button" onClick={onToggleVoiceEnabled}>
            <Volume2 size={15} /> {voiceEnabled ? "Voice on" : "Voice off"}
          </button>
          <button type="button" onClick={onToggleVoiceMuted}>
            {voiceMuted ? <VolumeX size={15} /> : <Volume2 size={15} />} {voiceMuted ? "Muted" : "Unmuted"}
          </button>
        </div>
        {voiceError && <p className="coach-error">{voiceError}</p>}
      </div>
    </section>
  );
}
