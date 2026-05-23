import React, { useEffect, useRef, useState } from "react";
import { requestHeyGenCoach } from "../../api/sessionRecordingV2Client.js";

/**
 * HeyGenSessionCoach
 *
 * Primary display: LiveAvatar embed (from /api/presentation/v2/status embed_html).
 * Secondary: HeyGen async video generation if AVATAR_PROVIDER=heygen.
 * Fallback: Static companion card if both are unavailable.
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
  const [error, setError] = useState("");
  const requestedRef = useRef(false);

  // Request HeyGen video in background (non-blocking)
  useEffect(() => {
    if (!enableGeneratedVideo || !spokenSummary || requestedRef.current) return;
    requestedRef.current = true;
    setHeygenStatus("loading");

    requestHeyGenCoach(spokenSummary, audioUrl, sessionId)
      .then((result) => {
        if (result.video_url) {
          setVideoUrl(result.video_url);
          setHeygenStatus("ready");
        } else {
          // embed_only or mock — just use embed
          setHeygenStatus(result.status || "embed_only");
        }
      })
      .catch((err) => {
        setError(err.message);
        setHeygenStatus("error");
      });
  }, [enableGeneratedVideo, spokenSummary, audioUrl, sessionId]);

  // LiveAvatar embed takes priority
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

  // HeyGen async video ready
  if (heygenStatus === "ready" && videoUrl) {
    return (
      <div className="heygen-coach-panel">
        <div className="embed-header">
          <span className="coach-label">Session Coach</span>
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

  // Fallback companion card
  return (
    <div className="heygen-coach-panel companion-fallback">
      <div className="companion-avatar">
        <div className="avatar-circle">
          <span className="avatar-icon">🧑‍⚕️</span>
        </div>
        <span className="coach-label">Your Coach</span>
      </div>
      {heygenStatus === "loading" && (
        <p className="muted loading-hint">
          <span className="spinner" /> Coach video loading…
        </p>
      )}
      {heygenStatus === "error" && error && (
        <p className="error-text" style={{ fontSize: "0.75rem" }}>{error}</p>
      )}
    </div>
  );
}
