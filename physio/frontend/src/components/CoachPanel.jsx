import { Bot, Radio, Volume2 } from "lucide-react";

export default function CoachPanel({ packet, cue }) {
  const message = cue?.message || packet?.local_coach_message || "Start a mock session to receive coaching.";

  return (
    <section className="coach-panel">
      <div className="avatar-frame">
        <div className="avatar-orbit">
          <Bot size={58} strokeWidth={1.7} />
        </div>
        <div className="avatar-lines">
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className="coach-copy">
        <p className="eyebrow">Coach cue</p>
        <h2>{message}</h2>
        <div className="coach-stats">
          <span><Radio size={15} /> {cue?.source || "mock"}</span>
          <span><Volume2 size={15} /> {cue?.voice_status || packet?.voice_status || "idle"}</span>
          <span>{cue?.avatar_status || packet?.avatar_status || "idle"} avatar</span>
        </div>
      </div>
    </section>
  );
}
