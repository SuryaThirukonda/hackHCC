export default function ProgressDashboard({ packet, sessions, sourceMode = "mock" }) {
  const fallbackSessions = [
    {
      session_id: "demo-progress-1",
      total_reps: 8,
      best_angle: 91,
      average_physio_score: 74,
      average_jitter_score: 0.28,
      pain_level: 3,
      fatigue_level: 4
    },
    {
      session_id: "demo-progress-2",
      total_reps: 9,
      best_angle: 95,
      average_physio_score: 81,
      average_jitter_score: 0.21,
      pain_level: 2,
      fatigue_level: 3
    }
  ];
  const displaySessions = sessions.length ? sessions : fallbackSessions;
  const recent = displaySessions.slice(0, 4);
  const latest = displaySessions[0];
  const angle = packet?.shoulder_angle ?? 0;
  const score = packet?.physio_score ?? 0;
  const jitter = packet?.combined_jitter_score ?? 0;
  const sourceLabel = {
    python_opencv: "Real Python session",
    browser_mediapipe: "Live Webcam Analysis session",
    mock: "Mock demo session"
  }[packet?.source] || {
    python: "Real Python session",
    browser: "Live Webcam Analysis session",
    mock: "Mock demo session"
  }[sourceMode];

  return (
    <section className="progress-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Session telemetry</p>
          <h2>Progress dashboard</h2>
        </div>
        <div className="heading-pills">
          <span className="status-pill">{sourceLabel}</span>
          {!sessions.length && <span className="status-pill">demo history</span>}
        </div>
      </div>

      <div className="progress-summary-grid">
        <ProgressStat label="Total reps" value={latest.total_reps} />
        <ProgressStat label="Best angle" value={latest.best_angle} unit="deg" />
        <ProgressStat label="Avg score" value={latest.average_physio_score} />
        <ProgressStat label="Jitter" value={latest.average_jitter_score} />
        <ProgressStat label="Pain/Fatigue" value={`${latest.pain_level}/${latest.fatigue_level}`} />
      </div>

      <div className="signal-row">
        <Signal label="Angle" value={angle} displayValue={packet?.shoulder_angle == null ? "--" : undefined} max={110} />
        <Signal label="Score" value={score} displayValue={packet?.physio_score == null ? "--" : undefined} max={100} />
        <Signal label="Jitter" value={jitter} max={1} invert />
      </div>

      <div className="history-list">
        {recent.map((session) => (
          <article key={session.session_id} className="history-card">
            <strong>{session.total_reps} reps</strong>
            <span>{session.average_physio_score} avg score</span>
            <small>Best {session.best_angle} deg | jitter {session.average_jitter_score}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProgressStat({ label, value, unit = "" }) {
  return (
    <article className="progress-stat">
      <p>{label}</p>
      <strong>{value}{unit && <span>{unit}</span>}</strong>
    </article>
  );
}

function Signal({ label, value, max, invert = false, displayValue }) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  const height = invert ? 100 - percent : percent;
  return (
    <div className="signal">
      <div className="signal-track">
        <span style={{ height: `${height}%` }} />
      </div>
      <p>{label}</p>
      <strong>{displayValue ?? Number(value).toFixed(max === 1 ? 2 : 0)}</strong>
    </div>
  );
}
