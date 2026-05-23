import { Bot, ExternalLink, Radio, Volume2 } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

function mediaUrl(path) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path}`;
}

export default function CoachPanel({ packet, cue }) {
  const message = cue?.message || packet?.local_coach_message || "Begin a live session to receive movement cues.";
  const audioSrc = mediaUrl(cue?.audio_url);
  const avatarSrc = mediaUrl(cue?.avatar_url);

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
          <span><Radio size={15} /> {cue?.source || "local cue"}</span>
          <span><Volume2 size={15} /> {cue?.voice_status || packet?.voice_status || "idle"}</span>
          <span>{cue?.avatar_status || packet?.avatar_status || "idle"} avatar</span>
          <span>{cue?.should_speak ? "spoken" : cue?.reason || "visual"}</span>
        </div>
        {audioSrc && (
          <audio className="coach-audio" src={audioSrc} controls />
        )}
        {avatarSrc && (
          <a className="coach-media-link" href={avatarSrc} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> Avatar media
          </a>
        )}
      </div>
    </section>
  );
}
