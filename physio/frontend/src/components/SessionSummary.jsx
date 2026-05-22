import { ClipboardCheck } from "lucide-react";

export default function SessionSummary({ summary }) {
  return (
    <section className="summary-panel">
      <div className="summary-icon">
        <ClipboardCheck size={20} />
      </div>
      <div>
        <p className="eyebrow">Latest summary</p>
        {summary ? (
          <>
            <h2>{summary.summary_text}</h2>
            <p>{summary.recommendation_text}</p>
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
