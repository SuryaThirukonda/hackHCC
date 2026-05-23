export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
// Port 8010 is the clean backend that has all v2 routes (port 8000 has ghost WSL sockets)
const FALLBACK_API_BASES = ["http://127.0.0.1:8010", "http://localhost:8010", "http://127.0.0.1:8765", "http://localhost:8765", "http://localhost:8001"];
const successfulBaseByBucket = new Map();

function pathBucket(path) {
  if (path.startsWith("/api/analysis/v2")) return "/api/analysis/v2";
  if (path.startsWith("/api/recordings/v2")) return "/api/recordings/v2";
  if (path.startsWith("/api/presentation/v2")) return "/api/presentation/v2";
  return "/api";
}

function candidateBases(path) {
  const bucket = pathBucket(path);
  const bases = [successfulBaseByBucket.get(bucket), API_BASE].filter(Boolean);
  if (path.startsWith("/api/analysis/v2") || path.startsWith("/api/recordings/v2") || path.startsWith("/api/presentation/v2")) {
    bases.push(...FALLBACK_API_BASES);
  }
  return Array.from(new Set(bases));
}

async function parseError(response, path, base, method) {
  let detail = "";
  try {
    const payload = await response.json();
    detail = Array.isArray(payload.detail)
      ? payload.detail.map((item) => item.msg || JSON.stringify(item)).join("; ")
      : payload.detail || payload.error || "";
  } catch {
    detail = "";
  }
  return new Error(detail || `${method || "GET"} ${base}${path} failed: ${response.status}`);
}

export async function request(path, options = {}) {
  const method = options.method || "GET";
  let lastError = null;
  for (const base of candidateBases(path)) {
    let response;
    try {
      response = await fetch(`${base}${path}`, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options
      });
    } catch (error) {
      lastError = error;
      continue;
    }
    if (response.ok) {
      successfulBaseByBucket.set(pathBucket(path), base);
      return response.json();
    }
    lastError = await parseError(response, path, base, method);
    if (response.status !== 404 || !path.startsWith("/api/")) break;
  }
  throw lastError || new Error(`${method} ${path} failed`);
}

export async function fetchApi(path, options = {}) {
  return request(path, options);
}

export async function requestBinary(path, options = {}) {
  const method = options.method || "GET";
  let lastError = null;
  for (const base of candidateBases(path)) {
    let response;
    try {
      response = await fetch(`${base}${path}`, {
        headers: { ...(options.headers || {}) },
        ...options
      });
    } catch (error) {
      lastError = error;
      continue;
    }
    if (response.ok) {
      successfulBaseByBucket.set(pathBucket(path), base);
      return response;
    }
    lastError = await parseError(response, path, base, method);
    if (response.status !== 404 || !path.startsWith("/api/")) break;
  }
  throw lastError || new Error(`${method} ${path} failed`);
}

export function resolveApiUrl(urlOrPath, pathForBase = "/api") {
  if (!urlOrPath) return urlOrPath;
  try {
    return new URL(urlOrPath).toString();
  } catch {
    const base = successfulBaseByBucket.get(pathBucket(pathForBase)) || API_BASE;
    return new URL(urlOrPath, base).toString();
  }
}

/*
async function oldRequest(path, options = {}) {
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
*/

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

export function normalizeLocalSessionAnalysisV2(packet) {
  return request("/api/analysis/v2/session-summary-local", {
    method: "POST",
    body: JSON.stringify(packet)
  });
}

export function generateGeminiSessionAnalysisV2(packet) {
  return request("/api/analysis/v2/gemini-session-analysis", {
    method: "POST",
    body: JSON.stringify(packet)
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
