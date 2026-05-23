export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = payload.detail || "";
    } catch {
      detail = "";
    }
    throw new Error(detail || `${options.method || "GET"} ${path} failed: ${response.status}`);
  }
  return response.json();
}

export function getHealth() {
  return request("/api/health");
}

export function startSession(payload) {
  return request("/api/session/start", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getLatestPacket(source = "python") {
  return request(`/api/live/latest?source=${encodeURIComponent(source)}`);
}

export function getLiveSource() {
  return request("/api/live/source");
}

export function getVisionFrameUrl(tick = Date.now()) {
  return `${API_BASE}/api/vision/frame?t=${tick}`;
}

export function postPacket(packet) {
  return request("/api/packets", {
    method: "POST",
    body: JSON.stringify(packet)
  });
}

export function getCoachCue(packet) {
  return request("/api/coach/cue", {
    method: "POST",
    body: JSON.stringify(packet)
  });
}

export function getCoachProviderStatus() {
  return request("/api/coach/provider-status");
}

export function generateGeminiCoachCue(packet) {
  return request("/api/ai/gemini-coach", {
    method: "POST",
    body: JSON.stringify({ mode: "live_coaching", packet })
  });
}

export function generateGeminiSessionSummary(summary) {
  return request("/api/ai/session-summary", {
    method: "POST",
    body: JSON.stringify({ summary })
  });
}

export function generateElevenLabsSpeech(text) {
  return request("/api/ai/elevenlabs-tts", {
    method: "POST",
    body: JSON.stringify({ text })
  });
}

export function getCoachWebSocketUrl() {
  const url = new URL(API_BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/coach";
  url.search = "";
  return url.toString();
}

export function endSession(payload) {
  return request("/api/session/end", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function saveSessionResult(summary) {
  return request("/api/session/save-result", {
    method: "POST",
    body: JSON.stringify(summary)
  });
}

export function getSessionResults() {
  return request("/api/session/results");
}

export function getSessions() {
  return request("/api/sessions");
}
