# SENSOR PUSH REPO AUDIT

## 1. Executive Summary

- Does the app start? Partial. `frontend/npm run build` passes. I did not keep a Vite dev server running for this audit.
- Does the backend start? Yes with the repo virtualenv and `PYTHONPATH=backend`: `PYTHONPATH=backend backend/.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8019` reached "Application startup complete." It fails under system `python3` because that interpreter cannot evaluate the current Pydantic annotations and does not have the backend import path set.
- Does the Raspberry Pi WebSocket server exist? No real Raspberry Pi/GPIO server was found. A fake demo server exists in `hardware/fake_sensor_server.py`.
- Does the sensor send real distance data? No real sensor implementation is present in this repo. The fake server sends generated distance data.
- Does the frontend receive sensor data? Code exists for direct browser WebSocket reception in `frontend/src/sensors/useSensorStream.js`. Runtime connection to the default local URL is currently suspect because `localhost:8765` is already occupied by a VS Code helper on this machine.
- Does MediaPipe tracking work for the push exercise? Browser MediaPipe tracking code exists in `frontend/src/components/BrowserPoseOverlay.jsx`, and user screenshots show landmarks. This audit did not run an interactive camera test.
- Does a push exercise config exist? Yes: `seated_one_arm_forward_press` in `frontend/src/exercises/seatedOneArmForwardPress.js`.
- Does a push analyzer exist? Yes: `frontend/src/analyzers/pushMotionAnalyzer.js`.
- Does rep counting work? Unit-level simulation works. A direct Node simulation completed the expected state sequence and counted one rep. Browser runtime behavior is still not fully verified.
- Does distance sensor data affect analysis? Yes. The push analyzer uses calibrated distance for phase, push depth, sensor linearity, jitter, and scoring.
- Biggest immediate blocker: the sensor WebSocket path is not verified against a real Pi, and the default `ws://localhost:8765` conflicts with an existing local listener. Also, calibration does not itself start the app runner; the analyzer only runs when `recordingActive` is true.
- Smallest safe next implementation step: verify the Pi WebSocket independently with a tiny client, then make the app sensor URL/status explicit and add a hard "Begin routine" action that proves `recordingActive`, calibration, sensor stream, and analyzer state are all active.

## 2. Commands Run

```bash
cd frontend && npm run build
```

- Result: passed.
- Relevant output: Vite built successfully and emitted `dist`.
- Meaning: frontend compiles with current push/sensor files.
- Fix priority: none for build.

```bash
python3 -m py_compile backend/main.py backend/schemas.py backend/packet_merge.py backend/coach/mock_coach.py hardware/fake_sensor_server.py
```

- Result: passed.
- Meaning: syntax compiles under system Python.
- Fix priority: none for syntax.

```bash
PYTHONPATH=backend python3 - <<'PY'
import backend.main
print("backend.main import ok")
PY
```

- Result: failed under system `python3`.
- Error: Pydantic cannot evaluate annotations like `float | None` in this environment without Python 3.10+ support/backport behavior.
- Meaning: system `python3` is not the right backend runtime.
- Fix priority: P1 for developer ergonomics; P0 only if the demo uses system Python.

```bash
python3 -m uvicorn backend.main:app --host 127.0.0.1 --port 8019
```

- Result: failed.
- Error: `ModuleNotFoundError: No module named 'coach'`.
- Meaning: running from repo root without `PYTHONPATH=backend` breaks backend imports.
- Fix priority: P1. README/start scripts should be explicit.

```bash
PYTHONPATH=backend backend/.venv/bin/python - <<'PY'
import backend.main
print("backend.main import ok")
PY
```

- Result: passed.
- Meaning: backend imports correctly in the repo virtualenv.
- Fix priority: none if the demo always uses `backend/.venv`.

```bash
PYTHONPATH=backend backend/.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8019
```

- Result: passed. Server reached startup complete; I stopped it after verification.
- Meaning: backend can start from the repo virtualenv with the right import path.
- Fix priority: document or script this.

```bash
backend/.venv/bin/python - <<'PY'
import websockets
print("websockets import ok")
PY
```

- Result: passed.
- Meaning: the repo virtualenv has the fake WebSocket dependency.
- Fix priority: none for the venv.

```bash
python3 - <<'PY'
import websockets
print("websockets import ok")
PY
```

- Result: failed.
- Error: `ModuleNotFoundError: No module named 'websockets'`.
- Meaning: system Python cannot run the fake WebSocket server with WebSocket mode.
- Fix priority: P1 for setup clarity.

```bash
backend/.venv/bin/python hardware/fake_sensor_server.py
```

- Result: partial. The process started and served HTTP on `8010`, but WebSocket verification against `127.0.0.1:8765` failed.
- Meaning: fake HTTP path works; local WebSocket port is unsafe in this environment.
- Fix priority: P0 for sensor demo reliability.

