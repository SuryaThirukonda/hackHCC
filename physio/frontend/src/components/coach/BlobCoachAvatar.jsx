import React from "react";

/**
 * Animated black blob avatar.
 * States: idle | thinking | speaking
 * Sizes: sm (floating companion) | md (inline panels)
 */
export default function BlobCoachAvatar({ status = "idle", size = "md" }) {
  const statusClass =
    status === "speaking" ? "blob-coach--speaking"
    : status === "thinking" ? "blob-coach--thinking"
    : status === "loading" ? "blob-coach--thinking"
    : "";

  return (
    <div
      className={`blob-coach blob-coach--${size} ${statusClass}`}
      aria-hidden="true"
    >
      <div className="blob-coach__glow" />
      <div className="blob-coach__shape">
        <div className="blob-coach__core" />
      </div>
      {(status === "speaking" || status === "playing") && (
        <div className="blob-coach__waves">
          <span /><span /><span />
        </div>
      )}
    </div>
  );
}
