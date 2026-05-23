import { generateElevenLabsSpeech, request, resolveApiUrl } from "./client.js";

export async function saveRecordingV2(recording) {
  return request("/api/recordings/v2/session", {
    method: "POST",
    body: JSON.stringify(recording)
  });
}

export async function getRecordingV2(sessionId) {
  return request(`/api/recordings/v2/session/${encodeURIComponent(sessionId)}`);
}

export async function getTimelineV2(sessionId) {
  return request(`/api/recordings/v2/session/${encodeURIComponent(sessionId)}/timeline`);
}

export async function getPresentationStatus() {
  return request("/api/presentation/v2/status");
}

export async function requestElevenLabsSummary(text, sessionId) {
  const spokenText = String(text || "").trim();
  if (!spokenText) {
    return { ok: false, status: "empty_text", audio_url: null, error_message_sanitized: "No text provided" };
  }

  try {
    const result = await request("/api/presentation/v2/elevenlabs-summary", {
      method: "POST",
      body: JSON.stringify({ text: spokenText, session_id: sessionId }),
      timeoutMs: 90000,
    });
    if (result.ok && result.audio_url) {
      return {
        ...result,
        audio_url: resolveApiUrl(result.audio_url, "/api/presentation/v2")
      };
    }
  } catch {
    // Fall through to legacy TTS route.
  }

  try {
    const legacy = await generateElevenLabsSpeech(spokenText);
    if (legacy?.ok && legacy.audio_url) {
      return {
        ok: true,
        status: legacy.status || "ready",
        audio_url: resolveApiUrl(legacy.audio_url, "/api"),
        error_message_sanitized: legacy.error || null
      };
    }
    return {
      ok: false,
      status: legacy?.status || "error",
      audio_url: null,
      error_message_sanitized: legacy?.error || "TTS unavailable"
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      audio_url: null,
      error_message_sanitized: error.message || "TTS unavailable"
    };
  }
}

export async function requestHeyGenCoach({
  spokenSummary = "",
  audioUrl = null,
  sessionId = null,
  exercise = null,
  summary = null,
  geminiAnalysis = null,
} = {}) {
  return request("/api/presentation/v2/heygen-session-coach", {
    method: "POST",
    body: JSON.stringify({
      spoken_summary: spokenSummary,
      audio_url: audioUrl || null,
      session_id: sessionId,
      exercise,
      summary,
      gemini_analysis: geminiAnalysis,
    })
  });
}

export async function getHeyGenVideoStatus(videoId) {
  return request(`/api/presentation/v2/heygen-video-status/${encodeURIComponent(videoId)}`);
}