```bash
curl -sS http://127.0.0.1:8010/sensor/latest
```

- Result: passed.
- Output shape included `device_id`, `timestamp_ms`, `sensor_status`, `recording_active`, `distance_cm`, `sensor_jitter_score`, `sensor_jitter_detected`, `sample_rate_hz`.
- Meaning: fake HTTP sensor endpoint works.
- Fix priority: none for fake HTTP.

```bash
backend/.venv/bin/python - <<'PY'
import asyncio
import websockets

async def main():
    async with websockets.connect("ws://127.0.0.1:8765") as ws:
        await ws.send('{"command":"start"}')
        for _ in range(3):
            print(await ws.recv())
        await ws.send('{"command":"stop"}')
        print(await ws.recv())
asyncio.run(main())
PY
```

- Result: failed.
- Error: timed out during opening handshake.
- Meaning: default local WebSocket target did not behave as the fake sensor WS.
- Fix priority: P0.

```bash
lsof -nP -iTCP:8765 -sTCP:LISTEN || true
```

- Result: showed `Code Helper` listening on `127.0.0.1:8765`; while fake server was running, Python also listened on `*:8765`.
- Meaning: browser connections to `ws://localhost:8765` or `ws://127.0.0.1:8765` may hit VS Code's listener, not the fake sensor server.
- Fix priority: P0 for local sensor demo.

```bash
node --input-type=module - <<'JS'
import { createPushMotionAnalyzer } from "./frontend/src/analyzers/pushMotionAnalyzer.js";
import { seatedOneArmForwardPress } from "./frontend/src/exercises/seatedOneArmForwardPress.js";
const analyzer = createPushMotionAnalyzer(seatedOneArmForwardPress);
const distances = [0.1, 98, 98.1, 60, 6.6, 60, 98];
const angles = [160, 95, 95, 125, 160, 125, 95];
let t = 1000;
for (let i = 0; i < distances.length; i += 1) {
  const out = analyzer.analyze({
    timestampMs: t,
    elbowAngle: angles[i],
    shoulderAngle: 35,
    landmarkConfidence: 0.9,
    validLandmarks: true,
    distanceCm: distances[i],
    sensorTimestampMs: t,
    calibrationCompressedCm: 98.14,
    calibrationStretchedCm: 6.42
  });
  console.log(out.phase, out.rep_count);
  t += 900;
}
JS
```

- Result: passed.
- Output sequence included `MOVE_TO_BENT`, `START_BENT_HOLD`, `START_BENT_READY`, `PUSHING`, `EXTENDED_HOLD`, `RETURNING`, `REP_COMPLETE`; final `rep_count` was `1`.
- Meaning: analyzer logic can count a simulated calibrated press rep.
- Fix priority: runtime integration still needs verification.

```bash
rg -n "...sensor/websocket/push search terms..." backend/main.py backend/schemas.py backend/packet_merge.py backend/coach frontend/src hardware vision shared .env.example README.md package.json frontend/package.json backend/requirements.txt
```

- Result: partial.
- Error: root `package.json` does not exist.
- Meaning: search still returned useful matches; root package file is not present.
- Fix priority: none.

```bash
find frontend/src backend hardware vision shared -maxdepth 3 -type f | sort
rg --files | rg '(^|/)(main|sensor_server|websocket_server|fake_sensor|sensor_client).*\.py$'
sed -n '...' <relevant files>
```

- Result: passed.
- Meaning: used for static audit of repo structure and code paths.
- Fix priority: none.

## 3. Repo Structure Relevant to Sensor + Push

```text
frontend/
  package.json
  src/main.jsx
  src/App.jsx
  src/api/client.js
  src/exercises/index.js
  src/exercises/seatedOneArmForwardPress.js
  src/analyzers/elbowFlexionAnalyzer.js
  src/analyzers/pushMotionAnalyzer.js
  src/sensors/useSensorStream.js
  src/components/BrowserPoseOverlay.jsx
  src/components/LiveSession.jsx
  src/components/ExerciseMovementDiagram.jsx
  src/components/ExercisePreview.jsx
  src/components/SessionSummary.jsx
  src/ai/coachVoiceScript.js
  src/ai/buildSessionHealthPacket.js
  src/ai/buildPhysioAIPacket.js
  src/ai/geminiCoachClient.js
  src/ai/elevenLabsClient.js
  src/state/exerciseRunner.js

backend/
  main.py
  schemas.py
  packet_merge.py
  mock_packet_generator.py
  session_store.py
  sqLite_store.py
  storage_provider.py
  requirements.txt
  coach/base.py
  coach/mock_coach.py
  coach/gemini_coach.py
  coach/voice_provider.py
  coach/avatar_provider.py
  coach/coach_orchestrator.py

hardware/
  fake_sensor_server.py
  sensor_client.py
  README.md

vision/
  pose_tracker.py
  angle_utils.py
  jitter.py
  rep_counter.py
  scoring.py
  packet_emitter.py
  overlay.py

shared/
  physio_packet_schema.json
  README.md
```

