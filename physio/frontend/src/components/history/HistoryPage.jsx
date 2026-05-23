import React, { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import SessionSummaryStep from "../results/SessionSummaryStep.jsx";
import SessionReplayOverlay from "../results/SessionReplayOverlay.jsx";

function RefreshIcon({ spinning }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, animation: spinning ? "spin 0.8s linear infinite" : "none" }}
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function exerciseLabelShort(id) {
  return {
    elbow_flexion_extension: "Elbow Flexion",
    seated_one_arm_forward_press: "Forward Press",
  }[id] || id || "—";
}

function issueShort(issue) {
  return {
    did_not_bend_enough: "bend deeper",
    short_push_depth: "short press",
    did_not_hold_long_enough: "hold longer",
    moved_too_fast: "too fast",
    too_jittery: "jittery",
    shoulder_compensation: "arm drift",
    low_confidence: "tracking",
    none: "clean",
  }[issue] ?? issue ?? "—";
}

function resolveSessionRecording(session, presentationCaches) {
  const cache = presentationCaches?.[session?.session_id];
  if (!cache) return null;
  return cache.replay_graph || cache.recording || null;
}

function historyReplayReps(session, recording) {
  if (recording?.reps?.length) return recording.reps;
  if (!Array.isArray(session?.completed_reps)) return [];
  return session.completed_reps.map((rep) => ({
    rep_number: rep.rep_index,
    rep_index: rep.rep_index,
    physio_score: rep.physio_score,
    jitter_score: rep.jitter_score,
    issue: rep.issue,
    issue_label: rep.issue,
    clean: rep.clean ?? rep.issue === "none",
  }));
}

function resolveFeaturedPresentation({
  featuredSession,
  summary,
  presentationCaches,
  geminiSessionAnalysis,
  geminiSessionStatus,
  geminiSessionError,
  geminiAnalysisCache,
  sessionRecording,
  finalAnalysisPacket,
}) {
  if (!featuredSession) return null;

  const isLive = summary?.session_id === featuredSession.session_id;
  const cache = presentationCaches?.[featuredSession.session_id];

  if (isLive) {
    return {
      sessionId: featuredSession.session_id,
      summary: featuredSession,
      geminiResult: geminiSessionAnalysis,
      geminiStatus: geminiSessionStatus,
      geminiError: geminiSessionError,
      geminiCache: geminiAnalysisCache?.session_id === featuredSession.session_id ? geminiAnalysisCache : null,
      recording: sessionRecording || cache?.replay_graph || cache?.recording || null,
      finalAnalysisPacket,
    };
  }

  if (!cache) {
    return {
      sessionId: featuredSession.session_id,
      summary: featuredSession,
      geminiResult: null,
      geminiStatus: "idle",
      geminiError: "",
      geminiCache: null,
      recording: null,
      finalAnalysisPacket: null,
    };
  }

  return {
    sessionId: featuredSession.session_id,
    summary: cache.summary || featuredSession,
    geminiResult: cache.gemini_result || null,
    geminiStatus: cache.gemini_status || (cache.gemini_result ? "ready" : "idle"),
    geminiError: cache.gemini_error || "",
    geminiCache: cache.gemini_cache || null,
    recording: cache.replay_graph || cache.recording || null,
    finalAnalysisPacket: cache.final_analysis_packet || null,
  };
}

