import { Activity, ClipboardCheck, Clock3, Gauge, Repeat2, ShieldCheck, Target, Waves } from "lucide-react";
import MetricCard from "./MetricCard.jsx";

export default function SessionSummary({ summary, aiSummaryText, aiHealthReport, compact = false }) {
  return (
    <section className="summary-panel">
      {!compact && (
        <div className="summary-icon">
          <ClipboardCheck size={20} />
        </div>
      )}
      <div>
        {!compact && <p className="eyebrow">Latest summary</p>}
        {summary ? (
          <>
            <h2>{summary.summary_text}</h2>
            <p>{summary.recommendation_text}</p>
            <div className="ai-summary-box">
              <p className="eyebrow">AI-written session summary</p>
              <strong>{aiSummaryText || summary.recommendation_text}</strong>
            </div>
            {aiHealthReport && (
              <div className="ai-summary-box ai-health-box">
                <p className="eyebrow">AI health observations</p>
                <p>{aiHealthReport}</p>
              </div>
            )}
            <div className="summary-metric-grid">
              <MetricCard icon={Activity} label="Exercise" value={exerciseLabel(summary.exercise)} accent="mint" />
              <MetricCard icon={Clock3} label="Session time" value={formatSummaryMetric(summary.duration_sec, 0)} unit="s" accent="blue" />
              <MetricCard icon={Repeat2} label="Total reps" value={summary.total_reps ?? "--"} accent="coral" />
              <MetricCard icon={ShieldCheck} label="Clean reps" value={summary.clean_reps ?? "--"} accent="mint" />
              <MetricCard icon={Target} label="Best ROM" value={formatSummaryMetric(summary.best_range_of_motion ?? summary.best_angle)} unit="deg" accent="amber" />
              <MetricCard icon={Target} label="Avg ROM" value={formatSummaryMetric(summary.average_range_of_motion ?? summary.average_angle)} unit="deg" accent="amber" />
              <MetricCard icon={Clock3} label="Avg hold" value={formatSummaryMetric(summary.average_hold_time_sec)} unit="s" accent="blue" />
              <MetricCard icon={Gauge} label="Average score" value={summary.average_physio_score ?? "--"} accent="blue" />
              <MetricCard icon={Waves} label="Average jitter" value={formatSummaryMetric(summary.average_jitter_score, 2)} accent="lime" />
            </div>
            {summary.issue_label && <p className="summary-issue">Common issue: <strong>{summary.issue_label}</strong></p>}
            <RepBreakdown reps={summary.completed_reps || []} />
          </>
        ) : (
          <>
            <h2>No completed session yet.</h2>
            <p>End a mock session to save a local JSON summary.</p>
          </>
        )}
      </div>
    </section>
  );
}

function RepBreakdown({ reps }) {
  return (
    <div className="rep-breakdown">
      <div className="rep-breakdown-heading">
        <p className="eyebrow">Rep-by-rep breakdown</p>
        <span>{reps.length} completed</span>
      </div>
      {reps.length ? (
        <div className="rep-breakdown-table">
          <span>Rep</span>
          <span>Time</span>
          <span>Total</span>
          <span>Hold</span>
          <span>ROM</span>
          <span>Score</span>
          <span>Issue</span>
          {reps.map((rep) => (
            <FragmentRow key={rep.rep_index} rep={rep} sessionStartMs={summaryStartMs(reps, rep)} />
          ))}
        </div>
      ) : (
        <p>No completed reps were recorded in this session.</p>
      )}
    </div>
  );
}

function FragmentRow({ rep, sessionStartMs }) {
  return (
    <>
      <strong>#{rep.rep_index}</strong>
      <span>{formatRepWindow(rep, sessionStartMs)}</span>
      <span>{formatSummaryMetric(rep.rep_duration_sec)}s</span>
      <span>{formatSummaryMetric(rep.hold_time_sec)}s</span>
      <span>{formatSummaryMetric(rep.range_of_motion)} deg</span>
      <span>{rep.physio_score ?? "--"}</span>
      <span>{issueLabel(rep.issue)}</span>
    </>
  );
}

function summaryStartMs(reps, fallbackRep) {
  const startValues = reps.map((rep) => rep.started_at_ms).filter((value) => Number.isFinite(value));
  return Math.min(...startValues, fallbackRep.started_at_ms ?? 0);
}

function formatRepWindow(rep, sessionStartMs) {
  if (!Number.isFinite(rep.started_at_ms) || !Number.isFinite(rep.ended_at_ms)) return "--";
  const start = Math.max(0, (rep.started_at_ms - sessionStartMs) / 1000);
  const end = Math.max(start, (rep.ended_at_ms - sessionStartMs) / 1000);
  return `${start.toFixed(1)}-${end.toFixed(1)}s`;
}

function exerciseLabel(id) {
  return id === "elbow_flexion_extension" ? "Elbow Flexion" : id || "--";
}

function issueLabel(issue) {
  return {
    did_not_bend_enough: "bend deeper",
    did_not_hold_long_enough: "hold longer",
    moved_too_fast: "too fast",
    too_jittery: "jittery",
    shoulder_compensation: "upper arm drift",
    low_confidence: "low confidence",
    none: "clean"
  }[issue] || issue || "--";
}

function formatSummaryMetric(value, digits = 1) {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(digits);
}
