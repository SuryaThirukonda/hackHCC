import { Bot, CheckCircle2, ShieldCheck, Target } from "lucide-react";

function statusLabel(status) {
  return {
    idle: "idle",
    loading: "loading",
    ready: "ready",
    fallback: "local fallback",
    error: "error"
  }[status] || status || "idle";
}

export default function GeminiSessionAnalysisPanel({
  packet,
  result,
  geminiResult,
  status = "idle",
  error = "",
  localRecommendation = "",
  cachedResult = null
}) {
  const resolvedResult = result || geminiResult || cachedResult?.result || null;
  const analysis = resolvedResult?.analysis || null;
  const local = packet?.local_summary || {};
  const cachedAt = cachedResult?.cached_at_ms
    ? new Date(cachedResult.cached_at_ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  return (
    <section className="gemini-session-panel">
      <div className="gemini-session-heading">
        <div>
          <p className="eyebrow">Post-session AI analysis</p>
          <h2>Gemini summary</h2>
        </div>
        <span className={`ai-status ai-status-${status === "error" ? "error" : status === "loading" ? "loading" : "ready"}`}>
          {statusLabel(status)}
        </span>
      </div>

      <div className="gemini-session-grid">
        <article>
          <Bot size={18} />
          <p className="eyebrow">Written summary</p>
          <strong>{analysis?.written_summary || local.summary_text || "End a session to generate analysis."}</strong>
        </article>
        <article>
          <CheckCircle2 size={18} />
          <p className="eyebrow">What went well</p>
          <strong>{analysis?.what_went_well || "Local metrics will appear here after the session."}</strong>
        </article>
        <article>
          <Target size={18} />
          <p className="eyebrow">Focus next time</p>
          <strong>{analysis?.focus_next_time || local.recommendation_text || localRecommendation || "--"}</strong>
        </article>
        <article>
          <ShieldCheck size={18} />
          <p className="eyebrow">Safety note</p>
          <strong>{analysis?.safety_note || "Follow your therapist's plan."}</strong>
        </article>
      </div>

      <div className="ai-summary-box">
        <p className="eyebrow">Spoken summary text for Person B/C</p>
        <strong>{analysis?.spoken_summary || local.recommendation_text || localRecommendation || "--"}</strong>
        {(resolvedResult?.provider || cachedAt) && (
          <span className="ai-cache-note">
            {resolvedResult?.provider ? `Provider: ${resolvedResult.provider}` : "Provider: local"}
            {cachedAt ? ` | Cached ${cachedAt}` : ""}
          </span>
        )}
      </div>
      {(resolvedResult || cachedResult) && (
        <details className="gemini-raw-output">
          <summary>Cached Gemini response JSON</summary>
          <pre>{JSON.stringify(cachedResult || resolvedResult, null, 2)}</pre>
        </details>
      )}
      {(analysis?.bonus_rep_suggestion || analysis?.return_suggestion) && (
        <div className="gemini-session-footer">
          {analysis.bonus_rep_suggestion && <span>{analysis.bonus_rep_suggestion}</span>}
          {analysis.return_suggestion && <span>{analysis.return_suggestion}</span>}
        </div>
      )}
      {error && <p className="coach-error">{error}</p>}
    </section>
  );
}
