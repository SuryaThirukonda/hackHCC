import React, { useMemo } from "react";
import { isInSessionEdgeTimestamp } from "../../analysis/smoothing/poseSignalSmoother.js";

const CHART_WIDTH = 480;
const CHART_HEIGHT = 140;
const PAD_X = 36;
const PAD_Y = 12;
const INNER_W = CHART_WIDTH - PAD_X * 2;
const INNER_H = CHART_HEIGHT - PAD_Y * 2;
const ANGLE_MIN = 30;
const ANGLE_MAX = 180;
const JITTER_FLAG_THRESHOLD = 0.35;
const MIN_EVENT_SPACING_MS = 320;

function angleToY(angle) {
  const clamped = Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, angle));
  return PAD_Y + ((ANGLE_MAX - clamped) / (ANGLE_MAX - ANGLE_MIN)) * INNER_H;
}

function timeToX(ms, startMs, totalMs) {
  if (!totalMs) return PAD_X;
  return PAD_X + ((ms - startMs) / totalMs) * INNER_W;
}

function groupJitterMarkers(samples, startMs, endMs) {
  const markers = [];
  let lastMarkerMs = -Infinity;
  for (const sample of samples) {
    const flagged = Boolean(sample.jitter_grouped_event ?? sample.jitter_event);
    if (!flagged) continue;
    if (isInSessionEdgeTimestamp(sample.timestampMs, startMs, endMs)) continue;
    if (sample.timestampMs - lastMarkerMs < MIN_EVENT_SPACING_MS) continue;
    lastMarkerMs = sample.timestampMs;
    markers.push({
      x: sample.timestampMs,
      y: sample.raw_elbow_angle ?? sample.smoothed_elbow_angle,
      score: sample.camera_jitter_score ?? sample.jitter_score ?? 0.5,
      reason: sample.jitter_reason ?? sample.jitter_debug?.reason ?? null
    });
  }
  return markers;
}

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

  const groupedMarkers = groupJitterMarkers(validSamples, startMs, endMs);
  const jitterPoints = groupedMarkers.map((point) => ({
    x: timeToX(point.x, startMs, totalMs),
    y: angleToY(point.y),
    score: point.score,
    reason: point.reason
  }));

  const jitterValues = validSamples
    .filter((sample) => !isInSessionEdgeTimestamp(sample.timestampMs, startMs, endMs))
    .map((s) => s.camera_jitter_score ?? s.jitter_score)
    .filter(Number.isFinite);
  const jitterEventCount = groupedMarkers.length;
  const avgJitter = jitterValues.length
    ? jitterValues.reduce((sum, value) => sum + value, 0) / jitterValues.length
    : 0;

  const smoothedPoints = validSamples
    .filter((s) => s.smoothed_elbow_angle != null)
    .map((s) => `${timeToX(s.timestampMs, startMs, totalMs).toFixed(1)},${angleToY(s.smoothed_elbow_angle).toFixed(1)}`);
  const smoothedPath = smoothedPoints.length > 1 ? `M ${smoothedPoints.join(" L ")}` : null;

  const rawPoints = validSamples
    .filter((s) => s.raw_elbow_angle != null)
    .map((s) => `${timeToX(s.timestampMs, startMs, totalMs).toFixed(1)},${angleToY(s.raw_elbow_angle).toFixed(1)}`);
  const rawPath = rawPoints.length > 1 ? `M ${rawPoints.join(" L ")}` : null;

  const repMarkers = (reps || []).map((rep) => {
    const t = rep.end_timestamp || rep.start_timestamp;
    if (!t) return null;
    const x = timeToX(t, startMs, totalMs);
    return { x, rep_number: rep.rep_number ?? rep.rep_index, score: rep.physio_score, clean: rep.clean };
  }).filter(Boolean);

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

  const yLabels = [180, 135, 90, 45];

  return (
    <div className="replay-overlay">
      <div className="replay-header">
        <span className="replay-title">Session Replay — Elbow Angle</span>
        <span className="replay-legend">
          <span className="legend-dot" style={{ background: "#38bdf8" }} /> Smoothed
          <span className="legend-dot" style={{ background: "#94a3b8", opacity: 0.5 }} /> Raw
          <span className="legend-dot" style={{ background: "#ef4444" }} /> Jitter
        </span>
      </div>

      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        width="100%"
        className="replay-svg"
        style={{ display: "block", maxWidth: CHART_WIDTH }}
      >
        {yLabels.map((deg) => {
          const y = angleToY(deg);
          return (
            <g key={deg}>
              <line x1={PAD_X} y1={y} x2={PAD_X + INNER_W} y2={y} stroke="#334155" strokeWidth="0.5" strokeDasharray="3,3" />
              <text x={PAD_X - 4} y={y + 4} fill="#64748b" fontSize="8" textAnchor="end">{deg}°</text>
            </g>
          );
        })}

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

        {rawPath && (
          <path d={rawPath} fill="none" stroke="#94a3b8" strokeWidth="0.8" strokeOpacity="0.4" />
        )}

        {smoothedPath && (
          <path d={smoothedPath} fill="none" stroke="#38bdf8" strokeWidth="1.5" />
        )}

        {jitterPoints.map((point, index) => (
          <circle
            key={`${point.x}-${index}`}
            cx={point.x}
            cy={point.y}
            r={3}
            fill="#ef4444"
            fillOpacity="0.7"
          />
        ))}

        {repMarkers.map((m) => (
          <g key={m.rep_number}>
            <line x1={m.x} y1={PAD_Y} x2={m.x} y2={PAD_Y + INNER_H} stroke={m.clean ? "#4ade80" : "#fb923c"} strokeWidth="1" strokeDasharray="2,2" />
            <text x={m.x} y={PAD_Y - 2} fill={m.clean ? "#4ade80" : "#fb923c"} fontSize="8" textAnchor="middle">
              R{m.rep_number}
            </text>
          </g>
        ))}

        <line x1={PAD_X} y1={PAD_Y} x2={PAD_X} y2={PAD_Y + INNER_H} stroke="#475569" strokeWidth="1" />
        <line x1={PAD_X} y1={PAD_Y + INNER_H} x2={PAD_X + INNER_W} y2={PAD_Y + INNER_H} stroke="#475569" strokeWidth="1" />
      </svg>

      <div className="replay-rep-row">
        <div className={`rep-chip ${avgJitter >= JITTER_FLAG_THRESHOLD ? "rep-chip--flagged" : "rep-chip--clean"}`}>
          <span>Avg jitter</span>
          <span className="rep-score">{avgJitter.toFixed(2)}</span>
          {jitterEventCount > 0 && <span>{jitterEventCount} events</span>}
        </div>
        {(reps || []).map((rep) => (
          (() => {
            const issue = rep.issue_label || rep.issue;
            const jitterFlagged = (rep.jitter_score ?? 0) >= JITTER_FLAG_THRESHOLD;
            const visibleIssue = issue === "too_jittery" && !jitterFlagged ? "none" : issue;
            const flagged = jitterFlagged || (visibleIssue && visibleIssue !== "none" && rep.clean === false);
            return (
          <div
            key={rep.rep_number ?? rep.rep_index}
            className={`rep-chip ${flagged ? "rep-chip--flagged" : "rep-chip--clean"}`}
          >
            <span>Rep {rep.rep_number ?? rep.rep_index}</span>
            {rep.physio_score != null && <span className="rep-score">{rep.physio_score}</span>}
            {Number.isFinite(rep.jitter_score) && <span>jitter {rep.jitter_score.toFixed(2)}</span>}
            {Number.isFinite(rep.jitter_count) && rep.jitter_count > 0 && (
              <span>{rep.jitter_count} jitters</span>
            )}
            {visibleIssue && visibleIssue !== "none" && (
              <span className="rep-issue">{visibleIssue.replace(/_/g, " ")}</span>
            )}
          </div>
            );
          })()
        ))}
      </div>
    </div>
  );
}
