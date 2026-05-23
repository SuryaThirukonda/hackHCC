const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8001";

export async function saveRecordingV2(recording) {
  const response = await fetch(`${API_BASE}/api/recordings/v2/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(recording),
  });
  if (!response.ok) {
    throw new Error(`Save recording failed (${response.status})`);
  }
  return response.json();
}

export async function getRecordingV2(sessionId) {
  const response = await fetch(`${API_BASE}/api/recordings/v2/session/${encodeURIComponent(sessionId)}`);
  if (!response.ok) throw new Error(`Get recording failed (${response.status})`);
  return response.json();
}

export async function getTimelineV2(sessionId) {
  const response = await fetch(`${API_BASE}/api/recordings/v2/session/${encodeURIComponent(sessionId)}/timeline`);
  if (!response.ok) throw new Error(`Get timeline failed (${response.status})`);
  return response.json();
}

export async function getPresentationStatus() {
  const response = await fetch(`${API_BASE}/api/presentation/v2/status`);
  if (!response.ok) throw new Error("Presentation status check failed");
  return response.json();
}

export async function requestElevenLabsSummary(text, sessionId) {
  const response = await fetch(`${API_BASE}/api/presentation/v2/elevenlabs-summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, session_id: sessionId }),
  });
  if (!response.ok) throw new Error(`ElevenLabs summary failed (${response.status})`);
  return response.json();
}

export async function requestHeyGenCoach(spokenSummary, audioUrl, sessionId) {
  const response = await fetch(`${API_BASE}/api/presentation/v2/heygen-session-coach`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      spoken_summary: spokenSummary,
      audio_url: audioUrl || null,
      session_id: sessionId,
    }),
  });
  if (!response.ok) throw new Error(`HeyGen coach request failed (${response.status})`);
  return response.json();
}
