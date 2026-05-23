import React, { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import { getHeyGenVideoStatus, requestHeyGenCoach } from "../../api/sessionRecordingV2Client.js";
import LiveAvatarEmbed from "./LiveAvatarEmbed.jsx";
import { buildCoachSessionContext } from "../../analysis/coach/buildCoachSessionContext.js";

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 36;

function describeUnavailableStatus(status, errorMessage) {
  if (status === "mock_missing_heygen_key") {
    return "HeyGen API key or avatar ID is missing. Check HEYGEN_API_KEY and HEYGEN_AVATAR_ID in physio/.env.";
  }
  if (status === "mock_heygen_error") {
    return errorMessage || "HeyGen video generation failed. Check backend logs for details.";
  }
  if (status === "unavailable") {
    return "HeyGen is not active on the backend (AVATAR_PROVIDER != heygen).";
  }
  return errorMessage || "Coach video unavailable.";
}

function CoachContextBrief({ coachContext, contextApplied, setupHint, syncReason, onCopyBriefing }) {
  const [copied, setCopied] = useState(false);
  if (!coachContext?.brief_lines?.length) return null;

  async function handleCopy() {
    const text = coachContext.chat_briefing || coachContext.opening_message;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopyBriefing?.(text);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be blocked; ignore.
    }
  }

  return (
    <div className={`coach-context-brief${contextApplied ? " coach-context-brief--synced" : " coach-context-brief--pending"}`}>
      <p className="eyebrow">Session context for your coach</p>
      <ul>
        {coachContext.brief_lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {contextApplied ? (
        <p className="coach-context-status coach-context-status--ok">
          LiveAvatar context synced for this session. Click <strong>Chat now</strong> below to start a fresh conversation.
        </p>
      ) : (
        <>
          <p className="coach-context-status coach-context-status--warn">
            The video coach cannot see this panel automatically yet. ElevenLabs voice uses it, but the LiveAvatar iframe needs a LiveAvatar API key.
          </p>
          {setupHint && <p className="muted-sub">{setupHint}</p>}
          {!setupHint && (
            <p className="muted-sub">
              Add <code>LIVEAVATAR_API_KEY</code> and <code>LIVEAVATAR_CONTEXT_ID</code> from app.liveavatar.com/contexts to physio/.env, then reload.
            </p>
          )}
          {syncReason === "missing_liveavatar_api_key" && (
            <p className="muted-sub">HeyGen API keys do not work for LiveAvatar context — use a separate key from app.liveavatar.com.</p>
          )}
          <div className="coach-context-actions">
            <button type="button" className="secondary-btn" onClick={handleCopy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Copied briefing" : "Copy briefing for Chat now"}
            </button>
            <span className="muted-sub">Paste this as your first message inside the video coach if context sync is not configured.</span>
          </div>
        </>
      )}
    </div>
  );
}

export default function HeyGenSessionCoach({
  spokenSummary,
  audioUrl,
  sessionId,
  exercise,
  summary,
  geminiAnalysis,
  embedHtml: embedHtmlProp,
  enableGeneratedVideo = false,
  showContextBrief = true,
}) {
  const coachContext = useMemo(
    () => buildCoachSessionContext({ exercise, summary, geminiAnalysis, sessionId }),
    [exercise, summary, geminiAnalysis, sessionId]
  );
  const [embedHtml, setEmbedHtml] = useState(embedHtmlProp || "");
  const [embedMountKey, setEmbedMountKey] = useState("pending");
  const [contextApplied, setContextApplied] = useState(false);
  const [setupHint, setSetupHint] = useState("");
  const [syncReason, setSyncReason] = useState("");
  const [videoUrl, setVideoUrl] = useState(null);
  const [coachMode, setCoachMode] = useState("init");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [totalSec, setTotalSec] = useState(null);
  const [error, setError] = useState("");
  const initRef = useRef(false);
  const startTimeRef = useRef(null);
  const pollTimerRef = useRef(null);
  const elapsedTimerRef = useRef(null);

  useEffect(() => {
    if (embedHtmlProp) setEmbedHtml(embedHtmlProp);
  }, [embedHtmlProp]);

  useEffect(() => {
    initRef.current = false;
    setCoachMode("init");
    setEmbedHtml(embedHtmlProp || "");
    setEmbedMountKey("pending");
    setContextApplied(false);
    setSetupHint("");
    setSyncReason("");
    setVideoUrl(null);
    setError("");
  }, [sessionId, embedHtmlProp]);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    let cancelled = false;

    async function bootstrap() {
      setCoachMode("init");
      try {
        const result = await requestHeyGenCoach({
          spokenSummary: spokenSummary || coachContext.spoken_intro,
          audioUrl,
          sessionId,
          exercise,
          summary,
          geminiAnalysis,
        });
        if (cancelled) return;

        const synced = Boolean(result.context_applied);
        setContextApplied(synced);
        setSetupHint(result.setup_hint || "");
        setSyncReason(result.context_sync_reason || "");
        setEmbedMountKey(result.embed_mount_key || `${sessionId || "coach"}-${synced ? "synced" : "static"}`);

        if (result.embed_html) {
          setEmbedHtml(result.embed_html);
          setCoachMode("embed");
          return;
        }

        if (!enableGeneratedVideo || !(spokenSummary || coachContext.spoken_intro)) {
          setCoachMode("idle");
          return;
        }

        setCoachMode("generating");
        startTimeRef.current = performance.now();
        elapsedTimerRef.current = window.setInterval(() => {
          setElapsedSec(Math.round((performance.now() - startTimeRef.current) / 1000));
        }, 1000);

        if (result.video_url) {
          setTotalSec(Math.round((performance.now() - startTimeRef.current) / 1000));
          setVideoUrl(result.video_url);
          setCoachMode("ready");
          clearTimers();
          return;
        }

        if (result.avatar_session_id && result.status === "queued") {
          setCoachMode("generating");
          startPolling(result.avatar_session_id);
          return;
        }

        setError(describeUnavailableStatus(result.status, result.error_message_sanitized));
        setCoachMode("error");
        clearTimers();
      } catch (err) {
        if (cancelled) return;
        setError(err.message || "Coach video request failed.");
        setCoachMode("error");
        clearTimers();
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
      clearTimers();
    };
  }, [enableGeneratedVideo, spokenSummary, audioUrl, sessionId, exercise, summary, geminiAnalysis, coachContext.spoken_intro]);

  function clearTimers() {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    pollTimerRef.current = null;
    elapsedTimerRef.current = null;
  }

  function startPolling(videoId, attempt = 0) {
    if (attempt >= POLL_MAX_ATTEMPTS) {
      setError("Video generation timed out after 3 minutes.");
      setCoachMode("error");
      clearTimers();
      return;
    }

    pollTimerRef.current = window.setTimeout(async () => {
      try {
        const poll = await getHeyGenVideoStatus(videoId);
        if (poll.status === "completed" && poll.video_url) {
          setTotalSec(Math.round((performance.now() - startTimeRef.current) / 1000));
          setVideoUrl(poll.video_url);
          setCoachMode("ready");
          clearTimers();
          return;
        }
        if (poll.status === "failed") {
          setError(poll.error || "HeyGen video generation failed.");
          setCoachMode("error");
          clearTimers();
          return;
        }
        startPolling(videoId, attempt + 1);
      } catch {
        startPolling(videoId, attempt + 1);
      }
    }, POLL_INTERVAL_MS);
  }

  const contextBrief = showContextBrief ? (
    <CoachContextBrief
      coachContext={coachContext}
      contextApplied={contextApplied}
      setupHint={setupHint}
      syncReason={syncReason}
    />
  ) : null;

  if (coachMode === "embed" && embedHtml) {
    return (
      <div className="heygen-coach-panel">
        {contextBrief}
        <div className="embed-header">
          <span className="coach-label">Your Coach</span>
        </div>
        <LiveAvatarEmbed html={embedHtml} mountKey={embedMountKey} />
      </div>
    );
  }

  if (coachMode === "ready" && videoUrl) {
    return (
      <div className="heygen-coach-panel heygen-coach-panel--video">
        {contextBrief}
        <div className="heygen-video-header">
          <span className="coach-label">Coach review</span>
          {totalSec != null && (
            <span className="heygen-timing-badge" title="Time from request to ready">
              Ready in {totalSec}s
            </span>
          )}
        </div>
        <video className="heygen-video" src={videoUrl} autoPlay playsInline controls />
      </div>
    );
  }

  if (coachMode === "generating") {
    return (
      <div className="heygen-loading-panel">
        <div className="heygen-spinner-ring" />
        <p className="heygen-loading-label">Generating coach video…</p>
        <p className="heygen-elapsed-label">
          {elapsedSec > 0 ? `${elapsedSec}s` : "Submitting…"}
          <span className="heygen-elapsed-note"> · usually 30–90s</span>
        </p>
      </div>
    );
  }

  if (coachMode === "error") {
    return (
      <div className="heygen-coach-panel companion-fallback">
        {contextBrief}
        <p className="error-text" style={{ fontSize: "0.75rem" }}>
          {error || "Coach video unavailable."}
        </p>
      </div>
    );
  }

  if (coachMode === "init") {
    return (
      <div className="heygen-coach-panel heygen-coach-panel--placeholder">
        {contextBrief}
        <div className="embed-header">
          <span className="coach-label">Your Coach</span>
        </div>
        <p className="muted-sub">Syncing coach context…</p>
        <div className="liveavatar-embed liveavatar-embed--placeholder" aria-hidden="true" />
      </div>
    );
  }

  return null;
}
