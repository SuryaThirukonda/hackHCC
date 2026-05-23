const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
const FALLBACK_API_BASES = [
  "http://127.0.0.1:8000",
  "http://localhost:8000",
  "http://127.0.0.1:8001",
  "http://localhost:8001",
];
const STT_TIMEOUT_MS = 45000;
const successfulBaseByBucket = new Map();

function pathBucket(path) {
  return "/api";
}

function candidateBases(path) {
  const bucket = pathBucket(path);
  const bases = [successfulBaseByBucket.get(bucket), API_BASE, ...FALLBACK_API_BASES].filter(Boolean);
  return Array.from(new Set(bases));
}

async function parseError(response, path, base, method) {
  let detail = "";
  try {
    const payload = await response.json();
    detail = Array.isArray(payload.detail)
      ? payload.detail.map((item) => item.msg || JSON.stringify(item)).join("; ")
      : payload.detail || payload.error || payload.error_message_sanitized || "";
  } catch {
    detail = "";
  }
  return new Error(detail || `${method || "GET"} ${base}${path} failed: ${response.status}`);
}

function uploadFilename(mimeType) {
  const normalized = (mimeType || "").split(";")[0].trim().toLowerCase();
  if (normalized === "audio/wav") return "recording.wav";
  if (normalized === "audio/mp4" || normalized === "audio/x-m4a") return "recording.m4a";
  if (normalized === "audio/mpeg") return "recording.mp3";
  return "recording.webm";
}

export async function transcribeSpeechAudio(blob, mimeType = "audio/webm") {
  const formData = new FormData();
  formData.append("audio", blob, uploadFilename(mimeType));

  const path = "/api/ai/speech-to-text";
  let lastError = null;
  for (const base of candidateBases(path)) {
    let response;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), STT_TIMEOUT_MS);
    try {
      response = await fetch(`${base}${path}`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
    } catch (error) {
      lastError = error;
      continue;
    } finally {
      window.clearTimeout(timeoutId);
    }
    if (response.ok) {
      successfulBaseByBucket.set(pathBucket(path), base);
      return response.json();
    }
    lastError = await parseError(response, path, base, "POST");
    if (response.status !== 404) break;
  }
  throw lastError || new Error("POST /api/ai/speech-to-text failed");
}

export async function requestSpeechSttTest() {
  const path = "/api/ai/speech-to-text-test";
  let lastError = null;
  for (const base of candidateBases(path)) {
    let response;
    try {
      response = await fetch(`${base}${path}`, { method: "POST" });
    } catch (error) {
      lastError = error;
      continue;
    }
    if (response.ok) {
      successfulBaseByBucket.set(pathBucket(path), base);
      return response.json();
    }
    lastError = await parseError(response, path, base, "POST");
    if (response.status !== 404) break;
  }
  throw lastError || new Error("POST /api/ai/speech-to-text-test failed");
}