function HistoryCard({ session, presentationCaches, expanded, onToggle }) {
  const date = session.ended_at_ms
    ? new Date(session.ended_at_ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "—";
  const time = session.ended_at_ms
    ? new Date(session.ended_at_ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "";

  const bestRom = session.best_range_of_motion ?? session.best_angle;
  const avgRom = session.average_range_of_motion ?? session.average_angle;
  const isForwardPressSession = session.exercise === "seated_one_arm_forward_press";
  const bestPushDepth = session.best_push_depth_cm;
  const recording = resolveSessionRecording(session, presentationCaches);
  const replayReps = historyReplayReps(session, recording);

  return (
    <div className={`history-card${expanded ? " history-card--open" : ""}`}>
      <button type="button" className="history-card-row" onClick={onToggle}>
        <div className="history-card-date">
          <span className="history-date-main">{date}</span>
          <span className="history-date-time">{time}</span>
        </div>
        <div className="history-card-exercise">{exerciseLabelShort(session.exercise)}</div>
        <div className="history-card-stat">
          <span className="hstat-value">{session.total_reps ?? "—"}</span>
          <span className="hstat-label">reps</span>
        </div>
        <div className="history-card-stat">
          <span className="hstat-value">
            {isForwardPressSession && Number.isFinite(bestPushDepth)
              ? bestPushDepth.toFixed(0)
              : Number.isFinite(bestRom) ? bestRom.toFixed(0) : "—"}
          </span>
          <span className="hstat-label">{isForwardPressSession ? "best cm" : "best ROM°"}</span>
        </div>
        <div className="history-card-stat">
          <span className="hstat-value">{session.average_physio_score ?? "—"}</span>
          <span className="hstat-label">score</span>
        </div>
        <div className="history-card-stat">
          <span className="hstat-value">{session.duration_sec ?? "—"}</span>
          <span className="hstat-label">sec</span>
        </div>
        <span className="history-chevron">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="history-card-detail">
          {session.recommendation_text && (
            <p className="hdetail-blurb">{session.recommendation_text}</p>
          )}

          <div className="hdetail-replay">
            <SessionReplayOverlay samples={recording?.samples || []} reps={replayReps} />
          </div>

          <div className="hdetail-stat-grid">
            <div className="hdetail-stat">
              <span className="hds-label">Exercise</span>
              <span className="hds-value">{exerciseLabelShort(session.exercise)}</span>
            </div>
            <div className="hdetail-stat">
              <span className="hds-label">Duration</span>
              <span className="hds-value">{session.duration_sec ?? "—"}<small> s</small></span>
            </div>
            <div className="hdetail-stat">
              <span className="hds-label">Total reps</span>
              <span className="hds-value">{session.total_reps ?? "—"}</span>
            </div>
            <div className="hdetail-stat">
              <span className="hds-label">Clean reps</span>
              <span className="hds-value">{session.clean_reps ?? "—"}</span>
            </div>
            <div className="hdetail-stat">
              <span className="hds-label">{isForwardPressSession ? "Best press" : "Best ROM"}</span>
              <span className="hds-value">
                {isForwardPressSession && Number.isFinite(bestPushDepth)
                  ? bestPushDepth.toFixed(1)
                  : Number.isFinite(bestRom) ? bestRom.toFixed(1) : "—"}
                <small>{isForwardPressSession ? " cm" : "°"}</small>
              </span>
            </div>
            <div className="hdetail-stat">
              <span className="hds-label">{isForwardPressSession ? "Avg press" : "Avg ROM"}</span>
              <span className="hds-value">
                {isForwardPressSession && Number.isFinite(session.average_push_depth_cm)
                  ? session.average_push_depth_cm.toFixed(1)
                  : Number.isFinite(avgRom) ? avgRom.toFixed(1) : "—"}
                <small>{isForwardPressSession ? " cm" : "°"}</small>
              </span>
            </div>
            <div className="hdetail-stat">
              <span className="hds-label">Avg hold</span>
              <span className="hds-value">{Number.isFinite(session.average_hold_time_sec) ? session.average_hold_time_sec.toFixed(1) : "—"}<small> s</small></span>
            </div>
            <div className="hdetail-stat">
              <span className="hds-label">Score</span>
              <span className="hds-value">{session.average_physio_score ?? "—"}</span>
            </div>
            <div className="hdetail-stat">
              <span className="hds-label">Avg jitter</span>
              <span className="hds-value">{Number.isFinite(session.average_jitter_score) ? session.average_jitter_score.toFixed(2) : "—"}</span>
            </div>
          </div>

          {Array.isArray(session.completed_reps) && session.completed_reps.length > 0 && (
            <div className="hdetail-reps">
              <p className="eyebrow hdetail-reps-heading">Rep-by-rep breakdown</p>
              <div className="hdetail-rep-table">
                <span className="hdr-head">Rep</span>
                <span className="hdr-head">{isForwardPressSession ? "Press cm" : "ROM°"}</span>
                <span className="hdr-head">Hold</span>
                <span className="hdr-head">Duration</span>
                <span className="hdr-head">Score</span>
                <span className="hdr-head">Pace</span>
                <span className="hdr-head">Issue</span>
                {session.completed_reps.map((rep) => (
                  <React.Fragment key={rep.rep_index}>
                    <span className="hdr-num">#{rep.rep_index}</span>
                    <span>
                      {isForwardPressSession && Number.isFinite(rep.push_depth_cm)
                        ? rep.push_depth_cm.toFixed(1)
                        : Number.isFinite(rep.range_of_motion) ? rep.range_of_motion.toFixed(0) : "—"}
                    </span>
                    <span>{Number.isFinite(rep.hold_time_sec) ? `${rep.hold_time_sec.toFixed(1)}s` : "—"}</span>
                    <span>{Number.isFinite(rep.rep_duration_sec) ? `${rep.rep_duration_sec.toFixed(1)}s` : "—"}</span>
                    <span className={rep.physio_score >= 70 ? "hdr-good" : rep.physio_score >= 50 ? "hdr-ok" : "hdr-bad"}>{rep.physio_score ?? "—"}</span>
                    <span>{rep.pace || "—"}</span>
                    <span className={rep.issue === "none" ? "hdr-clean" : "hdr-issue"}>{issueShort(rep.issue)}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HistoryPage({
  summary,
  selectedExercise,
  sessionResults,
  sessions,
  presentationCaches,
  geminiSessionAnalysis,
  geminiSessionStatus,
  geminiSessionError,
  geminiAnalysisCache,
  sessionRecording,
  finalAnalysisPacket,
  onRefresh,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const dbRows = useMemo(() => {
    const rows = sessionResults.length > 0 ? sessionResults : sessions;
    return [...rows].sort((a, b) => (b.ended_at_ms || 0) - (a.ended_at_ms || 0));
  }, [sessionResults, sessions]);

  const featuredSession = dbRows[0] || null;
  const historyRows = dbRows.slice(1);

  const featuredPresentation = resolveFeaturedPresentation({
    featuredSession,
    summary,
    presentationCaches,
    geminiSessionAnalysis,
    geminiSessionStatus,
    geminiSessionError,
    geminiAnalysisCache,
    sessionRecording,
    finalAnalysisPacket,
  });

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {
      // ignore
    }
    setRefreshing(false);
  }

  return (
    <div className="results-page history-page">
      <div className="results-page-header">
        <div>
          <p className="eyebrow">Saved sessions</p>
          <h2>Session history</h2>
          <p className="muted-sub">
            Most recent replay and analysis from SQLite. Gemini when available; local metrics otherwise.
          </p>
        </div>
        <button
          type="button"
          className="refresh-btn"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshIcon spinning={refreshing} />
          {refreshing ? "Loading…" : "Refresh"}
        </button>
      </div>

      {!featuredSession ? (
        <section className="empty-state">
          <FileText size={34} />
          <h2>No saved sessions yet.</h2>
          <p>
            Complete {selectedExercise?.name || "a session"} and tap Refresh to load tracked sessions from the database.
          </p>
          <button type="button" className="secondary-btn" onClick={handleRefresh} disabled={refreshing}>
            <RefreshIcon spinning={refreshing} />
            {refreshing ? "Loading…" : "Refresh from database"}
          </button>
        </section>
      ) : (
        <>
          {featuredPresentation && (
            <section className="history-featured">
              <div className="session-history-heading">
                <p className="eyebrow">Most recent</p>
                <span className="history-count">
                  {featuredSession.ended_at_ms
                    ? new Date(featuredSession.ended_at_ms).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                    : "Latest session"}
                </span>
              </div>
              <SessionSummaryStep
                summary={featuredPresentation.summary}
                geminiResult={featuredPresentation.geminiResult}
                geminiStatus={featuredPresentation.geminiStatus}
                geminiError={featuredPresentation.geminiError}
                sessionId={featuredPresentation.sessionId}
                recording={featuredPresentation.recording}
                showFlowActions={false}
                voiceFinished
              />
            </section>
          )}

          {historyRows.length > 0 && (
            <section className="session-history">
              <div className="session-history-heading">
                <p className="eyebrow">Earlier sessions</p>
                <span className="history-count">
                  {historyRows.length} previous {historyRows.length === 1 ? "session" : "sessions"}
                </span>
              </div>
              <div className="history-list">
                {historyRows.map((sess) => (
                  <HistoryCard
                    key={sess.session_id}
                    session={sess}
                    presentationCaches={presentationCaches}
                    expanded={expandedId === sess.session_id}
                    onToggle={() => setExpandedId(expandedId === sess.session_id ? null : sess.session_id)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
