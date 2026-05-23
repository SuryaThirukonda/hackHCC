import React, { useEffect, useRef, useState } from "react";
import { getHeyGenVideoStatus, requestHeyGenCoach } from "../../api/sessionRecordingV2Client.js";

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 36; // 3 min max

export default function HeyGenSessionCoach({
  spokenSummary,
  audioUrl,
  sessionId,
  embedHtml,
  enableGeneratedVideo = false,
}) {
  const [videoUrl, setVideoUrl] = useState(null);
  const [heygenStatus, setHeygenStatus] = useState("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [totalSec, setTotalSec] = useState(null);
  const [error, setError] = useState("");
  const requestedRef = useRef(false);
  const startTimeRef = useRef(null);
  const pollTimerRef = useRef(null);
  const elapsedTimerRef = useRef(null);

  useEffect(() => {
    if (!enableGeneratedVideo || !spokenSummary || requestedRef.current) return;
    requestedRef.current = true;
    setHeygenStatus("loading");
    startTimeRef.current = performance.now();

    elapsedTimerRef.current = window.setInterval(() => {
      const sec = Math.round((performance.now() - startTimeRef.current) / 1000);
      setElapsedSec(sec);
    }, 1000);

    requestHeyGenCoach(spokenSummary, audioUrl, sessionId)
      .then((result) => {
        const generateMs = result.generate_time_ms ?? Math.round(performance.now() - startTimeRef.current);
        console.log(`[HeyGen] generate call completed in ${generateMs}ms, status=${result.status}, video_id=${result.avatar_session_id}`);

        if (result.video_url) {
          const totalMs = Math.round(performance.now() - startTimeRef.current);
          console.log(`[HeyGen] video ready immediately — total ${totalMs}ms`);
          setTotalSec(Math.round(totalMs / 1000));
          setVideoUrl(result.video_url);
          setHeygenStatus("ready");
          clearTimers();
          return;
        }

        if (result.avatar_session_id && result.status === "queued") {
          console.log(`[HeyGen] queued video_id=${result.avatar_session_id} — polling every ${POLL_INTERVAL_MS / 1000}s`);
          setHeygenStatus("queued");
          startPolling(result.avatar_session_id);
          return;
        }

        // mock / not configured
        setHeygenStatus(result.status || "unavailable");
        clearTimers();
      })
      .catch((err) => {
        console.error("[HeyGen] generate request failed:", err);
        setError(err.message);
        setHeygenStatus("error");
        clearTimers();
      });

    return () => clearTimers();
  }, [enableGeneratedVideo, spokenSummary, audioUrl, sessionId]);

  function clearTimers() {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
  }

  function startPolling(videoId, attempt = 0) {
    if (attempt >= POLL_MAX_ATTEMPTS) {
      setError("Video generation timed out after 3 minutes.");
      setHeygenStatus("error");
      clearTimers();
      return;
    }

    pollTimerRef.current = window.setTimeout(async () => {
      try {
        const poll = await getHeyGenVideoStatus(videoId);
        console.log(`[HeyGen] poll #${attempt + 1} → status=${poll.status} (${poll.poll_time_ms ?? "?"}ms)`);

        if (poll.status === "completed" && poll.video_url) {
          const totalMs = Math.round(performance.now() - startTimeRef.current);
          const totalSecs = Math.round(totalMs / 1000);
          console.log(`[HeyGen] ✅ video ready after ${totalSecs}s (${attempt + 1} poll${attempt === 0 ? "" : "s"})`);
          setTotalSec(totalSecs);
          setVideoUrl(poll.video_url);
          setHeygenStatus("ready");
          clearTimers();
          return;
        }

        if (poll.status === "failed") {
          const msg = poll.error || "HeyGen video generation failed.";
          console.error("[HeyGen] generation failed:", msg);
          setError(msg);
          setHeygenStatus("error");
          clearTimers();
          return;
        }

        startPolling(videoId, attempt + 1);
      } catch (err) {
        console.error("[HeyGen] poll request failed:", err);
        startPolling(videoId, attempt + 1);
      }
    }, POLL_INTERVAL_MS);
  }

  // LiveAvatar embed takes priority
  if (embedHtml) {
    return (
      <div className="heygen-coach-panel">
        <div className="embed-header">
          <span className="coach-label">Your Coach</span>
        </div>
        <div className="liveavatar-embed" dangerouslySetInnerHTML={{ __html: embedHtml }} />
      </div>
    );
  }

  // Video ready
  if (heygenStatus === "ready" && videoUrl) {
    return (
      <div className="heygen-coach-panel heygen-coach-panel--video">
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

  // Loading — clean standalone spinner
  const isLoading = heygenStatus === "loading" || heygenStatus === "queued";
  if (isLoading) {
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

  // Error
  if (heygenStatus === "error") {
    return (
      <div className="heygen-coach-panel companion-fallback">
        <p className="error-text" style={{ fontSize: "0.75rem" }}>
          {error || "Coach video unavailable."}
        </p>
      </div>
    );
  }

  // Not configured / mock — don't render anything distracting
  if (heygenStatus !== "idle") {
    return (
      <div className="heygen-coach-panel companion-fallback">
        <p className="muted-sub" style={{ fontSize: "0.75rem" }}>
          Coach video not configured — restart the backend with <code>AVATAR_PROVIDER=heygen</code>.
        </p>
      </div>
    );
  }

  return null;
}
