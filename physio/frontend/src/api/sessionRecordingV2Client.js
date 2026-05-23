import { request, resolveApiUrl } from "./client.js";

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
  const result = await request("/api/presentation/v2/elevenlabs-summary", {
    method: "POST",
    body: JSON.stringify({ text, session_id: sessionId })
  });
  return {
    ...result,
    audio_url: result.audio_url
      ? resolveApiUrl(result.audio_url, "/api/presentation/v2")
      : result.audio_url
  };
}

export async function requestHeyGenCoach(spokenSummary, audioUrl, sessionId) {
  return request("/api/presentation/v2/heygen-session-coach", {
    method: "POST",
    body: JSON.stringify({
      spoken_summary: spokenSummary,
      audio_url: audioUrl || null,
      session_id: sessionId,
    })
  });
}
