# PUSH_MOTION_AUDIT.md

## 1. Executive Summary

- Current live tracker: Browser MediaPipe in the frontend is the primary path; it extracts landmarks, computes angles, runs a local analyzer, builds a PhysioPacket, and posts it to the backend. Evidence: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx), [physio/frontend/src/api/client.js](physio/frontend/src/api/client.js), [physio/backend/main.py](physio/backend/main.py).
- Browser MediaPipe main path: Yes. The app defaults to browser mode and renders the browser tracker in Live Session. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx), [physio/frontend/src/components/LiveSession.jsx](physio/frontend/src/components/LiveSession.jsx).
- Python OpenCV still relevant: Yes, but only via the Debug source switch. It can post packets and overlay frames; it is not the default live path. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx), [physio/frontend/src/components/LiveSession.jsx](physio/frontend/src/components/LiveSession.jsx), [physio/vision/pose_tracker.py](physio/vision/pose_tracker.py).
- Elbow flexion analysis: Implemented locally in the browser using `createElbowFlexionAnalyzer`. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js), [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx).
- Exercise configs: Structured JS objects in `frontend/src/exercises`, with elbow flexion as the default. Evidence: [physio/frontend/src/exercises/elbowFlexionExtension.js](physio/frontend/src/exercises/elbowFlexionExtension.js), [physio/frontend/src/exercises/index.js](physio/frontend/src/exercises/index.js).
- Movement visualization: SVG-based elbow diagram; currently hardcoded to elbow flexion and does not vary by exercise. Evidence: [physio/frontend/src/components/ExerciseMovementDiagram.jsx](physio/frontend/src/components/ExerciseMovementDiagram.jsx), [physio/frontend/src/components/ExercisePreview.jsx](physio/frontend/src/components/ExercisePreview.jsx).
- Hardware sensor/websocket support: Partial. A sensor client exists for Python, WebSocket routes exist in backend, but the browser flow ignores sensor data and frontend uses polling. Evidence: [physio/hardware/sensor_client.py](physio/hardware/sensor_client.py), [physio/vision/pose_tracker.py](physio/vision/pose_tracker.py), [physio/backend/main.py](physio/backend/main.py), [physio/frontend/src/api/client.js](physio/frontend/src/api/client.js).
- Sensor data wired into browser flow: No. Browser packets set `sensor_status` to `offline` with `distance_cm` null. Evidence: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx).
- Must reuse for push exercise: exercise config pattern, analyzer pattern, Live Session UI, PhysioPacket fields, backend `/api/packets`. Evidence: [physio/frontend/src/exercises/index.js](physio/frontend/src/exercises/index.js), [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js), [physio/frontend/src/components/LiveSession.jsx](physio/frontend/src/components/LiveSession.jsx), [physio/shared/physio_packet_schema.json](physio/shared/physio_packet_schema.json).
- Must avoid: using Gemini during live exercise and using sensor data as the source of biomechanics. Current live path does invoke Gemini via the frontend, so this must be avoided for push. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx), [physio/backend/main.py](physio/backend/main.py).

## 2. Files Inspected

- [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx)
- [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js)
- [physio/frontend/src/state/exerciseRunner.js](physio/frontend/src/state/exerciseRunner.js)
- [physio/frontend/src/exercises/elbowFlexionExtension.js](physio/frontend/src/exercises/elbowFlexionExtension.js)
- [physio/frontend/src/exercises/index.js](physio/frontend/src/exercises/index.js)
- [physio/frontend/src/components/ExerciseMovementDiagram.jsx](physio/frontend/src/components/ExerciseMovementDiagram.jsx)
- [physio/frontend/src/components/ExercisePreview.jsx](physio/frontend/src/components/ExercisePreview.jsx)
- [physio/frontend/src/components/LiveSession.jsx](physio/frontend/src/components/LiveSession.jsx)
- [physio/frontend/src/components/CoachPanel.jsx](physio/frontend/src/components/CoachPanel.jsx)
- [physio/frontend/src/components/SessionSummary.jsx](physio/frontend/src/components/SessionSummary.jsx)
- [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx)
- [physio/frontend/src/api/client.js](physio/frontend/src/api/client.js)
- [physio/backend/main.py](physio/backend/main.py)
- [physio/backend/schemas.py](physio/backend/schemas.py)
- [physio/backend/packet_merge.py](physio/backend/packet_merge.py)
- [physio/hardware/sensor_client.py](physio/hardware/sensor_client.py)
- [physio/vision/pose_tracker.py](physio/vision/pose_tracker.py)
- [physio/shared/physio_packet_schema.json](physio/shared/physio_packet_schema.json)

