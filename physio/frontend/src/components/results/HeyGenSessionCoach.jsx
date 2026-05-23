import React, { useEffect, useRef, useState } from "react";
import { getHeyGenVideoStatus, requestHeyGenCoach } from "../../api/sessionRecordingV2Client.js";

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 36; // 3 min max

/**
 * HeyGenSessionCoach
 *
 * Renders a HeyGen avatar video in the session results.
 * Flow: POST generate → get video_id (queued) → poll status every 5s → play when completed.
 * Logs timing to console for verification.
 */
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

    // Live elapsed seconds counter so the user sees progress
    elapsedTimerRef.current = window.setInterval(() => {
      const sec = Math.round((performance.now() - startTimeRef.current) / 1000);
      setElapsedSec(sec);
    }, 1000);

    requestHeyGenCoach(spokenSummary, audioUrl, sessionId)
      .then((result) => {
        const generateMs = result.generate_time_ms ?? Math.round(performance.now() - startTimeRef.current);
        console.log(`[HeyGen] generate call completed in ${generateMs}ms, status=${result.status}, video_id=${result.avatar_session_id}`);

        // Immediately available (rare — only if HeyGen returns a URL synchronously)
        if (result.video_url) {
          const totalMs = Math.round(performance.now() - startTimeRef.current);
          console.log(`[HeyGen] video ready immediately — total ${totalMs}ms`);
          setTotalSec(Math.round(totalMs / 1000));
          setVideoUrl(result.video_url);
          setHeygenStatus("ready");
          clearTimers();
          return;
        }

        // Queued — start polling
        if (result.avatar_session_id && result.status === "queued") {
          console.log(`[HeyGen] queued video_id=${result.avatar_session_id} — starting poll every ${POLL_INTERVAL_MS / 1000}s`);
          startPolling(result.avatar_session_id);
          return;
        }

        // Mock / missing config — not an error, just no video
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
          console.log(`[HeyGen] ✅ video ready after ${totalSecs}s total (${attempt + 1} poll${attempt === 0 ? "" : "s"})`);
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

        // Still pending/processing — keep polling
        startPolling(videoId, attempt + 1);
      } catch (err) {
        console.error("[HeyGen] poll request failed:", err);
        startPolling(videoId, attempt + 1);
      }
    }, POLL_INTERVAL_MS);
  }

  // LiveAvatar embed takes priority only when both are present
  if (embedHtml) {
    return (
      <div className="heygen-coach-panel">
        <div className="embed-header">
          <span className="coach-label">Your Coach</span>
        </div>
        <div
          className="liveavatar-embed"
          dangerouslySetInnerHTML={{ __html: embedHtml }}
        />
      </div>
    );
  }

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
        <video
          className="heygen-video"
          src={videoUrl}
          autoPlay
          playsInline
          controls
        />
      </div>
    );
  }

  // Loading / fallback card
  const isLoading = heygenStatus === "loading" || heygenStatus === "queued";
  return (
    <div className="heygen-coach-panel companion-fallback">
      <div className="companion-avatar">
        <div className="avatar-circle">
          <span className="avatar-icon">🧑‍⚕️</span>
        </div>
        <span className="coach-label">Coach video</span>
      </div>
      {isLoading && (
        <div className="heygen-loading-state">
          <p className="muted">
            <span className="spinner" /> Generating your coach video…
          </p>
          <p className="heygen-elapsed muted-sub">
            {elapsedSec > 0 ? `${elapsedSec}s elapsed` : "Submitting to HeyGen…"}
          </p>
          <p className="heygen-loading-note muted-sub">
            Avatar videos typically take 30–90 seconds to render.
          </p>
        </div>
      )}
      {heygenStatus === "error" && (
        <p className="error-text" style={{ fontSize: "0.75rem" }}>
          {error || "Coach video unavailable."}
        </p>
      )}
      {!isLoading && heygenStatus !== "error" && heygenStatus !== "idle" && (
        <p className="muted-sub" style={{ fontSize: "0.75rem" }}>
          Coach video not available ({heygenStatus}).
        </p>
      )}
    </div>
  );
}
