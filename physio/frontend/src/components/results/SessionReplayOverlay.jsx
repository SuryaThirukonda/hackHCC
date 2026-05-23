import React, { useMemo } from "react";

const CHART_WIDTH = 480;
const CHART_HEIGHT = 140;
const PAD_X = 36;
const PAD_Y = 12;
const INNER_W = CHART_WIDTH - PAD_X * 2;
const INNER_H = CHART_HEIGHT - PAD_Y * 2;
const ANGLE_MIN = 30;
const ANGLE_MAX = 180;

function angleToY(angle) {
  // Higher angle = arm more straight = lower on chart (y closer to bottom)
  const clamped = Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, angle));
  return PAD_Y + ((ANGLE_MAX - clamped) / (ANGLE_MAX - ANGLE_MIN)) * INNER_H;
}

function timeToX(ms, startMs, totalMs) {
  if (!totalMs) return PAD_X;
  return PAD_X + ((ms - startMs) / totalMs) * INNER_W;
}

const PHASE_COLORS = {
  FLEXING: "#38bdf8",
  FLEXED_HOLD: "#4ade80",
  EXTENDING: "#fb923c",
  REP_COMPLETE: "#a78bfa",
  SESSION_COMPLETE: "#f472b6",
  EXTENDED_READY: "#94a3b8",
  WAITING_FOR_START: "#475569",
};

/**
 * SessionReplayOverlay
 *
 * Simple SVG chart showing:
 *   - Elbow angle over time (smoothed line)
 *   - Phase color bands
 *   - Rep completion markers
 *   - Tracking-lost markers
 */
export default function SessionReplayOverlay({ samples = [], reps = [] }) {
  const validSamples = useMemo(
    () =>
      (samples || []).filter(
        (s) =>
          s &&
          (s.smoothed_elbow_angle != null || s.raw_elbow_angle != null) &&
          s.timestampMs != null
      ),
    [samples]
  );

  if (!validSamples.length) {
    return (
      <div className="replay-overlay replay-overlay--empty">
        <p className="muted">No replay data recorded for this session.</p>
      </div>
    );
  }

  const startMs = validSamples[0].timestampMs;
  const endMs = validSamples[validSamples.length - 1].timestampMs;
  const totalMs = Math.max(endMs - startMs, 1);

  // Build SVG path for smoothed angle
  const smoothedPoints = validSamples
    .filter((s) => s.smoothed_elbow_angle != null)
    .map((s) => `${timeToX(s.timestampMs, startMs, totalMs).toFixed(1)},${angleToY(s.smoothed_elbow_angle).toFixed(1)}`);

  const smoothedPath = smoothedPoints.length > 1 ? `M ${smoothedPoints.join(" L ")}` : null;

  // Raw angle path (faint)
  const rawPoints = validSamples
    .filter((s) => s.raw_elbow_angle != null)
    .map((s) => `${timeToX(s.timestampMs, startMs, totalMs).toFixed(1)},${angleToY(s.raw_elbow_angle).toFixed(1)}`);
  const rawPath = rawPoints.length > 1 ? `M ${rawPoints.join(" L ")}` : null;

  // Rep marker x positions
  const repMarkers = (reps || []).map((rep) => {
    const t = rep.end_timestamp || rep.start_timestamp;
    if (!t) return null;
    const x = timeToX(t, startMs, totalMs);
    return { x, rep_number: rep.rep_number, score: rep.physio_score, clean: rep.clean };
  }).filter(Boolean);

  // Tracking-lost segments
  const lostSegments = [];
  let lostStart = null;
  for (const s of validSamples) {
    const isLost = !s.valid_landmarks || s.coach_state === "low_confidence";
    if (isLost && lostStart == null) lostStart = s.timestampMs;
    if (!isLost && lostStart != null) {
      lostSegments.push({ x1: timeToX(lostStart, startMs, totalMs), x2: timeToX(s.timestampMs, startMs, totalMs) });
      lostStart = null;
    }
  }
  if (lostStart != null) {
    lostSegments.push({ x1: timeToX(lostStart, startMs, totalMs), x2: PAD_X + INNER_W });
  }

  // Y-axis labels
  const yLabels = [180, 135, 90, 45];

  return (
    <div className="replay-overlay">
      <div className="replay-header">
        <span className="replay-title">Session Replay — Elbow Angle</span>
        <span className="replay-legend">
          <span className="legend-dot" style={{ background: "#38bdf8" }} /> Smoothed
          <span className="legend-dot" style={{ background: "#94a3b8", opacity: 0.5 }} /> Raw
        </span>
      </div>

      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        width="100%"
        className="replay-svg"
        style={{ display: "block", maxWidth: CHART_WIDTH }}
      >
        {/* Grid lines */}
        {yLabels.map((deg) => {
          const y = angleToY(deg);
          return (
            <g key={deg}>
              <line x1={PAD_X} y1={y} x2={PAD_X + INNER_W} y2={y} stroke="#334155" strokeWidth="0.5" strokeDasharray="3,3" />
              <text x={PAD_X - 4} y={y + 4} fill="#64748b" fontSize="8" textAnchor="end">{deg}°</text>
            </g>
          );
        })}

        {/* Tracking-lost shading */}
        {lostSegments.map((seg, i) => (
          <rect
            key={i}
            x={seg.x1}
            y={PAD_Y}
            width={Math.max(seg.x2 - seg.x1, 1)}
            height={INNER_H}
            fill="#ef444420"
          />
        ))}

        {/* Raw angle line (faint) */}
        {rawPath && (
          <path d={rawPath} fill="none" stroke="#94a3b8" strokeWidth="0.8" strokeOpacity="0.4" />
        )}

        {/* Smoothed angle line */}
        {smoothedPath && (
          <path d={smoothedPath} fill="none" stroke="#38bdf8" strokeWidth="1.5" />
        )}

        {/* Rep markers */}
        {repMarkers.map((m) => (
          <g key={m.rep_number}>
            <line x1={m.x} y1={PAD_Y} x2={m.x} y2={PAD_Y + INNER_H} stroke={m.clean ? "#4ade80" : "#fb923c"} strokeWidth="1" strokeDasharray="2,2" />
            <text x={m.x} y={PAD_Y - 2} fill={m.clean ? "#4ade80" : "#fb923c"} fontSize="8" textAnchor="middle">
              R{m.rep_number}
            </text>
          </g>
        ))}

        {/* Axes */}
        <line x1={PAD_X} y1={PAD_Y} x2={PAD_X} y2={PAD_Y + INNER_H} stroke="#475569" strokeWidth="1" />
        <line x1={PAD_X} y1={PAD_Y + INNER_H} x2={PAD_X + INNER_W} y2={PAD_Y + INNER_H} stroke="#475569" strokeWidth="1" />
      </svg>

      <div className="replay-rep-row">
        {(reps || []).map((rep) => (
          <div key={rep.rep_number} className={`rep-chip ${rep.clean ? "rep-chip--clean" : "rep-chip--flagged"}`}>
            <span>Rep {rep.rep_number}</span>
            {rep.physio_score != null && <span className="rep-score">{rep.physio_score}</span>}
            {rep.issue_label && rep.issue_label !== "none" && (
              <span className="rep-issue">{rep.issue_label.replace(/_/g, " ")}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