## 4. Raspberry Pi / Sensor Server Audit

- Raspberry Pi sensor server file: not found. Only `hardware/fake_sensor_server.py` exists.
- Sensor hardware assumed: none in code. Searches found no GPIO, HC-SR04, VL53L0X, ToF, or Raspberry Pi-specific hardware reads.
- Port: fake HTTP uses `8010`; fake WebSocket uses `8765`.
- WebSocket URL: fake server prints/uses `ws://localhost:8765`; frontend default also uses `ws://localhost:8765`.
- HTTP endpoints: fake server exposes `GET /sensor/latest`.
- Packet shape over HTTP: JSON with `device_id`, `timestamp_ms`, `sensor_status`, `recording_active`, `distance_cm`, `sensor_jitter_score`, `sensor_jitter_detected`, `sample_rate_hz`.
- Packet shape over WebSocket: text `Distance: xx.xx cm`; also sends JSON acknowledgements `{"status":"streaming_started"}` and `{"status":"streaming_stopped"}`.
- Sample rate: fake packet claims `20`; WebSocket loop sends roughly every `0.05` seconds while streaming.
- Timestamps: HTTP JSON includes `timestamp_ms`; WebSocket text does not, so the browser adds `Date.now()`.
- Validity/status: HTTP has `sensor_status`; WebSocket text does not, so frontend infers `ok` after parsing distance.
- Jitter: fake HTTP includes `sensor_jitter_score`; frontend also computes linearity/jitter from recent WS samples.
- Calibration: not in fake server. Calibration is in the frontend overlay.
- Sensor disconnect handling: fake server has no real hardware disconnect handling.
- CORS/origin: fake HTTP does not send CORS headers; browser does not use fake HTTP. WebSocket has no explicit origin filtering.
- Intended runtime: fake server is local/demo. There is no in-repo proof of a Pi deployment script.

Missing versus desired packet:

```text
Exists:
- device_id
- timestamp_ms for JSON/HTTP only
- distance_cm
- sensor_status for JSON/HTTP only
- sample_rate_hz for JSON/HTTP only
- sensor_jitter_score for JSON/HTTP or frontend-computed for WS

Missing or inconsistent:
- sensor_valid
- raw_distance_cm in current fake packet
- calibrated_distance_cm
- calibrated_start_distance_cm
- displacement_cm
- explicit direction
- robust hardware status
- real Pi sensor read
```

## 5. Sensor WebSocket Client Audit

- Frontend direct connection: yes, `frontend/src/sensors/useSensorStream.js`.
- Backend proxy: no. `backend/main.py` has `/ws/live` and `/ws/coach`, but no `/ws/sensor`.
- Current stream type: push exercise uses WebSocket directly from the browser. Python OpenCV path uses HTTP polling via `hardware/sensor_client.py`.
- URL configuration: `VITE_SENSOR_WS_URL`, then localStorage key `physio_sensor_ws_url`, then default `ws://localhost:8765`.
- Hardcoded default: yes, `ws://localhost:8765`.
- `.env.example`: includes `VITE_SENSOR_WS_URL=ws://localhost:8765` and `SENSOR_ENDPOINT=http://localhost:8010/sensor/latest`.
- Reconnect logic: no reconnect loop.
- Timeout logic: no app-level timeout beyond stale sample status.
- Last-known-value behavior: keeps `latestSampleRef` and retained samples, but stale status changes to warning/offline in overlay logic.
- Sensor offline fallback: partial. UI can show waiting/offline; analyzer can continue camera-only in some phases, but calibrated push flow is sensor-centered.
- UI status: calibration panel shows current distance and ready state. App integration status shows sensor online/offline from packets. Live metric cards show distance and linearity but not an explicit sensor status card.
- Sensor data reaches analyzer: yes through `BrowserPoseOverlay.jsx` into `createPushMotionAnalyzer`.

Critical local issue:

```text
Observed:
- Code Helper listens on 127.0.0.1:8765.
- Fake Python server also listened on *:8765 during test.
- WebSocket client to ws://127.0.0.1:8765 timed out during opening handshake.

Meaning:
- The default frontend URL can connect to the wrong process on this machine.
```

## 6. Sensor Data Contract Audit

Current sensor packet:

