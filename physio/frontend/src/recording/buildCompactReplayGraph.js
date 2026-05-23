/**
 * Downsample session recording samples for SQLite presentation cache + replay chart.
 * Keeps enough points for jitter flags while avoiding multi-MB cache blobs.
 */
const MAX_REPLAY_POINTS = 160;

export function buildCompactReplayGraph(recording) {
  const samples = recording?.samples || [];
  const reps = recording?.reps || [];
  if (!samples.length) return null;

  const step = Math.max(1, Math.ceil(samples.length / MAX_REPLAY_POINTS));
  const compactSamples = samples
    .filter((_, index) => index % step === 0 || index === samples.length - 1)
    .map((sample) => ({
      timestampMs: sample.timestampMs,
      raw_elbow_angle: sample.raw_elbow_angle ?? null,
      smoothed_elbow_angle: sample.smoothed_elbow_angle ?? null,
      camera_jitter_score: sample.camera_jitter_score ?? sample.jitter_score ?? null,
      valid_landmarks: sample.valid_landmarks ?? true,
      coach_state: sample.coach_state ?? null,
    }));

  return {
    session_id: recording.session_id,
    sample_count: compactSamples.length,
    source_sample_count: samples.length,
    samples: compactSamples,
    reps: reps.map((rep) => ({
      rep_number: rep.rep_number ?? rep.rep_index,
      rep_index: rep.rep_index ?? rep.rep_number,
      start_timestamp: rep.start_timestamp ?? null,
      end_timestamp: rep.end_timestamp ?? null,
      physio_score: rep.physio_score ?? null,
      jitter_score: rep.jitter_score ?? null,
      issue: rep.issue ?? rep.issue_label ?? "none",
      issue_label: rep.issue_label ?? rep.issue ?? "none",
      clean: rep.clean ?? false,
    })),
  };
}
