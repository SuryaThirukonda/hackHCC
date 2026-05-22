export default function ProgressDashboard({ packet, sessions, localSessions = [], sourceMode = "mock" }) {
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
  const demoSessions = sessions.length ? sessions : fallbackSessions;
  const recentReal = localSessions.slice(0, 4);
  const recentDemo = demoSessions.slice(0, 4);
  const latest = recentReal[0] || recentDemo[0];
  const angle = packet?.exercise === "elbow_flexion_extension"
    ? packet?.elbow_angle ?? 0
    : packet?.shoulder_angle ?? 0;
  const angleLabel = packet?.exercise === "elbow_flexion_extension" ? "Elbow angle" : "Angle";
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
          {recentReal.length ? <span className="status-pill">real completed sessions</span> : <span className="status-pill">demo history</span>}
        </div>
      </div>

      <div className="progress-summary-grid">
        <ProgressStat label="Total reps" value={latest.total_reps} />
        <ProgressStat label="Best ROM" value={latest.best_range_of_motion ?? latest.best_angle} unit="deg" />
        <ProgressStat label="Avg score" value={latest.average_physio_score} />
        <ProgressStat label="Jitter" value={latest.average_jitter_score} />
        <ProgressStat label="Pain/Fatigue" value={`${latest.pain_level ?? "--"}/${latest.fatigue_level ?? "--"}`} />
      </div>

      <div className="signal-row">
        <Signal label={angleLabel} value={angle} displayValue={packet ? undefined : "--"} max={packet?.exercise === "elbow_flexion_extension" ? 180 : 110} />
        <Signal label="Score" value={score} displayValue={packet?.physio_score == null ? "--" : undefined} max={100} />
        <Signal label="Jitter" value={jitter} max={1} invert />
      </div>

      {recentReal.length > 0 && (
        <>
          <p className="eyebrow progress-history-label">Completed sessions</p>
          <div className="history-list">
            {recentReal.map((session) => (
              <SessionHistoryCard key={session.session_id} session={session} />
            ))}
          </div>
        </>
      )}

      <p className="eyebrow progress-history-label">{sessions.length ? "Saved backend history" : "Demo history"}</p>
      <div className="history-list">
        {recentDemo.map((session) => (
          <SessionHistoryCard key={session.session_id} session={session} demo={!sessions.length} />
        ))}
      </div>
    </section>
  );
}

function SessionHistoryCard({ session, demo = false }) {
  return (
    <article className="history-card">
      <strong>{session.total_reps} reps</strong>
      <span>{session.average_physio_score} avg score</span>
      <small>{demo ? "Demo" : "Real"} | Best {session.best_range_of_motion ?? session.best_angle} deg | jitter {session.average_jitter_score}</small>
    </article>
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
