const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8001";

/**
 * Send a FinalSessionAnalysisPacket to the V2 post-session Gemini route.
 * Gemini must only be called after session completion — never during live exercise.
 *
 * @param {object} packet - FinalSessionAnalysisPacket
 * @returns {Promise<GeminiSessionAnalysisResponse>}
 */
export async function callGeminiSessionAnalysisV2(packet) {
  const response = await fetch(`${API_BASE}/api/analysis/v2/gemini-session-analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(packet),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gemini V2 session analysis failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

/**
 * Validate a local session packet against the backend schema.
 *
 * @param {object} packet - FinalSessionAnalysisPacket
 * @returns {Promise<LocalSummaryResponse>}
 */
export async function validateSessionPacketV2(packet) {
  const response = await fetch(`${API_BASE}/api/analysis/v2/session-summary-local`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(packet),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Local summary validation failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

/**
 * @returns {Promise<AnalysisV2StatusResponse>}
 */
export async function getAnalysisV2Status() {
  const response = await fetch(`${API_BASE}/api/analysis/v2/status`);
  if (!response.ok) throw new Error("Analysis V2 status check failed");
  return response.json();
}