```text
- device_id: string; source: fake HTTP/JSON WS; used by packet UI/backend
- timestamp_ms: number; source: fake JSON or frontend Date.now for text WS; used for staleness
- sensor_status: ok/warning/error/offline; source: fake JSON or frontend inference; used by UI/packet
- recording_active: boolean; source: fake HTTP; not used by browser WS path
- distance_cm: number/null; source: fake or Pi WS; used by calibration/analyzer/UI
- sensor_jitter_score: number 0..1; source: fake JSON or frontend-computed; used by analyzer/scoring
- sensor_jitter_detected: boolean; source: fake JSON or frontend-computed; used by packet
- sample_rate_hz: number/null; source: fake JSON; not central to push analyzer
- raw_distance_cm: optional in schema only; not emitted by fake server
- filtered_distance_cm: optional in schema only; not emitted by fake server
```

Desired sensor packet comparison:

```text
timestamp_ms: partial
distance_cm: yes
sensor_valid: missing
sensor_status: partial
sample_rate_hz: partial
sensor_jitter_score: partial
calibrated_start_distance_cm: missing from raw stream, present as frontend calibration field
displacement_cm: missing
max_push_depth_cm: analyzer computes max_push_depth_cm internally
```

- Camera timestamp comparability: weak. Browser text WS timestamps are receive-time `Date.now()`, while MediaPipe loop uses a mix of animation timestamp and `Date.now()` in packet construction.
- Units: distance is centimeters.
- Direction: not globally defined. Analyzer derives direction from stretched minus compressed calibration values.
- Increasing distance meaning: not fixed. Calibration handles either sign.
- Calibration needed: yes, required for sensor-driven push phase.
- Start distance stored: yes in frontend calibration as `calibration_compressed_cm`; analyzer also uses `baselineDistanceCm`.
- Target push depth: configured as `targetPushDepthCm` and `minPushDepthCm` in exercise config.
- Sensor jitter: computed from recent distance changes in `useSensorStream.js` and `pushMotionAnalyzer.js`.
- Distance smoothing: no explicit low-pass smoothing; linearity/jitter scoring exists.

## 7. MediaPipe / Pose Tracking Audit

- Browser extraction: `frontend/src/components/BrowserPoseOverlay.jsx`.
- Python extraction: `vision/pose_tracker.py`, but it is hardcoded to emit `exercise: "right_arm_raise"` and uses shoulder raise rep logic. It is not the push analyzer path.
- Side used: right/left POSE maps exist. Push config defaults to right. UI side selection is limited.
- Elbow angle: browser computes angle at elbow using shoulder-elbow-wrist.
- Shoulder/upper-arm angle: browser computes upper arm angle from screen axis, despite naming it `shoulder_angle`.
- Wrist coordinates: included in packets as `wrist_coords`; not currently used by push analyzer phase logic.
- Landmark confidences: present from MediaPipe visibility/presence scores.
- Raw and smoothed angles: raw-ish computed angles are sent; jitter tracker exists, but no clear smoothed angle output.
- Invalid landmarks: represented with `angle_valid: false`, `camera_status: "warning"`, null angles, and a rejection reason.
- Tracker during push exercise: yes, browser overlay runs for the selected exercise.
- Hardcoded for elbow flexion: no for browser; it chooses analyzer by exercise. Python tracker is not push-aware and remains shoulder/right-arm-raise oriented.

Push needs:

```text
shoulder position: present
elbow position: present
wrist position: present
elbow angle: present
upper-arm/shoulder angle: present
arm horizontal alignment: approximate only via upper-arm angle/drift, not explicit horizontal metric
landmark confidence: present
validLandmarks: present as angle_valid/validLandmarks
```

## 8. Push Exercise Config Audit

- Config exists: yes.
- File: `frontend/src/exercises/seatedOneArmForwardPress.js`.
- ID: `seated_one_arm_forward_press`.
- Display name: `Seated One-Arm Forward Press`.
- Rep goal: `3`.
- Thresholds: start elbow `65-115`, target extension `145-178`, hold `1.2s`, min rep `2.0s`, max rep `7.0s`, target push depth `10cm`, min push depth `6cm`, sensor stale `500ms`, jitter `0.38`, shoulder drift `24deg`.
- Setup cue: sit tall facing sensor, keep shoulder/elbow/wrist/sensor path visible.
- Movement instructions: start bent, push forward, hold, return, keep shoulder relaxed/arm level.
- Listed in Exercises: yes, `frontend/src/exercises/index.js`.
- Can user start it: yes, it is status `ready`.
- Live Session analyzer selection: yes, browser overlay calls `createAnalyzerForExercise`, which selects push analyzer for movement type/id.

Missing from desired config:

```text
sensor required: not explicit as optional/preferred
camera-only fallback thresholds: implicit only
calibration stability requirements: not configured
left/right side user control: limited
```

## 9. Push Analyzer Audit

