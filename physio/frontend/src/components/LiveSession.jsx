import { Activity, Gauge, Ruler, Repeat2, Target, Video, Waves } from "lucide-react";
import { getVisionFrameUrl } from "../api/client.js";
import BrowserPoseOverlay from "./BrowserPoseOverlay.jsx";
import MetricCard from "./MetricCard.jsx";

function anglePercent(packet) {
  if (!packet || packet.shoulder_angle == null) return 0;
  return Math.max(0, Math.min(100, (packet.shoulder_angle / packet.target_angle) * 100));
}

function AngleDial({ packet, compact = false }) {
  return (
    <div className={compact ? "target-arc target-arc-compact" : "target-arc"}>
      <div className="angle-arm" style={{ transform: `rotate(${Math.min(packet?.shoulder_angle ?? 0, 118)}deg)` }} />
      <div className="angle-core">
        <span>{packet?.shoulder_angle == null ? "--" : Math.round(packet.shoulder_angle)}</span>
        <small>degrees</small>
      </div>
    </div>
  );
}

export default function LiveSession({ packet, sourceMode = "mock", sourceStatus, sessionId, onBrowserPacket, frameTick = 0, showDebug = true, exerciseTitle = "Elbow Flexion / Extension" }) {
  const percent = anglePercent(packet);
  const pythonMode = sourceMode === "python";
  const browserMode = sourceMode === "browser";
  const realMode = pythonMode || browserMode;
  const pythonConnected = Boolean(sourceStatus?.python_recent);
  const pythonFrameAvailable = Boolean(sourceStatus?.vision_frame_available);

  return (
    <section className={`live-panel ${realMode ? "live-panel-real" : ""}`}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Live movement</p>
          <h2>{exerciseTitle}</h2>
        </div>
        <span className={`status-pill status-${packet?.coach_state || "idle"}`}>
          {packet?.coach_state?.replaceAll("_", " ") || "waiting"}
        </span>
      </div>

      <div className="angle-stage">
        {pythonMode ? (
          <div className="camera-stage">
            <img src={getVisionFrameUrl(frameTick)} alt="Python OpenCV overlay with tracked landmarks" />
            <span className="camera-badge"><Video size={15} /> Python OpenCV overlay</span>
            {(!pythonConnected || !pythonFrameAvailable) && (
              <div className="camera-permission camera-empty-state">
                <Video size={34} />
                <strong>Python OpenCV tracker not connected.</strong>
                <p>Start python vision/pose_tracker.py or switch to Browser Camera Fallback.</p>
                <code>python vision/pose_tracker.py</code>
              </div>
            )}
          </div>
        ) : browserMode ? (
          <BrowserPoseOverlay active={browserMode} sessionId={sessionId} side={packet?.side || "right"} onPacket={onBrowserPacket} />
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
              <strong>{formatMetric(packet?.shoulder_angle)}<span>deg</span></strong>
            </div>
          </div>
        )}
        <MetricCard icon={Activity} label="Current angle" value={formatMetric(packet?.shoulder_angle)} unit="deg" accent="mint" />
        <MetricCard icon={Target} label="Target angle" value={packet ? packet.target_angle.toFixed(0) : "--"} unit="deg" accent="amber" />
        <MetricCard icon={Repeat2} label="Reps" value={packet?.rep_count ?? "--"} accent="coral" />
        <MetricCard icon={Gauge} label="PhysioScore" value={packet?.physio_score ?? "--"} accent="blue" />
        <MetricCard icon={Waves} label="Jitter" value={packet ? packet.combined_jitter_score.toFixed(2) : "--"} accent="lime" />
        {realMode && (
          <MetricCard icon={Ruler} label="Distance" value={packet?.distance_cm == null ? "--" : packet.distance_cm.toFixed(1)} unit={packet?.distance_cm == null ? "" : "cm"} accent="amber" />
        )}
      </div>
      {showDebug && <AnalysisDebug packet={packet} sourceMode={sourceMode} />}
    </section>
  );
}

function formatMetric(value) {
  return value == null ? "--" : value.toFixed(1);
}

function boolText(value) {
  if (value == null) return "--";
  return value ? "true" : "false";
}

function AnalysisDebug({ packet, sourceMode }) {
  return (
    <div className="analysis-debug-panel" aria-label="Analysis debug readout">
      <span>pose_detected: <strong>{boolText(packet?.pose_detected)}</strong></span>
      <span>shoulder_present: <strong>{boolText(packet?.shoulder_present)}</strong></span>
      <span>elbow_present: <strong>{boolText(packet?.elbow_present)}</strong></span>
      <span>wrist_present: <strong>{boolText(packet?.wrist_present)}</strong></span>
      <span>hip_present: <strong>{boolText(packet?.hip_present)}</strong></span>
      <span>landmark_confidence: <strong>{packet ? packet.landmark_confidence.toFixed(3) : "--"}</strong></span>
      <span>active_side: <strong>{packet?.side || "right"}</strong></span>
      <span>angle_valid: <strong>{boolText(packet?.angle_valid)}</strong></span>
      <span>torso_ref: <strong>{boolText(packet?.using_torso_reference)}</strong></span>
      <span>screen_fallback: <strong>{boolText(packet?.using_screen_axis_fallback)}</strong></span>
      <span>shoulder_coords: <strong>{formatCoords(packet?.shoulder_coords)}</strong></span>
      <span>elbow_coords: <strong>{formatCoords(packet?.elbow_coords)}</strong></span>
      <span>wrist_coords: <strong>{formatCoords(packet?.wrist_coords)}</strong></span>
      <span>reject_reason: <strong>{packet?.angle_rejection_reason || "--"}</strong></span>
      <span>packet_source: <strong>{packet?.source || sourceMode}</strong></span>
    </div>
  );
}

function formatCoords(point) {
  if (!point) return "--";
  return `${point.x}, ${point.y}`;
}