## 3. Current Tracker Architecture

- Main live tracker: Browser MediaPipe in [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx). The app defaults to browser mode in [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx), and Live Session renders the browser overlay in [physio/frontend/src/components/LiveSession.jsx](physio/frontend/src/components/LiveSession.jsx).
- Landmark extraction: Browser uses MediaPipe Tasks Vision, with pose indices for shoulder/elbow/wrist/hip and hands for overlay. Evidence: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx).
- Tracker side: Defaults to right side, but accepts a side prop. Evidence: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx).
- Angles:
  - Elbow angle: computed from shoulder-elbow-wrist points (browser). Evidence: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx).
  - Upper-arm angle: calculated using a screen-axis fallback when torso reference is missing. Evidence: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx).
- Output fields (browser packet): `source`, `session_id`, `exercise`, `side`, `camera_status`, `elbow_angle`, `shoulder_angle`, `landmark_confidence`, `angle_valid`, `rep_count`, `rep_phase`, `pace`, `range_status`, `physio_score`, `local_coach_message`, plus debug fields like `shoulder_coords`, `wrist_coords`. Evidence: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx), [physio/backend/schemas.py](physio/backend/schemas.py).
- Example packet structure: documented in schema; includes `distance_cm` and `sensor_jitter_score`. Evidence: [physio/shared/physio_packet_schema.json](physio/shared/physio_packet_schema.json).
- Packet destination: posted to backend `/api/packets` via frontend client. Evidence: [physio/frontend/src/api/client.js](physio/frontend/src/api/client.js), [physio/backend/main.py](physio/backend/main.py).
- Frontend local analysis: yes. The elbow analyzer runs locally before packets are sent. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js), [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx).
- Backend analysis: applies local rules and computes combined jitter and coach state, then stores. Evidence: [physio/backend/packet_merge.py](physio/backend/packet_merge.py), [physio/backend/main.py](physio/backend/main.py).
- Source of truth during live exercise: browser analyzer + packet fields; backend is mostly storage and normalization. Evidence: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx), [physio/backend/packet_merge.py](physio/backend/packet_merge.py).

Important fields present in the live packet:
- `elbow_angle`, `shoulder_angle`, `landmark_confidence`, `angle_valid`, `jitter_score` (as `combined_jitter_score`), `sensor_jitter_score`, `distance_cm`, `rep_count`, `rep_phase`, `coach_state`, `local_coach_message`. Evidence: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx), [physio/shared/physio_packet_schema.json](physio/shared/physio_packet_schema.json), [physio/backend/schemas.py](physio/backend/schemas.py).

## 4. Existing Elbow Analyzer Audit