- Analyzer exists: yes, `frontend/src/analyzers/pushMotionAnalyzer.js`.
- Separate from elbow flexion: yes.
- Hacked into elbow analyzer: no.
- Input fields: timestamp, elbow angle, shoulder angle, landmark confidence, camera jitter, distance, sensor timestamp, sensor jitter, compressed/stretched calibration, valid landmarks.
- Uses `distance_cm`: yes.
- Uses elbow angle: yes.
- Uses wrist position: no.
- Uses sensor jitter: yes.
- Counts reps: yes in direct simulation.
- Stores rep metrics: yes, including push depth, max extension angle, line score, hold time, duration, jitter, shoulder drift, score, issue, clean.
- Hysteresis/debounce: partial via `transitionDebounceMs`.
- Missing sensor handling: partial. If no calibrated distance, camera-only start/push logic can work. If calibrated but sensor becomes invalid, some transitions degrade, but the flow is still fragile.
- Missing pose handling: does not count reps; returns low confidence output.
- Exposes `local_coach_message`: yes.

Current states:

```text
WAITING_FOR_TRACKING
MOVE_TO_BENT
START_BENT_HOLD
START_BENT_READY
PUSHING
EXTENDED_HOLD
RETURNING
REP_COMPLETE
SESSION_COMPLETE
```

Desired states are mostly present. `REP_COMPLETE` is a display state more than a durable analyzer state because the analyzer resets to `START_BENT_READY` or `SESSION_COMPLETE` after completion.

Current versus desired rep logic:

```text
1. Start bent/V shape detected: yes, via calibrated distance near bent or camera elbow angle.
2. User pushes hand forward: yes, via calibrated position or camera angle/depth.
3. Sensor confirms push depth: yes when sensor valid.
4. Elbow approaches straight: yes.
5. Arm roughly horizontal: partial; shoulder drift is used, explicit horizontal alignment is weak.
6. Hold briefly: yes.
7. Return to bent: yes.
8. Count one rep: yes in simulation.
```

Main analyzer risk: the browser overlay overrides the phase with `CALIBRATION_READY` for a short window after calibration. That is useful for voice, but it can make the UI look ready while the underlying app runner may not be recording.

## 10. Sensor + Pose Fusion Audit

- Fusion exists: yes, in `frontend/src/components/BrowserPoseOverlay.jsx` and `frontend/src/analyzers/pushMotionAnalyzer.js`.
- Backend fusion: no. `backend/packet_merge.py` preserves locally analyzed push packets but does not own push fusion.
- Correct location: local analyzer/front-end is consistent with the architecture rule that local analyzer owns biomechanics/rep counting.
- Current source of truth for push phase: `pushMotionAnalyzer` phase state, fed by calibrated sensor position and pose angles.
- Sensor and MediaPipe disagreement: no explicit conflict policy. Either elbow extension or depth can advance to hold, and return can be triggered by angle/depth rules.
- Sensor offline: partial camera-only fallback exists, but calibrated sensor workflows may still be confusing.
- MediaPipe loses landmarks: analyzer returns low confidence and does not count.
- Sensor data display only or analysis: analysis. It affects phase, depth, jitter/linearity, scoring, and rep metrics.
- Distance smoothed: no explicit smoothing.
- Pose angle smoothed: no explicit smoothing; jitter is measured.
- Time alignment: minimal. Recent sensor samples are compared by timestamp staleness, but there is no camera/sensor synchronization buffer.

Recommended fused input:

```text
timestamp_ms: present
pose.elbow_angle: present
pose.shoulder_angle: present
pose.wrist_x/y: present in packet, not analyzer
pose.valid_landmarks: present
pose.confidence: present
sensor.distance_cm: present
sensor.displacement_cm: computed internally, not packeted as displacement
sensor.sensor_valid: present in analyzer output, not backend schema
sensor.sensor_jitter_score: present
calibration.start_distance_cm: present as compressed
calibration.target_distance_cm: present as stretched
```

## 11. Calibration Audit

- Calibration step: yes, in `BrowserPoseOverlay.jsx`.
- Records start distance: yes as `compressedCm`/`calibration_compressed_cm`.
- User starts in bent position before calibration: prompted by UI/cue, but not enforced.
- Button like "Calibrate Start Position": yes, `Set Bent`.
- Automatic calibration at countdown start: no.
- Defines push direction: yes indirectly from stretched minus compressed.
- Defines target depth: yes indirectly by compressed/stretched travel plus exercise min/target depth thresholds.
- Handles noisy start distance: no averaging/stability window. It captures the latest sample immediately.
- Calibration quality: flags `low_travel` if travel is under 1 cm.

Important behavior:

```text
Set Bent / Set Stretched:
- stores current latest distance
- resets analyzer

Begin:
- resets analyzer
- clears samples
- shows a short calibration-ready cue
- does not dispatch a session/runner start event
```

This means "Ready. Begin routine." is not proof that the app runner is active. Actual analysis requires `recordingActive` to already be true.

## 12. Visualization / Preview Audit

