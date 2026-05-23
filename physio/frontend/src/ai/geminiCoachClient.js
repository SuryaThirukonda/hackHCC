import { generateGeminiCoachCue, generateGeminiSessionSummary } from "../api/client.js";

export async function generateLiveCoachCue(aiPacket) {
  return generateGeminiCoachCue(aiPacket);
}

export async function generateSessionSummary(summaryPacket) {
  return generateGeminiSessionSummary(summaryPacket);
}
