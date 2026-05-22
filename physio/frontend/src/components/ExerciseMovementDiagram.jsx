import { useEffect, useMemo, useState } from "react";

const LOOP_SECONDS = 18;
const EXTENDED_ROTATION = 0;
const FLEXED_ROTATION = -90;
const PHASES = ["Extend", "Bend", "Hold", "Straighten"];
const SHOULDER = { x: 210, y: 300 };
const ELBOW = { x: 420, y: 300 };
const FOREARM_LENGTH = 220;
const HAND_LENGTH = 54;
const ARC_RADIUS = 168;

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function easeInOut(value) {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

function lerp(start, end, progress) {
  return start + (end - start) * progress;
}

function phaseForTime(seconds) {
  if (seconds < 1.5) {
    return { rotation: EXTENDED_ROTATION, label: "Extend" };
  }
  if (seconds < 7.5) {
    return {
      rotation: lerp(EXTENDED_ROTATION, FLEXED_ROTATION, easeInOut((seconds - 1.5) / 6)),
      label: "Bend"
    };
  }
  if (seconds < 10) {
    return { rotation: FLEXED_ROTATION, label: "Hold" };
  }
  return {
    rotation: lerp(FLEXED_ROTATION, EXTENDED_ROTATION, easeInOut((seconds - 10) / 8)),
    label: "Straighten"
  };
}

function pointAtRotation(rotationDegrees, length) {
  const radians = (rotationDegrees * Math.PI) / 180;
  return {
    x: ELBOW.x + length * Math.cos(radians),
    y: ELBOW.y + length * Math.sin(radians)
  };
}

function angleBetween(a, b) {
  const dot = a.x * b.x + a.y * b.y;
  const magA = Math.hypot(a.x, a.y);
  const magB = Math.hypot(b.x, b.y);
  if (!magA || !magB) return 0;
  return Math.acos(clamp(dot / (magA * magB), -1, 1)) * 180 / Math.PI;
}

function elbowAngleForRotation(rotationDegrees) {
  const wrist = pointAtRotation(rotationDegrees, FOREARM_LENGTH);
  const upperArmVector = { x: SHOULDER.x - ELBOW.x, y: SHOULDER.y - ELBOW.y };
  const forearmVector = { x: wrist.x - ELBOW.x, y: wrist.y - ELBOW.y };
  return Math.round(angleBetween(upperArmVector, forearmVector));
}

function arcPath(startRotation, endRotation, radius) {
  const start = pointAtRotation(startRotation, radius);
  const end = pointAtRotation(endRotation, radius);
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} A ${radius} ${radius} 0 0 0 ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

function ForearmShape({ className = "" }) {
  return (
    <g className={className}>
      <rect
        x={ELBOW.x - 4}
        y={ELBOW.y - 22}
        width={FOREARM_LENGTH}
        height="44"
        rx="22"
      />
      <rect
        className="diagram-hand"
        x={ELBOW.x + FOREARM_LENGTH - 2}
        y={ELBOW.y - 27}
        width={HAND_LENGTH}
        height="54"
        rx="15"
      />
      <path
        className="diagram-forearm-highlight"
        d={`M ${ELBOW.x + 34} ${ELBOW.y - 10} H ${ELBOW.x + FOREARM_LENGTH - 34}`}
      />
    </g>
  );
}

export default function ExerciseMovementDiagram() {
  const [motion, setMotion] = useState({ rotation: EXTENDED_ROTATION, label: "Extend" });

  useEffect(() => {
    let raf = 0;
    const startedAt = performance.now();

    const tick = (now) => {
      const elapsed = ((now - startedAt) / 1000) % LOOP_SECONDS;
      setMotion(phaseForTime(elapsed));
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const elbowAngle = useMemo(() => elbowAngleForRotation(motion.rotation), [motion.rotation]);
  const targetAngle = elbowAngleForRotation(FLEXED_ROTATION);

  return (
    <div className="movement-diagram" aria-label="Elbow flexion and extension instruction diagram">
      <div className="movement-diagram-label">
        <span>{motion.label}</span>
        <strong>{elbowAngle} deg</strong>
      </div>

      <svg className="movement-diagram-svg" viewBox="0 0 900 520" role="img">
        <title>Elbow flexion and extension diagram</title>
        <desc>A clinical diagram where the upper arm stays fixed and the forearm rotates slowly around the elbow hinge.</desc>

        <defs>
          <filter id="diagram-soft-shadow" x="-15%" y="-15%" width="130%" height="130%">
            <feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#1d2930" floodOpacity="0.14" />
          </filter>
          <marker id="motion-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#2f8f9d" />
          </marker>
        </defs>

        <rect x="28" y="30" width="844" height="460" rx="28" className="diagram-board" />

        <g className="diagram-grid" opacity="0.28">
          {Array.from({ length: 18 }).map((_, index) => (
            <line key={`v-${index}`} x1={82 + index * 42} x2={82 + index * 42} y1="84" y2="438" />
          ))}
          {Array.from({ length: 9 }).map((_, index) => (
            <line key={`h-${index}`} x1="82" x2="818" y1={96 + index * 42} y2={96 + index * 42} />
          ))}
        </g>

        <g className="diagram-torso" filter="url(#diagram-soft-shadow)">
          <rect x="82" y="178" width="136" height="244" rx="56" />
          <circle cx={SHOULDER.x} cy={SHOULDER.y} r="46" />
        </g>

        <g className="diagram-ghost-start">
          <ForearmShape />
        </g>

        <g className="diagram-ghost-target" transform={`rotate(${FLEXED_ROTATION} ${ELBOW.x} ${ELBOW.y})`}>
          <ForearmShape />
        </g>

        <path
          className="diagram-motion-arc"
          d={arcPath(EXTENDED_ROTATION, FLEXED_ROTATION, ARC_RADIUS)}
          markerEnd="url(#motion-arrow)"
        />
        <path
          className="diagram-target-zone"
          d={arcPath(FLEXED_ROTATION + 11, FLEXED_ROTATION - 11, ARC_RADIUS - 34)}
        />

        <text className="diagram-label diagram-label-start" x="604" y="344">
          Start: arm straight
        </text>
        <text className="diagram-label diagram-label-target" x="446" y="80">
          Target bend {targetAngle} deg
        </text>

        <g className="diagram-upper-arm" filter="url(#diagram-soft-shadow)">
          <rect
            x={SHOULDER.x - 4}
            y={SHOULDER.y - 25}
            width={ELBOW.x - SHOULDER.x + 20}
            height="50"
            rx="25"
          />
          <path
            className="diagram-upper-arm-highlight"
            d={`M ${SHOULDER.x + 24} ${SHOULDER.y - 12} H ${ELBOW.x - 34}`}
          />
        </g>

        <g
          className="diagram-forearm"
          transform={`rotate(${motion.rotation} ${ELBOW.x} ${ELBOW.y})`}
          filter="url(#diagram-soft-shadow)"
        >
          <ForearmShape />
        </g>

        <g className="diagram-elbow">
          <circle cx={ELBOW.x} cy={ELBOW.y} r="42" />
          <circle cx={ELBOW.x} cy={ELBOW.y} r="21" />
          <text x={ELBOW.x - 58} y={ELBOW.y + 72}>Elbow angle</text>
          <text x={ELBOW.x - 25} y={ELBOW.y + 102} className="diagram-angle-value">{elbowAngle} deg</text>
        </g>
      </svg>

      <div className="movement-phase-row" aria-label="Exercise phases">
        {PHASES.map((phase) => (
          <span key={phase} data-active={phase === motion.label ? "true" : "false"}>
            {phase}
          </span>
        ))}
      </div>
    </div>
  );
}
