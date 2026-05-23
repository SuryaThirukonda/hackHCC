import { Activity, Gauge, Ruler, Repeat2, Target, Video, Waves } from "lucide-react";
import { getVisionFrameUrl } from "../api/client.js";
import BrowserPoseOverlay from "./BrowserPoseOverlay.jsx";
import MetricCard from "./MetricCard.jsx";

function primaryAngle(packet, exercise) {
  if (exercise?.joint === "elbow") return packet?.elbow_angle;
  return packet?.shoulder_angle;
}

function primaryAngleLabel(exercise) {
  return exercise?.joint === "elbow" ? "Elbow angle" : "Shoulder angle";
}

function phaseLabel(packet) {
  if (!packet) return "Waiting";
  return packet.analyzer_phase_label || {
    idle: "Start straight",
    resting: "Ready",
    raising: "Bending",
    holding: "Hold",
    lowering: "Straighten",
    rep_complete: "Rep complete"
  }[packet.rep_phase] || packet.rep_phase || "Waiting";
}

function isForwardPress(exercise) {
  return exercise?.movementType === "forward_press" || exercise?.id === "seated_one_arm_forward_press";
}

function targetLabel(packet, exercise) {
  if (exercise?.targetPosition) {
    return `${exercise.targetPosition.elbowAngleMin}-${exercise.targetPosition.elbowAngleMax}`;
  }
  return packet ? packet.target_angle.toFixed(0) : "--";
}

function anglePercent(packet, exercise) {
  const angle = primaryAngle(packet, exercise);
  if (!packet || angle == null) return 0;
  if (isForwardPress(exercise) && exercise.startPosition && exercise.targetPosition) {
    const start = exercise.startPosition.elbowAngleMax;
    const target = (exercise.targetPosition.elbowAngleMin + exercise.targetPosition.elbowAngleMax) / 2;
    return Math.max(0, Math.min(100, ((angle - start) / Math.max(target - start, 1)) * 100));
  }
  if (exercise?.joint === "elbow" && exercise.startPosition && exercise.targetPosition) {
    const start = exercise.startPosition.elbowAngleMax;
    const target = (exercise.targetPosition.elbowAngleMin + exercise.targetPosition.elbowAngleMax) / 2;
    return Math.max(0, Math.min(100, ((start - angle) / Math.max(start - target, 1)) * 100));
  }
  return Math.max(0, Math.min(100, (angle / packet.target_angle) * 100));
}

function AngleDial({ packet, compact = false, exercise }) {
  const angle = primaryAngle(packet, exercise);
  const rotation = exercise?.joint === "elbow"
    ? 180 - Math.min(Math.max(angle ?? 180, 55), 180)
    : Math.min(angle ?? 0, 118);
  return (
    <div className={compact ? "target-arc target-arc-compact" : "target-arc"}>
      <div className="angle-arm" style={{ transform: `rotate(${rotation}deg)` }} />
      <div className="angle-core">
        <span>{angle == null ? "--" : Math.round(angle)}</span>
        <small>degrees</small>
      </div>
    </div>
  );
}

export default function LiveSession({
  packet,
  sourceMode = "mock",
  sourceStatus,
  sessionId,
  onBrowserPacket,
  onRoutineBegin,
  frameTick = 0,
  showDebug = true,
  exercise,
  exerciseTitle = "Elbow Flexion / Extension",
  recordingActive = true,
  overlayCoachMessage = "",
  bonusRepRequested = false
}) {
  const percent = anglePercent(packet, exercise);
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
          {phaseLabel(packet)}
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
          <BrowserPoseOverlay
            active={browserMode}
            sessionId={sessionId}
            side={packet?.side || exercise?.side || "right"}
            exercise={exercise}
            recordingActive={recordingActive}
            overlayCoachMessage={overlayCoachMessage}
            onPacket={onBrowserPacket}
            onRoutineBegin={onRoutineBegin}
            bonusRepRequested={bonusRepRequested}
          />
        ) : (
          <AngleDial packet={packet} exercise={exercise} />
        )}
        <div className="angle-progress" aria-label="Current angle progress">
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className={realMode ? "metric-grid metric-grid-real" : "metric-grid"}>
        {realMode && (
          <div className="angle-mini-card">
            <AngleDial packet={packet} compact exercise={exercise} />
            <div>
              <p>{primaryAngleLabel(exercise)}</p>
              <strong>{formatMetric(primaryAngle(packet, exercise))}<span>deg</span></strong>
            </div>
          </div>
        )}
        <MetricCard icon={Activity} label={primaryAngleLabel(exercise)} value={formatMetric(primaryAngle(packet, exercise))} unit="deg" accent="mint" />
        <MetricCard icon={Target} label={isForwardPress(exercise) ? "Target extension zone" : exercise?.joint === "elbow" ? "Target flexion zone" : "Target angle"} value={targetLabel(packet, exercise)} unit="deg" accent="amber" />
        {exercise?.joint === "elbow" && (
          <MetricCard icon={Ruler} label="Upper arm drift" value={formatMetric(packet?.shoulder_drift)} unit="deg" accent="blue" />
        )}
        <MetricCard icon={Repeat2} label="Reps completed" value={packet ? `${packet.rep_count}/${packet.analyzer_output?.rep_goal || exercise?.repGoal || "--"}` : "--"} accent="coral" />
        <MetricCard icon={Gauge} label="PhysioScore" value={packet?.physio_score ?? "--"} accent="blue" />
        <MetricCard icon={Waves} label="Jitter" value={packet ? packet.combined_jitter_score.toFixed(2) : "--"} accent="lime" />
        {exercise?.joint === "elbow" && (
          <>
            <MetricCard icon={Target} label="Hold time" value={formatMetric(packet?.hold_time_sec)} unit="s" accent="amber" />
            <MetricCard icon={Activity} label={isForwardPress(exercise) ? "Extension ROM" : "ROM"} value={formatMetric(packet?.range_of_motion)} unit="deg" accent="mint" />
          </>
        )}
        {isForwardPress(exercise) && (
          <>
            <MetricCard icon={Ruler} label="Push depth" value={formatMetric(packet?.push_depth_cm)} unit="cm" accent="mint" />
            <MetricCard icon={Waves} label="Distance linearity" value={formatMetric(packet?.sensor_linearity_score, 2)} accent="lime" />
          </>
        )}
        {realMode && (
          <MetricCard icon={Ruler} label="Distance" value={packet?.distance_cm == null ? "--" : packet.distance_cm.toFixed(1)} unit={packet?.distance_cm == null ? "" : "cm"} accent="amber" />
        )}
      </div>
      {showDebug && <AnalysisDebug packet={packet} sourceMode={sourceMode} />}
    </section>
  );
}

function formatMetric(value, digits = 1) {
  return value == null ? "--" : value.toFixed(digits);
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