- Push movement visualization exists: yes, `frontend/src/components/ExerciseMovementDiagram.jsx`.
- Technology: SVG animated by React state/requestAnimationFrame.
- Shows bent V start: yes.
- Shows forward horizontal extension: yes.
- Shows return: yes via phases.
- Shows sensor placement: yes, "Distance sensor" callout.
- Shows phase labels: yes: Bent, Press, Hold, Return.
- Hardcoded for elbow flexion: no, push branch exists for `seated_one_arm_forward_press`.
- Can reuse existing engine: yes, it already shares the diagram component.

## 13. Live UI Audit for Push Exercise

- Exercise-specific metrics: yes in `LiveSession.jsx`.
- Hardcoded elbow labels: partially. Forward press uses elbow as primary joint and special labels for target extension zone, push depth, distance linearity.
- Can show `distance_cm`: yes.
- Can show `push_depth_cm`: yes.
- Can show sensor status: not as a dedicated live metric card; status appears in integration/debug contexts.
- Can show sensor jitter: live shows combined jitter and distance linearity, not raw sensor jitter as a primary card.
- Can show phase names: yes through `analyzer_phase_label`.
- Can show calibration state: yes in overlay panel.
- Can show camera-only fallback: partial. Camera permission/offline states exist; push-specific sensor fallback messaging is not crisp.

Desired live push metrics status:

```text
rep count: yes
phase: yes
elbow angle: yes
push depth: yes
sensor distance: yes
sensor jitter: partial
arm alignment: partial via upper arm drift
hold time: yes
pace: not prominent in LiveSession cards
PhysioScore: yes
sensor status: partial
camera status: partial/debug
```

## 14. Results / Recording Audit

- Session recording JSON: partial. Frontend stores active packets/completed reps in runner state and can save summaries. Backend stores packets and summaries.
- Records sensor samples: no raw sensor sample array in final session summary. Packets contain sampled distance fields.
- Records pose samples: packets contain pose values, but no explicit raw pose sample array in summary.
- Records rep events: no structured event list.
- Records completed reps: yes in frontend runner summaries.
- Results generic enough for push metrics: frontend summary is, backend `SessionSummary` schema is not fully extended for push metrics.
- Gemini receives push metrics after session: yes through `buildSessionHealthPacket.js` and `/api/ai/session-summary`.
- ElevenLabs/HeyGen presentation: ElevenLabs route exists. HeyGen provider exists in backend, but no specific push report route was found.

Desired recorded data status:

```text
samples.timestamp/elbow/wrist/distance/displacement/phase/rep_count: partial through packets; not normalized session artifact
events.start_bent_ready/pushing_started/target_extension_reached/hold_completed/returning_started/rep_completed: missing
rep metrics.push_depth/max_extension_angle/hold_time/jitter/score: present in completed reps
```

## 15. Backend Route Audit

```text
Route: /api/health
Method: GET
File: backend/main.py
Purpose: backend health
Input: none
Output: service status
Frontend used: yes
Problem: none
```

```text
Route: /api/coach/provider-status
Method: GET
File: backend/main.py
Purpose: report Gemini/ElevenLabs/HeyGen config
Input: none
Output: provider/env status booleans
Frontend used: yes
Problem: none
```

```text
Route: /api/session/start
Method: POST
File: backend/main.py
Purpose: create active session
Input: user_id, exercise, side, target_angle
Output: session_id
Frontend used: yes
Problem: not tied to push calibration begin button
```

```text
Route: /api/packets
Method: POST
File: backend/main.py
Purpose: ingest PhysioPacket
Input: PhysioPacket
Output: accepted status/count
Frontend used: yes
Problem: backend schema ignores/does not model many push extras
```

```text
Route: /api/live/latest
Method: GET
File: backend/main.py
Purpose: latest source packet
Input: source query python/browser/mock
Output: PhysioPacket
Frontend used: yes
Problem: no sensor-specific latest endpoint
```

```text
Route: /api/live/source
Method: GET
File: backend/main.py
Purpose: active packet source status
Input: none
Output: active source, packet ages, frame availability
Frontend used: yes
Problem: does not expose sensor WS status directly
```

```text
Route: /api/vision/frame
Method: POST/GET
File: backend/main.py
Purpose: store/read latest Python OpenCV overlay frame
Input: JPEG bytes for POST
Output: accepted bytes or image/SVG
Frontend used: yes
Problem: Python tracker is not push-aware
```

```text
Route: /api/coach/cue
Method: POST
File: backend/main.py
Purpose: local/provider cue from packet
Input: PhysioPacket
Output: CoachCueResponse
Frontend used: yes/available
Problem: live push should remain local; current mock returns local message for push
```

```text
Route: /api/ai/gemini-coach
Method: POST
File: backend/main.py
Purpose: live Gemini cue
Input: safe packet
Output: short cue
Frontend used: available
Problem: architecture says Gemini should not judge raw form live; current frontend scripted cue path appears to avoid relying on it
```

