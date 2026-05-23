import React, { memo, useEffect, useRef } from "react";

/**
 * Mount LiveAvatar/HeyGen embed HTML once per mountKey.
 * Remount when mountKey changes so a synced LiveAvatar context applies to a new chat session.
 */
function LiveAvatarEmbed({ html, mountKey = "default" }) {
  const containerRef = useRef(null);
  const mountedRef = useRef({ html: "", mountKey: "" });

  useEffect(() => {
    if (!html || !containerRef.current) return;
    if (mountedRef.current.html === html && mountedRef.current.mountKey === mountKey) return;
    containerRef.current.innerHTML = html;
    mountedRef.current = { html, mountKey };
  }, [html, mountKey]);

  if (!html) return null;

  return <div ref={containerRef} className="liveavatar-embed" key={mountKey} />;
}

export default memo(LiveAvatarEmbed);
