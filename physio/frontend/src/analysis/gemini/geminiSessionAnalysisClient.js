import { generateGeminiSessionAnalysisV2, normalizeLocalSessionAnalysisV2 } from "../../api/client.js";

export async function normalizeFinalSessionAnalysisPacket(packet) {
  return normalizeLocalSessionAnalysisV2(packet);
}

export async function generateGeminiSessionAnalysis(packet) {
  return generateGeminiSessionAnalysisV2(packet);
}