```text
Route: /api/ai/session-summary
Method: POST
File: backend/main.py
Purpose: Gemini post-session summary
Input: summary
Output: recommendation/health report
Frontend used: yes
Problem: okay for intended architecture
```

```text
Route: /api/ai/elevenlabs-tts
Method: POST
File: backend/main.py
Purpose: synthesize speech
Input: text
Output: audio info/url/path
Frontend used: yes
Problem: no problem; provider may be mock/missing keys
```

```text
Route: /api/session/end
Method: POST
File: backend/main.py
Purpose: backend session summary
Input: session_id, pain_level, fatigue_level
Output: SessionSummary
Frontend used: yes
Problem: backend summary schema is generic and loses rich push metrics
```

```text
Route: /api/session/save-result
Method: POST
File: backend/main.py
Purpose: save frontend result payload
Input: arbitrary summary dict
Output: saved status
Frontend used: yes
Problem: accepts rich result, but contract is loose
```

```text
Route: /api/session/results
Method: GET
File: backend/main.py
Purpose: list saved session results
Input: none
Output: stored result dicts
Frontend used: yes
Problem: none for audit
```

```text
Route: /api/storage/status
Method: GET
File: backend/main.py
Purpose: storage counts
Input: none
Output: counts
Frontend used: unknown
Problem: none
```

```text
Route: /ws/live
Method: WebSocket
File: backend/main.py
Purpose: broadcast latest active PhysioPacket
Input: none after connect
Output: packet JSON every 0.5s
Frontend used: unknown/not primary
Problem: not sensor stream
```

```text
Route: /ws/coach
Method: WebSocket
File: backend/main.py
Purpose: websocket coach cue
Input: PhysioPacket JSON
Output: CoachCueResponse
Frontend used: helper exists
Problem: not sensor stream
```

Missing routes:

```text
/ws/sensor
/api/sensor/latest
/api/recordings/v2/session
/api/analysis/v2/gemini-session-analysis
/api/presentation/v2/elevenlabs-summary
/api/presentation/v2/heygen-session-coach
```

Equivalent current routes exist for some older names, but not the exact v2 routes.

## 16. Environment / Config Audit

```text
Variable | File(s) | Frontend/backend/Pi | Required? | Secret? | Notes
VITE_API_BASE | frontend/src/api/client.js | frontend | yes for non-local backend | no | default http://localhost:8000
PHYSIO_BACKEND_URL | .env.example, vision/README path | backend/vision | optional | no | backend URL for Python tracker/emitter
SENSOR_ENDPOINT | .env.example, hardware/sensor_client.py | Python/vision | optional | no | default http://localhost:8010/sensor/latest
VITE_SENSOR_WS_URL | .env.example, frontend/src/sensors/useSensorStream.js | frontend | yes for real Pi | no | default ws://localhost:8765; local port conflict observed
RASPBERRY_PI_HOST | not found | Pi/frontend | missing | no | would be useful
GEMINI_PROVIDER | not found | backend | no | no | provider appears controlled by COACH_PROVIDER/env/provider classes
GOOGLE_CLOUD_PROJECT | .env.example | backend | only for Gemini | not usually secret | value present in example; no secret printed here
GOOGLE_CLOUD_LOCATION | .env.example | backend | only for Gemini | no | present
GEMINI_MODEL | .env.example | backend | only for Gemini | no | present
ELEVENLABS_API_KEY | .env.example, backend/coach/voice_provider.py | backend | only for real voice | yes | blank in example
ELEVENLABS_VOICE_ID | .env.example, backend/coach/voice_provider.py | backend | only for real voice | maybe | blank in example
HEYGEN_API_KEY | .env.example, backend/coach/avatar_provider.py | backend | only for real avatar | yes | blank in example
HEYGEN_AVATAR_ID | .env.example, backend/coach/avatar_provider.py | backend | only for real avatar | maybe | blank in example
HEYGEN_VOICE_ID | .env.example, backend/coach/avatar_provider.py | backend | only for real avatar | maybe | blank in example
```

Flags:

- Hardcoded Pi/default port: `ws://localhost:8765`.
- Hardcoded API keys: none found in audited files.
- Frontend secret leakage: none found; only non-secret Vite sensor/API URLs are frontend-exposed.
- Config mismatch: Python sensor path uses HTTP `SENSOR_ENDPOINT`; browser push path uses WebSocket `VITE_SENSOR_WS_URL`.

## 17. Failure Mode Audit