- State machine: implemented in [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js).
- States: `WAITING_FOR_START`, `STRAIGHTEN_TO_START`, `EXTENDED_READY`, `FLEXING`, `FLEXED_HOLD`, `EXTENDING`, `REP_COMPLETE`, `SESSION_COMPLETE`. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js).
- Thresholds: `startElbowMin`, `startElbowMax`, `flexedElbowMin`, `flexedElbowMax`, `requiredHoldSeconds`, `minRepSeconds`, `maxRepSeconds`, `jitterWarning`, `shoulderDriftWarning`, `minConfidence`. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js).
- Start of rep: elbow straight enough (`startElbowMin`) and transitions into flexing. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js).
- Rep completion: full flex-hold-extend cycle with `repCount` increment and completed rep record. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js).
- Input fields: `elbowAngle`, `shoulderAngle`, `landmarkConfidence`, `validLandmarks`, `jitterScore`, `timestampMs`. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js).
- Output fields: `rep_count`, `phase`, `pace`, `range_of_motion`, `hold_time_sec`, `physio_score`, `local_coach_message`, `completed_rep`, `completed_reps`, `coach_state`. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js).
- Rep count storage: analyzer internal state and emitted packet fields. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js).
- Completed reps stored: analyzer state, and copied into session summary by the runner. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js), [physio/frontend/src/state/exerciseRunner.js](physio/frontend/src/state/exerciseRunner.js).
- Reset behavior: analyzer `reset()` is called on session changes and start. Evidence: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx).
- Reuse for push exercise: structure is reusable, but logic is elbow-specific. The push exercise should get its own analyzer file rather than hacking this one.

## 5. Exercise Config System Audit

- Exercise configs stored in `frontend/src/exercises`. Evidence: [physio/frontend/src/exercises/index.js](physio/frontend/src/exercises/index.js).
- App lists exercises by rendering the `exercises` array. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx).
- Selection: `selectedExercise` state in App.jsx and `ExercisesPage` buttons. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx).
- Required fields (from elbow config): `id`, `name`, `shortName`, `status`, `joint`, `side`, `description`, `clinicalFraming`, `setupCue`, `instructions`, `repGoal`, `startPosition`, `targetPosition`, `holdSeconds`, `minRepSeconds`, `maxRepSeconds`, `jitterThreshold`, `shoulderDriftThreshold`, `metrics`. Evidence: [physio/frontend/src/exercises/elbowFlexionExtension.js](physio/frontend/src/exercises/elbowFlexionExtension.js).
- Rep goals: `repGoal` in exercise config. Evidence: [physio/frontend/src/exercises/elbowFlexionExtension.js](physio/frontend/src/exercises/elbowFlexionExtension.js).
- Thresholds: stored in exercise config and normalized in analyzer. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js).
- Coach messages: stored in analyzer (not in exercise config). Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js).
- Live Session uses active exercise: `selectedExercise` is passed to LiveSession and BrowserPoseOverlay. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx), [physio/frontend/src/components/LiveSession.jsx](physio/frontend/src/components/LiveSession.jsx).
- Adding a second exercise: straightforward in config + analyzer + UI; the visualization is currently elbow-specific and would need work.

To add:
- id: seated_one_arm_forward_press
- name: Seated One-Arm Forward Press

Do not implement yet; this would live alongside [physio/frontend/src/exercises/elbowFlexionExtension.js](physio/frontend/src/exercises/elbowFlexionExtension.js).

## 6. Visualization Engine Audit

- Movement diagram component: [physio/frontend/src/components/ExerciseMovementDiagram.jsx](physio/frontend/src/components/ExerciseMovementDiagram.jsx).
- Technology: SVG with animated rotation (requestAnimationFrame). Evidence: [physio/frontend/src/components/ExerciseMovementDiagram.jsx](physio/frontend/src/components/ExerciseMovementDiagram.jsx).
- Exercise ID dependency: None. The component is hardcoded to elbow flexion and does not use the passed `exerciseId`. Evidence: [physio/frontend/src/components/ExerciseMovementDiagram.jsx](physio/frontend/src/components/ExerciseMovementDiagram.jsx), [physio/frontend/src/components/ExercisePreview.jsx](physio/frontend/src/components/ExercisePreview.jsx).
- Labels/arcs/ghost positions: all hardcoded in the SVG and phase list. Evidence: [physio/frontend/src/components/ExerciseMovementDiagram.jsx](physio/frontend/src/components/ExerciseMovementDiagram.jsx).
- Support for pushing motion: Not currently. It would need either parameterization or a new component for push preview.
- Recommendation: Create a new push preview component or extend this component to branch on exercise ID.

## 7. Live Session UI Audit

