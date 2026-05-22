import { Activity, Gauge, Ruler, Repeat2, Target, Waves } from "lucide-react";
import BrowserPoseOverlay from "./BrowserPoseOverlay.jsx";
import MetricCard from "./MetricCard.jsx";

function anglePercent(packet) {
  if (!packet) return 0;
  return Math.max(0, Math.min(100, (packet.shoulder_angle / packet.target_angle) * 100));
}

function AngleDial({ packet, compact = false }) {
  return (
    <div className={compact ? "target-arc target-arc-compact" : "target-arc"}>
      <div className="angle-arm" style={{ transform: `rotate(${Math.min(packet?.shoulder_angle || 0, 118)}deg)` }} />
      <div className="angle-core">
        <span>{packet ? Math.round(packet.shoulder_angle) : "--"}</span>
        <small>degrees</small>
      </div>
    </div>
  );
}

export default function LiveSession({ packet, dataSource = "mock", sessionId, onBrowserPacket }) {
  const percent = anglePercent(packet);
  const realMode = dataSource === "real";

  return (
    <section className={`live-panel ${realMode ? "live-panel-real" : ""}`}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Live movement</p>
          <h2>Right arm raise</h2>
        </div>
        <span className={`status-pill status-${packet?.coach_state || "idle"}`}>
          {packet?.coach_state?.replaceAll("_", " ") || "waiting"}
        </span>
      </div>

      <div className="angle-stage">
        {realMode ? (
          <BrowserPoseOverlay active={realMode} sessionId={sessionId} onPacket={onBrowserPacket} />
        ) : (
          <AngleDial packet={packet} />
        )}
        <div className="angle-progress" aria-label="Current angle progress">
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className={realMode ? "metric-grid metric-grid-real" : "metric-grid"}>
        {realMode && (
          <div className="angle-mini-card">
            <AngleDial packet={packet} compact />
            <div>
              <p>Angle dial</p>
              <strong>{packet ? packet.shoulder_angle.toFixed(1) : "--"}<span>deg</span></strong>
            </div>
          </div>
        )}
        <MetricCard icon={Activity} label="Current angle" value={packet ? packet.shoulder_angle.toFixed(1) : "--"} unit="deg" accent="mint" />
        <MetricCard icon={Target} label="Target angle" value={packet ? packet.target_angle.toFixed(0) : "--"} unit="deg" accent="amber" />
        <MetricCard icon={Repeat2} label="Reps" value={packet?.rep_count ?? "--"} accent="coral" />
        <MetricCard icon={Gauge} label="PhysioScore" value={packet?.physio_score ?? "--"} accent="blue" />
        <MetricCard icon={Waves} label="Jitter" value={packet ? packet.combined_jitter_score.toFixed(2) : "--"} accent="lime" />
        {realMode && (
          <MetricCard icon={Ruler} label="Distance" value={packet?.distance_cm == null ? "--" : packet.distance_cm.toFixed(1)} unit={packet?.distance_cm == null ? "" : "cm"} accent="amber" />
        )}
      </div>
    </section>
  );
}
