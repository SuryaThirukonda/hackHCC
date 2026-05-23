import React, { useState } from "react";
import VoiceRecordInput from "../voice/VoiceRecordInput.jsx";
import ElevenLabsSummaryPlayer from "../results/ElevenLabsSummaryPlayer.jsx";

const DEFAULT_TTS_SAMPLE = "This is a test of the ElevenLabs voice summary. You should hear the full sentence without cutting off early.";

/**
 * Debug panel voice lab — same STT + TTS stack as the Results flow.
 */
export default function VoiceLabDebugPanel() {
  const [sttText, setSttText] = useState("");
  const [ttsDraft, setTtsDraft] = useState(DEFAULT_TTS_SAMPLE);
  const [ttsActive, setTtsActive] = useState(DEFAULT_TTS_SAMPLE);
  const [ttsStatus, setTtsStatus] = useState("idle");

  return (
    <div className="voice-lab-debug">
      <div className="voice-lab-debug__section">
        <p className="eyebrow">Speech to text</p>
        <p className="muted-sub">Web Audio PCM → WAV → ElevenLabs Scribe. Live mic % while recording; debug JSON after each attempt.</p>
        <VoiceRecordInput
          value={sttText}
          onChange={setSttText}
          placeholder="Press Record, speak for at least one second, then Stop."
          rows={5}
          showClear
          showDebug
          showMicMeter
          showSttTest
          recordLabel="Record"
          stopLabel="Stop recording"
        />
      </div>

      <div className="voice-lab-debug__section">
        <p className="eyebrow">Text to speech</p>
        <p className="muted-sub">Same player as Results summary: ElevenLabs via /api/presentation/v2/elevenlabs-summary.</p>
        <textarea
          className="voice-input-test__box"
          value={ttsDraft}
          onChange={(event) => setTtsDraft(event.target.value)}
          rows={4}
          placeholder="Enter text to synthesize and play…"
        />
        <div className="voice-lab-debug__tts-meta">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => setTtsActive(ttsDraft.trim())}
            disabled={!ttsDraft.trim()}
          >
            Generate voice
          </button>
          <span className={`status-badge status-${ttsStatus}`}>{ttsStatus}</span>
        </div>
        <ElevenLabsSummaryPlayer
          spokenSummary={ttsActive}
          sessionId="debug-voice-lab"
          autoPlay={false}
          compact
          onStatusChange={setTtsStatus}
        />
      </div>
    </div>
  );
}
