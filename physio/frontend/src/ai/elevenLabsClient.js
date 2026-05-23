import { API_BASE, generateElevenLabsSpeech } from "../api/client.js";

function mediaUrl(path) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path}`;
}

export async function speakCoachCue(text) {
  const result = await generateElevenLabsSpeech(text);
  return {
    ...result,
    audio_url: mediaUrl(result.audio_url)
  };
}