- Live camera: displayed in LiveSession; browser mode renders BrowserPoseOverlay and python mode renders `/api/vision/frame`. Evidence: [physio/frontend/src/components/LiveSession.jsx](physio/frontend/src/components/LiveSession.jsx).
- Metrics rendered: angle, target, reps, score, jitter, hold time, ROM, and distance if present. Evidence: [physio/frontend/src/components/LiveSession.jsx](physio/frontend/src/components/LiveSession.jsx).
- Coach cues: CoachPanel shows local and AI cues; local is `local_coach_message`, AI is `aiCue`. Evidence: [physio/frontend/src/components/CoachPanel.jsx](physio/frontend/src/components/CoachPanel.jsx).
- ElevenLabs trigger: in App.jsx, voice is triggered from AI cue text with throttling. It is not tied directly to phase transitions. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx).
- Support for second exercise: partially. LiveSession uses `exercise.joint` to decide which angle to show, but some labels are elbow-specific (ROM, hold time, upper arm drift). Evidence: [physio/frontend/src/components/LiveSession.jsx](physio/frontend/src/components/LiveSession.jsx).
- Labels needing generalization for push: ROM/hold time labels, elbow-specific target labels, and any text that assumes bending vs pushing.

## 8. Hardware Sensor / Distance Tracker Audit

- Sensor client exists: Yes, in Python. Evidence: [physio/hardware/sensor_client.py](physio/hardware/sensor_client.py).
- Backend sensor endpoint: No dedicated endpoint; sensor data only arrives inside packets. Evidence: [physio/backend/main.py](physio/backend/main.py).
- Backend receives sensor packets: Only if included in PhysioPacket posted by trackers. Evidence: [physio/backend/schemas.py](physio/backend/schemas.py), [physio/backend/main.py](physio/backend/main.py).
- Frontend receives sensor data: Only via packet fields; browser tracker sets sensor offline. Evidence: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx).
- WebSocket implemented: Yes in backend (`/ws/live`, `/ws/coach`), but frontend does not use it. Evidence: [physio/backend/main.py](physio/backend/main.py), [physio/frontend/src/api/client.js](physio/frontend/src/api/client.js).
- `distance_cm` included: Yes in schema and packet shape; browser path sets null. Evidence: [physio/shared/physio_packet_schema.json](physio/shared/physio_packet_schema.json), [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx).
- `sensor_jitter_score` included: Yes in schema; browser path sets 0. Evidence: [physio/shared/physio_packet_schema.json](physio/shared/physio_packet_schema.json), [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx).
- Sensor data fused into analysis: Not in browser flow; Python tracker uses sensor for jitter in its packet. Evidence: [physio/vision/pose_tracker.py](physio/vision/pose_tracker.py).
- Sensor data displayed: Yes, UI shows distance if present. Evidence: [physio/frontend/src/components/LiveSession.jsx](physio/frontend/src/components/LiveSession.jsx).
- Missing for real sensor-fused push exercise: a browser-side sensor stream, time alignment, and analyzer inputs that include sensor-derived displacement and jitter.

## 9. Current Data Flow Diagram

Browser tracking flow (exists):

camera
→ MediaPipe landmarks
→ elbow + upper-arm angle calculation
→ local elbow analyzer
→ PhysioPacket (`source=browser_mediapipe`)
→ POST /api/packets
→ backend stores + applies local rules
→ UI polls /api/live/latest (python/mock) or uses browser packets directly

Evidence: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx), [physio/frontend/src/api/client.js](physio/frontend/src/api/client.js), [physio/backend/main.py](physio/backend/main.py).

Voice flow (exists):

local analyzer
→ AI cue text (Gemini endpoint)
→ ElevenLabs TTS
→ browser audio playback

Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx), [physio/frontend/src/ai/geminiCoachClient.js](physio/frontend/src/ai/geminiCoachClient.js), [physio/frontend/src/ai/elevenLabsClient.js](physio/frontend/src/ai/elevenLabsClient.js).

AI flow (exists):

local analyzer packet
→ buildPhysioAIPacket
→ /api/ai/gemini-coach
→ AI cue

