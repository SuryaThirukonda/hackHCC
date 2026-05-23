function compareMetric(current, previous, higherIsBetter = true) {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return { label: "—", tone: "neutral" };
  }
  const delta = current - previous;
  if (Math.abs(delta) < 0.01) return { label: "Same as last", tone: "neutral" };
  const improved = higherIsBetter ? delta > 0 : delta < 0;
  return {
    label: improved ? "Improved" : "Declined",
    tone: improved ? "up" : "down",
    delta: Math.abs(delta)
  };
}

export default function ProgressDashboard({ sessions = [], localSessions = [], sourceMode = "mock" }) {
  const realSessions = [...localSessions, ...sessions.filter((s) => !localSessions.some((l) => l.session_id === s.session_id))]
    .filter((s) => !s.is_demo)
    .sort((a, b) => (b.ended_at_ms || 0) - (a.ended_at_ms || 0));

  const latest = realSessions[0] || null;
  const previous = realSessions[1] || null;
  const isForwardPress = latest?.exercise === "seated_one_arm_forward_press";

  const scoreTrend = compareMetric(latest?.average_physio_score, previous?.average_physio_score, true);
  const jitterTrend = compareMetric(latest?.average_jitter_score, previous?.average_jitter_score, false);
  const romTrend = isForwardPress
    ? compareMetric(latest?.best_push_depth_cm, previous?.best_push_depth_cm, true)
    : compareMetric(latest?.best_range_of_motion ?? latest?.best_angle, previous?.best_range_of_motion ?? previous?.best_angle, true);

  return (
    <section className="progress-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Your progress</p>
          <h2>Session comparison</h2>
          <p className="muted-sub">Track how your movement quality changes over time.</p>
        </div>
        <div className="heading-pills">
          <span className="status-pill">{realSessions.length ? `${realSessions.length} saved sessions` : "No sessions yet"}</span>
        </div>
      </div>

      {!latest ? (
        <p className="muted-sub">Complete a session and check in with your coach to start building progress history.</p>
      ) : (
        <>
          <div className="progress-compare-grid">
            <CompareCard
              title="Average score"
              value={latest.average_physio_score ?? "—"}
              trend={scoreTrend}
            />
            <CompareCard
              title={isForwardPress ? "Best press depth" : "Best ROM"}
              value={isForwardPress ? `${latest.best_push_depth_cm ?? "—"} cm` : `${latest.best_range_of_motion ?? latest.best_angle ?? "—"}°`}
              trend={romTrend}
            />
            <CompareCard
              title="Average jitter"
              value={latest.average_jitter_score ?? "—"}
              trend={jitterTrend}
            />
            <CompareCard
              title="Reps completed"
              value={`${latest.total_reps ?? 0} / ${latest.rep_goal ?? 3}`}
              trend={{ label: previous ? `Last: ${previous.total_reps ?? 0}` : "First session", tone: "neutral" }}
            />
          </div>

          <div className="progress-trend-cards">
            <TrendCard title="Latest feedback" value={latest.patient_feedback?.classification?.replaceAll("_", " ") || "Not recorded"} />
            <TrendCard title="Next focus" value={latest.therapist_note?.next_focus || latest.gemini_recommendation || latest.recommendation_text || "—"} />
            <TrendCard title="Movement quality" value={latest.therapist_note?.movement_quality || "—"} />
          </div>
        </>
      )}

      {realSessions.length > 0 && (
        <>
          <p className="eyebrow progress-history-label">All sessions</p>
          <div className="progress-session-table">
            <div className="progress-session-head">
              <span>Date</span>
              <span>Exercise</span>
              <span>Reps</span>
              <span>Score</span>
              <span>{isForwardPress ? "Press" : "ROM"}</span>
              <span>Jitter</span>
              <span>vs prior</span>
            </div>
            {realSessions.map((session, index) => {
              const prior = realSessions[index + 1];
              const press = session.exercise === "seated_one_arm_forward_press";
              const sessionScoreTrend = compareMetric(session.average_physio_score, prior?.average_physio_score, true);
              return (
                <div key={session.session_id} className="progress-session-row">
                  <span>{formatDate(session.ended_at_ms)}</span>
                  <span>{exerciseLabel(session.exercise)}</span>
                  <span>{session.total_reps ?? 0}/{session.rep_goal ?? 3}</span>
                  <span>{session.average_physio_score ?? "—"}</span>
                  <span>
                    {press
                      ? `${session.best_push_depth_cm ?? "—"} cm`
                      : `${session.best_range_of_motion ?? session.best_angle ?? "—"}°`}
                  </span>
                  <span>{session.average_jitter_score ?? "—"}</span>
                  <span className={`trend-pill trend-pill--${sessionScoreTrend.tone}`}>
                    {prior ? sessionScoreTrend.label : "Baseline"}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function CompareCard({ title, value, trend }) {
  return (
    <article className="compare-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <em className={`trend-pill trend-pill--${trend.tone}`}>{trend.label}</em>
    </article>
  );
}

function TrendCard({ title, value }) {
  return (
    <article className="trend-card">
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

function formatDate(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function exerciseLabel(id) {
  if (id === "seated_one_arm_forward_press") return "Forward Press";
  if (id === "elbow_flexion_extension") return "Elbow Flexion";
  return id || "Session";
}