```text
P0: WebSocket server not running or wrong process on port 8765.
Evidence: lsof shows Code Helper on 127.0.0.1:8765; WS handshake timed out.

P0: Wrong Pi IP/port.
Evidence: default VITE_SENSOR_WS_URL is local; real Pi URL must be explicitly configured.

P0: Frontend calibration does not start app runner.
Evidence: Begin button only resets analyzer/samples; analysis requires recordingActive.

P0: Push analyzer not selected if source is Python OpenCV.
Evidence: vision/pose_tracker.py emits right_arm_raise and uses RepCounter, not push analyzer.

P1: Packets have shape differences.
Evidence: WS text has only distance; JSON/HTTP has status/timestamp/jitter. Frontend fills gaps.

P1: Distance direction can be reversed.
Evidence: analyzer handles direction from calibration, but UI does not clearly validate bent versus stretched order.

P1: No calibration stability/averaging.
Evidence: Set Bent/Stretched captures one latest distance sample.

P1: Sensor noisy.
Evidence: jitter scoring exists but no smoothing/filtering before phase decisions.

P1: MediaPipe jitter.
Evidence: camera jitter is measured, but angles are not explicitly smoothed.

P1: Analyzer expects fields that may be missing.
Evidence: it requires valid landmarks, elbow angle, shoulder angle, confidence; missing pose blocks counting.

P1: Live UI still has some elbow-flexion assumptions.
Evidence: push is `joint: "elbow"` and uses target elbow labels; acceptable but not a full chest-press vocabulary.

P1: Backend schema loses push extras.
Evidence: `PhysioPacket` lacks typed push fields like push_depth_cm and calibration fields; extras are accepted loosely but not modeled.

P2: Browser mixed content risk.
Evidence: if frontend is served over HTTPS, `ws://` to Pi would be blocked; no `wss://` fallback policy.

P2: CORS/origin issue.
Evidence: browser uses WS directly; fake WS has no origin policy. Real Pi policy unknown.

P2: Fallback/mock can overwrite real data.
Evidence: backend active source falls back among python/browser/mock based on recency.
```

## 18. Recommended Fix Plan

Do not implement during this audit. Recommended order:

1. Verify Pi WebSocket independently with a tiny client against `ws://<pi-host>:8765`; confirm start, distance messages, stop, and close behavior.
2. Resolve local port conflict. Do not rely on `localhost:8765` while VS Code owns `127.0.0.1:8765`.
3. Make frontend sensor URL visible/editable in Debug and show raw connection status, latest packet, packet age, and command ack.
4. Make calibration capture a short stable average instead of a single latest sample.
5. Add an explicit push "Begin routine" transition that proves the runner is active, calibration is complete, and analyzer has been reset.
6. Verify MediaPipe push pose fields live: shoulder, elbow, wrist, elbow angle, upper-arm angle, confidence, `angle_valid`.
7. Add a camera-only push analyzer smoke test and keep it passing without sensor.
8. Add sensor displacement into analyzer as an explicit field and packet output.
9. Add sensor jitter/linearity into scoring after displacement works.
10. Add push live UI cards for sensor status, camera status, calibrated position, and phase.
11. Add structured push recording: samples, events, completed reps.
12. Send only structured session metrics to Gemini after session.
13. Let ElevenLabs read the concise summary and keep HeyGen as optional presentation.

## 19. Minimal Demo Fallback Plan

- Demo playback mode: no clear dedicated playback mode found.
- Saved sample sensor JSON: no known good push sensor sample file found.
- Replay one known good session: not implemented as a first-class path.
- Clear demo playback label: not implemented.
- Camera-only live UI: partially possible in browser if sensor is missing, but push calibration currently expects sensor values for the intended flow.

Safest fallback:

```text
1. Keep browser MediaPipe camera-only push analyzer working.
2. Label sensor as offline if Pi fails.
3. Allow a manual camera-only routine start.
4. Use a clearly labeled "Demo playback" only if replay data is added.
5. Do not silently fake live sensor data during judging.
```

## 20. Final Verdict

```text
Repo ready for push implementation: partial
Main blocker: unverified/fragile sensor WebSocket path, including a local port conflict on 8765
Most likely bug: calibration says ready, but the actual runner/analyzer is not active or not receiving valid packets; Begin only resets local analyzer state
Smallest fix: verify the Pi WS URL externally, expose sensor status/debug, and wire Begin routine to an explicit active analyzer state check
Files to edit first:
- frontend/src/sensors/useSensorStream.js
- frontend/src/components/BrowserPoseOverlay.jsx
- frontend/src/analyzers/pushMotionAnalyzer.js
- frontend/src/components/LiveSession.jsx
- .env.example
Files to avoid editing:
- backend/coach/gemini_coach.py unless post-session summary contract changes
- backend/coach/voice_provider.py unless TTS delivery changes
- vision/pose_tracker.py unless Python OpenCV must support push
- storage/database files unless recording schema is intentionally changed
Recommended next prompt:
Implement the smallest push reliability fix: make sensor URL/status explicit, remove localhost:8765 assumptions, make calibration Begin start a verified active analyzer state, and add a camera-only fallback path without changing Gemini live behavior.
```
