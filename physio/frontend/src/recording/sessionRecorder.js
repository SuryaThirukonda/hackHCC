/**
 * sessionRecorder — records the full exercise session timeline for replay and post-session analysis.
 *
 * Sampling strategy:
 *  - Main samples at ~12 Hz (every 83ms) to keep JSON small
 *  - Key events recorded immediately regardless of rate
 *  - Rep snapshots stored when the analyzer emits completed_rep
 */

const SAMPLE_INTERVAL_MS = 83; // ~12 Hz

export function createSessionRecorder(sessionId, exerciseId) {
  const metadata = {
    session_id: sessionId,
    exercise_id: exerciseId,
    started_at_ms: Date.now(),
    ended_at_ms: null,
    source: "browser_mediapipe",
  };

  const samples = [];
  const events = [];
  const reps = [];

  let lastSampleMs = 0;
  let active = false;

  function start() {
    active = true;
    metadata.started_at_ms = Date.now();
    addEvent("session_started");
  }

  function stop() {
    active = false;
    metadata.ended_at_ms = Date.now();
    addEvent("session_completed");
  }

  function addEvent(type, extra = {}) {
    events.push({ timestampMs: Date.now(), type, ...extra });
  }

  /**
   * Feed a packet from BrowserPoseOverlay / App.
   * The recorder throttles to SAMPLE_INTERVAL_MS to avoid huge JSON blobs.
   *
   * @param {object} packet - PhysioPacket with analyzer_output attached
   * @param {object|null} smoothedFrame - optional SmoothedPoseFrame from poseSignalSmoother
   */
  function recordPacket(packet, smoothedFrame = null) {
    if (!active) return;

    const now = Date.now();
    const analyzerOut = packet?.analyzer_output || {};

    // Always capture rep completions immediately
    if (packet?.completed_rep || analyzerOut?.completed_rep) {
      const rep = packet?.completed_rep || analyzerOut?.completed_rep;
      recordRep(rep, analyzerOut);
    }

    // Throttle main samples
    if (now - lastSampleMs < SAMPLE_INTERVAL_MS) return;
    lastSampleMs = now;

    const sample = {
      timestampMs: packet?.timestamp_ms || now,
      elapsedSec: Math.round((now - metadata.started_at_ms) / 100) / 10,
      source: packet?.source || "browser_mediapipe",
      raw_elbow_angle: packet?.elbow_angle ?? null,
      smoothed_elbow_angle: smoothedFrame?.smoothed?.elbowAngle ?? null,
      raw_shoulder_angle: packet?.shoulder_angle ?? null,
      smoothed_shoulder_angle: smoothedFrame?.smoothed?.shoulderAngle ?? null,
      landmark_confidence: packet?.landmark_confidence ?? null,
      valid_landmarks: packet?.angle_valid ?? (packet?.landmark_confidence > 0.45),
      camera_jitter_score: smoothedFrame?.jitter?.cameraJitterScore ?? packet?.combined_jitter_score ?? null,
      analyzer_phase: analyzerOut?.phase ?? null,
      coach_state: packet?.coach_state ?? analyzerOut?.coach_state ?? null,
      local_coach_message: packet?.local_coach_message ?? analyzerOut?.local_coach_message ?? null,
      rep_count: analyzerOut?.rep_count ?? packet?.rep_count ?? 0,
      hold_time_sec: analyzerOut?.hold_time_sec ?? null,
      rep_duration_sec: analyzerOut?.rep_duration_sec ?? null,
      range_of_motion_so_far: analyzerOut?.range_of_motion ?? null,
      physio_score: analyzerOut?.physio_score ?? packet?.physio_score ?? null,
    };

    samples.push(sample);

    // Keep memory reasonable — cap at 2000 samples (~2.8 min at 12 Hz)
    if (samples.length > 2000) samples.splice(0, 400);
  }

  function recordRep(rep, analyzerOutput = {}) {
    if (!rep) return;
    const repNum = rep.rep_index;
    if (reps.some((r) => r.rep_number === repNum)) return; // deduplicate

    reps.push({
      rep_number: repNum,
      start_timestamp: rep.started_at_ms ?? null,
      end_timestamp: rep.ended_at_ms ?? Date.now(),
      duration_sec: rep.rep_duration_sec ?? null,
      min_elbow_angle: rep.min_elbow_angle ?? null,
      max_elbow_angle: rep.max_elbow_angle ?? null,
      range_of_motion: rep.range_of_motion ?? null,
      hold_time_sec: rep.hold_time_sec ?? null,
      jitter_score: rep.jitter_score ?? null,
      shoulder_drift: rep.shoulder_drift ?? null,
      physio_score: rep.physio_score ?? null,
      issue_label: rep.issue || "none",
      clean: rep.clean ?? false,
      confidence_label: "medium",
    });

    addEvent("rep_completed", { rep_number: repNum, physio_score: rep.physio_score });
  }

  function recordTrackingEvent(type, detail = {}) {
    addEvent(type, detail);
  }

  function recordVoiceEvent(type, detail = {}) {
    addEvent(type, detail);
  }

  function recordGeminiEvent(type, detail = {}) {
    addEvent(type, detail);
  }

  function getRecording() {
    return {
      ...metadata,
      sample_count: samples.length,
      event_count: events.length,
      rep_count: reps.length,
      samples: samples.slice(),
      events: events.slice(),
      reps: reps.slice(),
    };
  }

  function reset(newSessionId, newExerciseId) {
    samples.length = 0;
    events.length = 0;
    reps.length = 0;
    metadata.session_id = newSessionId || sessionId;
    metadata.exercise_id = newExerciseId || exerciseId;
    metadata.started_at_ms = Date.now();
    metadata.ended_at_ms = null;
    lastSampleMs = 0;
    active = false;
  }

  return {
    start,
    stop,
    recordPacket,
    recordRep,
    recordTrackingEvent,
    recordVoiceEvent,
    recordGeminiEvent,
    addEvent,
    getRecording,
    reset,
    getReps: () => reps.slice(),
    getSamples: () => samples.slice(),
    getEvents: () => events.slice(),
    isActive: () => active,
  };
}
