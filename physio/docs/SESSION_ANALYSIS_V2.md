# Session Analysis V2

Person A owns this deterministic post-session pipeline:

```text
webcam landmarks
-> raw angles
-> poseSignalSmoother
-> local analyzer
-> recorded packets with raw + smoothed values
-> buildLocalSessionSummary
-> FinalSessionAnalysisPacket
-> backend /api/analysis/v2/session-summary-local
-> backend /api/analysis/v2/gemini-session-analysis
-> results page GeminiSessionAnalysisPanel
```

Gemini is not called during live exercise. The local analyzer owns biomechanics,
phase detection, rep counting, scoring, and correctness. Gemini only receives
compact aggregate metrics after the session and returns safe presentation text.

## Smoother

`frontend/src/analysis/smoothing/poseSignalSmoother.js` applies:

1. validity gate
2. rolling median over recent valid samples
3. EMA with configurable alpha
4. trend estimation over recent smoothed samples
5. raw-vs-smoothed residual jitter
6. stable flags with hysteresis

The live analyzer receives smoothed elbow and shoulder angles. Packets preserve
`raw_elbow_angle`, `smoothed_elbow_angle`, `raw_shoulder_angle`,
`smoothed_shoulder_angle`, `smoothing_jitter_score`, `trend_direction`, and
`validity_status` for debugging/results.

## FinalSessionAnalysisPacket

The frontend packet includes only structured metrics:

- session metadata
- goals
- aggregate metrics
- tracking quality
- issue summary
- compact rep breakdown
- local deterministic summary

It does not include video, images, or landmark arrays.

## Backend V2 Routes

- `POST /api/analysis/v2/session-summary-local`
- `POST /api/analysis/v2/gemini-session-analysis`
- `GET /api/analysis/v2/status`

The Gemini route uses Vertex AI with Application Default Credentials and the
project/location configured for the hackathon demo. If Vertex fails, the route
returns a structured local fallback instead of crashing.