Post-session:
summary
→ /api/ai/session-summary
→ AI summary

Evidence: [physio/frontend/src/ai/buildPhysioAIPacket.js](physio/frontend/src/ai/buildPhysioAIPacket.js), [physio/backend/main.py](physio/backend/main.py).

Sensor flow (partial):

sensor
→ hardware sensor client (Python)
→ included in Python tracker packets
→ backend stores
→ UI displays distance if present

Evidence: [physio/hardware/sensor_client.py](physio/hardware/sensor_client.py), [physio/vision/pose_tracker.py](physio/vision/pose_tracker.py), [physio/frontend/src/components/LiveSession.jsx](physio/frontend/src/components/LiveSession.jsx).

## 10. Intended Push Exercise Flow

Seated One-Arm Forward Press

Live flow (intended):
- camera landmarks
→ local push analyzer (new)
→ sensor distance/jitter input
→ fused push state
→ deterministic phase cue
→ ElevenLabs live voice
→ completed rep data

Post-session flow:
- rep + sensor metrics
→ Gemini summary only after session
→ ElevenLabs reads recap
→ results logged

No Gemini during live exercise.

## 11. Proposed Push Exercise State Machine

Suggested states:
- WAITING_FOR_TRACKING
- START_BENT_READY
- PUSHING
- EXTENDED_HOLD
- RETURNING
- REP_COMPLETE
- SESSION_COMPLETE

Start condition:
- Elbow is bent (angle below straight threshold).
- Shoulder, elbow, wrist visible.
- Sensor distance present if hardware connected.

Push condition:
- Elbow angle increases toward straight.
- Wrist moves forward.
- Sensor distance indicates forward displacement.

Extended condition:
- Elbow near straight threshold.
- Arm roughly horizontal.
- Target push depth reached.
- Sensor signal stable (low jitter).

Return condition:
- Elbow angle decreases back toward bent.
- Sensor distance returns toward start.

Rep complete:
- Full bend → push → hold → return cycle completed.
- Count exactly one rep.

Required fields:
- camera: `elbow_angle`, `shoulder_angle`, `landmark_confidence`, `angle_valid`, wrist position, arm alignment
- sensor: `distance_cm`, `sensor_jitter_score`, `timestamp_ms`, sensor validity flag
- fused: `phase`, `rep_count`, `push_depth`, `hold_time_sec`, `rep_duration_sec`, `pace`, `jitter_score`, `compensation`, `physio_score`, `local_coach_message`

## 12. Sensor Fusion Requirements for Push Exercise

Sensor should provide:
- `distance_cm`
- `calibrated_start_distance_cm`
- `current_displacement_cm`
- `max_push_depth_cm`
- `sensor_jitter_score`
- `sensor_valid`
- `timestamp_ms`

Camera should provide:
- `elbow_angle`
- `shoulder_angle`
- wrist coordinates
- arm alignment (horizontal drift)
- `landmark_confidence`
- `angle_valid`
- optional camera jitter

Fused analyzer output:
- `phase`, `rep_count`, `push_depth`, `hold_time_sec`, `rep_duration_sec`, `pace`, `jitter_score`, `compensation`, `physio_score`, `local_coach_message`

Time alignment:
- Use `timestamp_ms` on packets to align the most recent sensor sample within a short time window (e.g., 150-300 ms).
- If sensor data is stale or missing, fall back to camera-only analysis and mark `sensor_valid=false`.

## 13. Push Exercise Metrics

Per rep:
- start elbow angle
- max extension angle
- return elbow angle
- push depth
- hold time
- rep duration
- sensor jitter
- camera jitter
- combined jitter
- shoulder drift
- arm horizontal alignment
- rep score
- issue label

Session:
- total reps
- clean reps
- best push depth
- average push depth
- average extension angle
- average hold time
- average jitter
- average PhysioScore
- common issue
- local recommendation
- Gemini final summary

## 14. Push Exercise Live Coach Cues

No Gemini during live exercise.

