import { generateElevenLabsSpeech, resolveApiUrl } from "../api/client.js";

function mediaUrl(path) {
  if (!path) return null;
  return resolveApiUrl(path, "/api/ai/elevenlabs-tts");
}

export async function speakCoachCue(text) {
  const result = await generateElevenLabsSpeech(text);
  return {
    ...result,
    audio_url: mediaUrl(result.audio_url)
  };
}
