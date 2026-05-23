import React from "react";
import BlobCoachAvatar from "./BlobCoachAvatar.jsx";

/**
 * Persistent floating coach — black blob + speech bubble, all pages.
 */
export default function BlobCoachCompanion({
  message = "",
  status = "idle",
  minimized = false,
  onToggleMinimize,
  label = "Your coach",
}) {
  const speaking = status === "speaking";

  return (
    <div
      className={`blob-companion-float${minimized ? " blob-companion-float--minimized" : ""}`}
      aria-live="polite"
    >
      {!minimized && message && (
        <div className={`blob-companion-speech${speaking ? " blob-companion-speech--speaking" : ""}`}>
          <span className="blob-companion-label">{label}</span>
          <p>{message}</p>
        </div>
      )}

      <button
        type="button"
        className="blob-companion-toggle"
        onClick={onToggleMinimize}
        aria-label={minimized ? "Expand coach" : "Minimize coach"}
        title={minimized ? "Show coach" : "Hide coach"}
      >
        <BlobCoachAvatar status={status} size="sm" />
      </button>
    </div>
  );
}