Suggested deterministic cues:
- Start with your elbow bent.
- Push your hand forward slowly.
- Keep your arm level.
- Hold the reach for a moment.
- Return with control.
- Good rep. Let’s do the next one.
- Keep your hand in front of the sensor.
- Move slower and steadier.
- Keep your shoulder relaxed.

Placement recommendation:
- Store per-exercise cue map in the new push analyzer or exercise config.
- Analyzer output should emit `local_coach_message` for each phase; CoachPanel already displays it. Evidence: [physio/frontend/src/components/CoachPanel.jsx](physio/frontend/src/components/CoachPanel.jsx).

## 15. Gemini Post-Session Summary for Push Exercise

Gemini should receive:
- exercise name
- total reps
- clean reps
- push depth metrics
- extension angle metrics
- jitter
- hold time
- pace
- shoulder compensation
- local recommendation

Gemini should output:
- short session recap
- what went well
- one improvement area
- safe encouragement
- optional bonus rep note
- safe return suggestion

No raw landmarks or raw video.

## 16. Files Likely Needed for Implementation

New files likely:
- frontend/src/exercises/seatedOneArmForwardPress.js
- frontend/src/analyzers/pushMotionAnalyzer.js
- frontend/src/components/PushMovementDiagram.jsx (or parameterized ExerciseMovementDiagram)
- frontend/src/sensors/useSensorStream.js (browser-side sensor ingestion)

Existing files likely:
- frontend/src/exercises/index.js
- frontend/src/App.jsx
- frontend/src/components/LiveSession.jsx
- frontend/src/components/CoachPanel.jsx
- frontend/src/state/exerciseRunner.js
- frontend/src/api/client.js
- backend/main.py
- backend/schemas.py
- hardware/sensor_client.py
- shared/physio_packet_schema.json

These are based on current architecture; no modifications made in this audit.

## 17. Risks and Blockers

P0 - blocks implementation:
1. Sensor data is not wired into the browser flow, so push sensor fusion has no ingestion path yet. Evidence: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx).
2. Python tracker targets right-arm raise, not elbow flexion; it will not help validate a push exercise unless changed. Evidence: [physio/vision/pose_tracker.py](physio/vision/pose_tracker.py).

P1 - blocks reliable demo:
1. Live Gemini and ElevenLabs are currently tied to AI cues during live sessions, which conflicts with the new rule. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx).
2. Visualization is elbow-specific and will misrepresent a push motion if reused as-is. Evidence: [physio/frontend/src/components/ExerciseMovementDiagram.jsx](physio/frontend/src/components/ExerciseMovementDiagram.jsx).

P2 - polish issue:
1. WebSocket support exists but is unused; sensor streaming would likely need a real-time channel. Evidence: [physio/backend/main.py](physio/backend/main.py), [physio/frontend/src/api/client.js](physio/frontend/src/api/client.js).

## 18. Recommended Implementation Plan

1. Stabilize and confirm elbow demo behavior (browser path, analyzer, UI labels).
2. Add push exercise config only (no logic).
3. Add push movement preview (new component or parameterized diagram).
4. Add push analyzer with camera-only logic.
5. Add browser-side sensor stream ingestion (hardware optional).
6. Fuse sensor displacement + jitter into push analyzer.
7. Add fused scoring and rep metrics.
8. Keep Gemini strictly post-session; update live flow to avoid Gemini.
9. Log and display push-specific results.

Camera-only push analyzer must work even if sensor is missing. Sensor enhances but does not block.

## 19. Final Verdict

- Repo readiness to add push exercise: Partially ready. Core browser tracker, analyzer pattern, and exercise config system exist.
- Must fix first: Decide on a browser sensor ingestion path and align the demo with the “no Gemini during live” rule.
- Reuse: exercise config pattern, analyzer structure, LiveSession UI layout, PhysioPacket schema.
- Rewrite: movement preview for push, push analyzer, and any elbow-specific UI labels.
- Avoid: using Gemini for live exercise, and using sensor data as the joint-angle source.
- Smallest safe next step: create a new push analyzer scaffold and exercise config without wiring sensor fusion yet.
