# REPO_AUDIT.md

## 1. Executive Summary

- App start: Unknown (no commands run in this audit). Entry point is [physio/frontend/src/main.jsx](physio/frontend/src/main.jsx#L1-L10).
- Page render / blank page: Unknown (no runtime checks). An error boundary exists in [physio/frontend/src/components/AppErrorBoundary.jsx](physio/frontend/src/components/AppErrorBoundary.jsx#L1-L24) and is wired in [physio/frontend/src/main.jsx](physio/frontend/src/main.jsx#L1-L10), which should show a fallback instead of a blank page if a render error occurs.
- `npm run build`: Unknown (not run).
- `npm run dev`: Unknown (not run).
- Local elbow analysis: Present. Analyzer lives in [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js#L1-L248) and is used in [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx#L220-L372).
- Gemini integration: Present in backend and used via frontend calls to backend endpoints. Backend provider in [physio/backend/coach/gemini_coach.py](physio/backend/coach/gemini_coach.py#L1-L104); endpoints in [physio/backend/main.py](physio/backend/main.py#L357-L433); frontend client in [physio/frontend/src/ai/geminiCoachClient.js](physio/frontend/src/ai/geminiCoachClient.js#L1-L10).
- ElevenLabs integration: Present in backend with frontend trigger. Backend provider in [physio/backend/coach/voice_provider.py](physio/backend/coach/voice_provider.py#L1-L91); endpoint in [physio/backend/main.py](physio/backend/main.py#L444-L455); frontend trigger in [physio/frontend/src/ai/elevenLabsClient.js](physio/frontend/src/ai/elevenLabsClient.js#L1-L16).
- AI called from: Frontend triggers backend endpoints; no direct Gemini/ElevenLabs calls in the frontend. Evidence: [physio/frontend/src/ai/geminiCoachClient.js](physio/frontend/src/ai/geminiCoachClient.js#L1-L10), [physio/frontend/src/ai/elevenLabsClient.js](physio/frontend/src/ai/elevenLabsClient.js#L1-L16), [physio/backend/main.py](physio/backend/main.py#L357-L455).
- Biggest immediate blocker: Unknown because runtime/build status was not verified. There is also a high-risk secret-management issue: a plaintext .env file is present in the repo (do not expose its contents). Evidence: [physio/.env](physio/.env) and [physio/backend/env_loader.py](physio/backend/env_loader.py#L1-L24).

## 2. Commands Run

- None. This audit did not execute commands.

## 3. Repository Structure

- frontend/
  - Entry: [physio/frontend/src/main.jsx](physio/frontend/src/main.jsx#L1-L10)
  - App shell + navigation: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L1-L1080)
  - API client: [physio/frontend/src/api/client.js](physio/frontend/src/api/client.js#L1-L90)
  - Exercises: [physio/frontend/src/exercises/index.js](physio/frontend/src/exercises/index.js#L1-L48), [physio/frontend/src/exercises/elbowFlexionExtension.js](physio/frontend/src/exercises/elbowFlexionExtension.js#L1-L43)
  - Analyzer: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js#L1-L248)
  - AI clients: [physio/frontend/src/ai/geminiCoachClient.js](physio/frontend/src/ai/geminiCoachClient.js#L1-L10), [physio/frontend/src/ai/elevenLabsClient.js](physio/frontend/src/ai/elevenLabsClient.js#L1-L16)
  - Live tracking: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx#L1-L458)
  - Movement preview: [physio/frontend/src/components/ExerciseMovementDiagram.jsx](physio/frontend/src/components/ExerciseMovementDiagram.jsx#L1-L170)
- backend/
  - Entry: [physio/backend/main.py](physio/backend/main.py#L1-L520)
  - Schemas: [physio/backend/schemas.py](physio/backend/schemas.py#L1-L180)
  - Packet rules: [physio/backend/packet_merge.py](physio/backend/packet_merge.py#L1-L86)
  - AI providers: [physio/backend/coach/gemini_coach.py](physio/backend/coach/gemini_coach.py#L1-L104), [physio/backend/coach/voice_provider.py](physio/backend/coach/voice_provider.py#L1-L91), [physio/backend/coach/avatar_provider.py](physio/backend/coach/avatar_provider.py#L1-L103)
  - Coach orchestration: [physio/backend/coach/coach_orchestrator.py](physio/backend/coach/coach_orchestrator.py#L1-L149)
  - Storage: [physio/backend/storage_provider.py](physio/backend/storage_provider.py#L1-L29), [physio/backend/sqLite_store.py](physio/backend/sqLite_store.py#L1-L94)
- vision/
  - Python OpenCV tracker: [physio/vision/pose_tracker.py](physio/vision/pose_tracker.py#L1-L220)
- hardware/
  - Sensor client: [physio/hardware/sensor_client.py](physio/hardware/sensor_client.py#L1-L33)
- shared/
  - Packet schema: [physio/shared/physio_packet_schema.json](physio/shared/physio_packet_schema.json)
- Environment/config:
  - .env.example: [physio/.env.example](physio/.env.example)
  - .env loader: [physio/backend/env_loader.py](physio/backend/env_loader.py#L1-L24)

## 4. App Startup and Blank Page Audit

Blank page status: Unknown (no runtime inspection performed).

Likely cause: Not identified. AppErrorBoundary is wired and should render a fallback if a render error occurs. Evidence: [physio/frontend/src/components/AppErrorBoundary.jsx](physio/frontend/src/components/AppErrorBoundary.jsx#L1-L24), [physio/frontend/src/main.jsx](physio/frontend/src/main.jsx#L1-L10).

Files involved:
- [physio/frontend/src/main.jsx](physio/frontend/src/main.jsx#L1-L10)
- [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L1-L1080)

Fix priority: P0 if a blank page is reproducible; otherwise verify with `npm run dev` and browser console.

## 5. Navigation and UI Flow Audit

Expected pages/tabs:

- Exercises
  - Exists: Yes
  - File(s): [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L563-L742), [physio/frontend/src/components/ExercisePreview.jsx](physio/frontend/src/components/ExercisePreview.jsx#L1-L74)
  - What works: Exercise list, preview, and begin flow are present.
  - What is missing: Separate ExerciseList/ExerciseDetail components do not exist; ExercisesPage is inline.
  - Potential issue: None from static inspection.

- Live Session
  - Exists: Yes
  - File(s): [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L743-L854), [physio/frontend/src/components/LiveSession.jsx](physio/frontend/src/components/LiveSession.jsx#L1-L177)
  - What works: Live webcam analysis, countdown, rep timing, coach panel.
  - What is missing: None obvious.
  - Potential issue: Source mode defaults to browser; Python tracker requires explicit debug toggle. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L37-L48), [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L930-L967).

- Results
  - Exists: Yes
  - File(s): [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L855-L896), [physio/frontend/src/components/SessionSummary.jsx](physio/frontend/src/components/SessionSummary.jsx#L1-L98)
  - What works: Session summary and rep breakdown.
  - What is missing: None obvious.
  - Potential issue: AI summary is optional; fallback uses local recommendation text.

- Debug/System Status
  - Exists: Yes
  - File(s): [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L897-L1050)
  - What works: Source toggle, status, raw JSON views, AI/voice status.
  - What is missing: None obvious.
  - Potential issue: Developer controls are present and can switch source mode. This is intentional but could confuse demo flow.

Developer-only controls and toggles:
- Source mode selection (Python OpenCV / Browser / Mock) in DebugPage: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L923-L965).
- Voice toggles in CoachPanel: [physio/frontend/src/components/CoachPanel.jsx](physio/frontend/src/components/CoachPanel.jsx#L38-L67).

## 6. Exercise System Audit

Exercise config present: Yes

Files:
- [physio/frontend/src/exercises/elbowFlexionExtension.js](physio/frontend/src/exercises/elbowFlexionExtension.js#L1-L43)
- [physio/frontend/src/exercises/index.js](physio/frontend/src/exercises/index.js#L1-L48)

Export style: Named export per exercise and a default exercise list.

Imported by: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L33-L39)

Missing fields: None obvious for the elbow exercise; config includes setup cue, clinical framing, target range, rep goal, hold duration, thresholds.

Specific exercise check:
- id: elbow_flexion_extension
- name: Elbow Flexion / Extension
Evidence: [physio/frontend/src/exercises/elbowFlexionExtension.js](physio/frontend/src/exercises/elbowFlexionExtension.js#L1-L9)

Risk: Low for config presence; validation relies on analyzer logic.

## 7. Movement Preview Audit

Preview implemented: Yes

File(s): [physio/frontend/src/components/ExerciseMovementDiagram.jsx](physio/frontend/src/components/ExerciseMovementDiagram.jsx#L1-L170)

Technology used: SVG with animated rotation (no Three.js).

Animation exists: Yes (requestAnimationFrame loop). Evidence: [physio/frontend/src/components/ExerciseMovementDiagram.jsx](physio/frontend/src/components/ExerciseMovementDiagram.jsx#L60-L88).

Problems: None obvious from static inspection.

## 8. Webcam / Pose Tracking Audit

Tracking source(s):
- Browser MediaPipe Tasks Vision (primary in UI): [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx#L220-L458)
- Python OpenCV + MediaPipe (optional): [physio/vision/pose_tracker.py](physio/vision/pose_tracker.py#L1-L220)

Main active source: Browser MediaPipe by default (source mode defaults to browser). Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L37-L48).

Fallback sources: Python OpenCV (debug toggle), Mock demo. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L923-L965).

Files:
- [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx#L220-L458)
- [physio/vision/pose_tracker.py](physio/vision/pose_tracker.py#L1-L220)

Output packet shape (browser): includes elbow_angle, shoulder_angle, landmark_confidence, jitter, rep_phase, and analyzer output. Evidence: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx#L300-L372).

Known validity checks:
- Browser: `validAnalysis` gate, minimum landmark confidence, angle validity, rejection reasons. Evidence: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx#L255-L331).
- Python: camera status and presence checks, `angle_valid` flag. Evidence: [physio/vision/pose_tracker.py](physio/vision/pose_tracker.py#L70-L180).

Invalid values representation:
- Browser: invalid angles are null; `angle_valid` false. Evidence: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx#L321-L356).
- Python: invalid angles are None. Evidence: [physio/vision/pose_tracker.py](physio/vision/pose_tracker.py#L108-L145).
- Backend waiting packet uses 0.0 values when no real packet is present. Evidence: [physio/backend/main.py](physio/backend/main.py#L41-L80).

Note: Python tracker emits exercise right_arm_raise, not elbow flexion. Evidence: [physio/vision/pose_tracker.py](physio/vision/pose_tracker.py#L116-L134). This mismatches the elbow-focused frontend flow.

## 9. Local Analyzer Audit

Analyzer present: Yes

File(s): [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js#L1-L248)

Input shape: frames with elbowAngle, shoulderAngle, landmarkConfidence, jitterScore, validLandmarks. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js#L92-L120).

Output shape: coach_state, rep_count, phase, pace, physio_score, completed_rep, range_of_motion, shoulder_drift, hold_time_sec. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js#L200-L248).

State machine states:
- WAITING_FOR_START, EXTENDED_READY, FLEXING, FLEXED_HOLD, EXTENDING, REP_COMPLETE, SESSION_COMPLETE. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js#L122-L218).

Rep counting thresholds:
- Start: straight-enough elbow based on startElbowMin.
- Flex into target zone, hold for required seconds, then extend back to straight. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js#L151-L218).

Scoring formula:
- Range 35%, smoothness 20%, pace 20%, hold 15%, stability 10%. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js#L34-L66).

Coach states:
- good_form, bend_more, straighten_more, too_fast, too_slow, too_jittery, hold_longer, keep_upper_arm_still, low_confidence, rep_complete, session_complete. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js#L1-L44), [physio/backend/schemas.py](physio/backend/schemas.py#L12-L31).

Known risks:
- Analyzer expects validLandmarks; invalid frames produce low_confidence and null scores. Evidence: [physio/frontend/src/analyzers/elbowFlexionAnalyzer.js](physio/frontend/src/analyzers/elbowFlexionAnalyzer.js#L183-L209).

## 10. Session State / Results Audit

Countdown present: Yes (client-side timer). Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L118-L151), [physio/frontend/src/components/CountdownOverlay.jsx](physio/frontend/src/components/CountdownOverlay.jsx#L1-L11).

Session state present: Yes (exerciseRunner reducer and live session status). Evidence: [physio/frontend/src/state/exerciseRunner.js](physio/frontend/src/state/exerciseRunner.js#L1-L120).

Results page present: Yes. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L855-L896).

Summary metrics:
- total reps, clean reps, best/average ROM, average score, jitter, common issue, recommendation. Evidence: [physio/frontend/src/state/exerciseRunner.js](physio/frontend/src/state/exerciseRunner.js#L122-L248), [physio/frontend/src/components/SessionSummary.jsx](physio/frontend/src/components/SessionSummary.jsx#L18-L66).

Fallback behavior:
- Local summary is generated in frontend and persisted in localStorage. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L646-L721), [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L703-L733).

Problems: None obvious from static inspection; backend summary also exists for server-side sessions. Evidence: [physio/backend/main.py](physio/backend/main.py#L459-L520).

## 11. Gemini Integration Audit

Gemini present: Yes

Files:
- Backend provider: [physio/backend/coach/gemini_coach.py](physio/backend/coach/gemini_coach.py#L1-L104)
- Backend endpoints: [physio/backend/main.py](physio/backend/main.py#L357-L433)
- Frontend client: [physio/frontend/src/ai/geminiCoachClient.js](physio/frontend/src/ai/geminiCoachClient.js#L1-L10)
- AI packet builder: [physio/frontend/src/ai/buildPhysioAIPacket.js](physio/frontend/src/ai/buildPhysioAIPacket.js#L1-L30)

Package used: Direct HTTP to Gemini REST API in backend (no SDK). Evidence: [physio/backend/coach/gemini_coach.py](physio/backend/coach/gemini_coach.py#L67-L83).

Provider style: AI Studio API key (GEMINI_API_KEY).

Called from: Backend endpoints only; frontend calls `/api/ai/*`. Evidence: [physio/frontend/src/api/client.js](physio/frontend/src/api/client.js#L62-L75).

Model: Configurable via GEMINI_MODEL. Evidence: [physio/backend/coach/gemini_coach.py](physio/backend/coach/gemini_coach.py#L18-L21).

Environment variables used: GEMINI_API_KEY, GEMINI_MODEL, GEMINI_TIMEOUT_SEC. Evidence: [physio/backend/coach/gemini_coach.py](physio/backend/coach/gemini_coach.py#L18-L21).

Failure handling: Backend returns local fallback text and status fields. Evidence: [physio/backend/main.py](physio/backend/main.py#L357-L390), [physio/backend/coach/gemini_coach.py](physio/backend/coach/gemini_coach.py#L24-L46).

Throttle logic: Frontend throttles calls by coach_state/rep change or time gap. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L520-L586).

Fallback to local cue: Yes. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L552-L585), [physio/backend/main.py](physio/backend/main.py#L357-L390).

Safety checks:
- Raw landmarks are not sent; structured packet only. Evidence: [physio/frontend/src/ai/buildPhysioAIPacket.js](physio/frontend/src/ai/buildPhysioAIPacket.js#L1-L30).

Potential brittleness:
- There are two AI paths: `/api/coach/cue` (provider orchestrator) and `/api/ai/gemini-coach` (direct). This duplication could cause inconsistent cues. Evidence: [physio/backend/main.py](physio/backend/main.py#L316-L455).

## 12. ElevenLabs Integration Audit

ElevenLabs present: Yes

Files:
- Backend provider: [physio/backend/coach/voice_provider.py](physio/backend/coach/voice_provider.py#L1-L91)
- Backend endpoint: [physio/backend/main.py](physio/backend/main.py#L444-L455)
- Frontend client: [physio/frontend/src/ai/elevenLabsClient.js](physio/frontend/src/ai/elevenLabsClient.js#L1-L16)

Called from: Backend (frontend posts text to `/api/ai/elevenlabs-tts`). Evidence: [physio/frontend/src/api/client.js](physio/frontend/src/api/client.js#L76-L80).

Environment variables: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL_ID, ELEVENLABS_TIMEOUT_SEC, ELEVENLABS_STABILITY, ELEVENLABS_SIMILARITY_BOOST. Evidence: [physio/backend/coach/voice_provider.py](physio/backend/coach/voice_provider.py#L29-L50).

Input text source: AI cue text in frontend; only text is posted. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L587-L639).

Audio playback method: Browser Audio element using returned URL. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L599-L635).

Mute toggle: Yes. Evidence: [physio/frontend/src/components/CoachPanel.jsx](physio/frontend/src/components/CoachPanel.jsx#L52-L67).

Spam prevention: Yes (VOICE_MIN_GAP_MS and state-based gating). Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L587-L639).

Failure handling: Voice status set to error/blocked/unavailable with UI feedback. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L599-L639), [physio/backend/coach/voice_provider.py](physio/backend/coach/voice_provider.py#L65-L83).

## 13. Backend / API Route Audit

Backend present: Yes (FastAPI).

Routes:
- GET /api/health
  - File: [physio/backend/main.py](physio/backend/main.py#L176-L179)
  - Purpose: Health check
  - Input/Output: none / status JSON
  - Uses secrets: No

- GET /api/coach/provider-status
  - File: [physio/backend/main.py](physio/backend/main.py#L183-L201)
  - Purpose: provider availability summary
  - Uses secrets: Reads env vars but does not return secrets

- POST /api/session/start
  - File: [physio/backend/main.py](physio/backend/main.py#L199-L233)
  - Purpose: start session, reset state

- POST /api/packets
  - File: [physio/backend/main.py](physio/backend/main.py#L234-L257)
  - Purpose: ingest live PhysioPacket

- GET /api/live/latest
  - File: [physio/backend/main.py](physio/backend/main.py#L260-L262)
  - Purpose: read latest packet for a given source

- GET /api/live/source
  - File: [physio/backend/main.py](physio/backend/main.py#L265-L279)
  - Purpose: source status metadata

- POST /api/vision/frame
  - File: [physio/backend/main.py](physio/backend/main.py#L284-L292)
  - Purpose: ingest Python overlay frame

- GET /api/vision/frame
  - File: [physio/backend/main.py](physio/backend/main.py#L294-L315)
  - Purpose: serve latest overlay frame

- POST /api/coach/cue
  - File: [physio/backend/main.py](physio/backend/main.py#L316-L321)
  - Purpose: local/AI cue orchestrator

- POST /api/ai/gemini-coach
  - File: [physio/backend/main.py](physio/backend/main.py#L357-L390)
  - Purpose: Gemini live cue generation
  - Uses secrets: GEMINI_API_KEY

- POST /api/ai/session-summary
  - File: [physio/backend/main.py](physio/backend/main.py#L392-L433)
  - Purpose: Gemini summary generation
  - Uses secrets: GEMINI_API_KEY

- POST /api/ai/elevenlabs-tts
  - File: [physio/backend/main.py](physio/backend/main.py#L444-L455)
  - Purpose: ElevenLabs speech synthesis
  - Uses secrets: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID

- POST /api/session/end
  - File: [physio/backend/main.py](physio/backend/main.py#L459-L507)
  - Purpose: end session and store summary

- GET /api/sessions
  - File: [physio/backend/main.py](physio/backend/main.py#L511-L513)
  - Purpose: list summaries

- GET /api/storage/status
  - File: [physio/backend/main.py](physio/backend/main.py#L516-L518)
  - Purpose: storage stats

WebSocket routes:
- /ws/live
  - File: [physio/backend/main.py](physio/backend/main.py#L521-L537)
  - Purpose: stream live packets

- /ws/coach
  - File: [physio/backend/main.py](physio/backend/main.py#L540-L561)
  - Purpose: request/receive coach cues

## 14. Environment Variable Audit

Variable | Used in file(s) | Required? | Frontend or Backend? | Secret? | Notes
---|---|---|---|---|---
VITE_API_BASE | [physio/frontend/src/api/client.js](physio/frontend/src/api/client.js#L1-L2), [physio/frontend/src/components/CoachPanel.jsx](physio/frontend/src/components/CoachPanel.jsx#L1-L8) | Optional | Frontend | No | API base for frontend.
GEMINI_API_KEY | [physio/backend/coach/gemini_coach.py](physio/backend/coach/gemini_coach.py#L18-L21) | Required for Gemini | Backend | Yes | Should not be committed.
GEMINI_MODEL | [physio/backend/coach/gemini_coach.py](physio/backend/coach/gemini_coach.py#L18-L21) | Optional | Backend | No | Defaults to gemini-1.5-flash.
GEMINI_TIMEOUT_SEC | [physio/backend/coach/gemini_coach.py](physio/backend/coach/gemini_coach.py#L18-L21) | Optional | Backend | No | Request timeout.
COACH_PROVIDER | [physio/backend/coach/coach_orchestrator.py](physio/backend/coach/coach_orchestrator.py#L124-L129) | Optional | Backend | No | mock or gemini.
VOICE_PROVIDER | [physio/backend/coach/voice_provider.py](physio/backend/coach/voice_provider.py#L85-L90) | Optional | Backend | No | mock or elevenlabs.
AVATAR_PROVIDER | [physio/backend/coach/avatar_provider.py](physio/backend/coach/avatar_provider.py#L98-L103) | Optional | Backend | No | mock or heygen.
COACH_MIN_SPEAK_GAP_MS | [physio/backend/coach/coach_orchestrator.py](physio/backend/coach/coach_orchestrator.py#L25-L33) | Optional | Backend | No | Voice cooldown.
COACH_DUPLICATE_GAP_MS | [physio/backend/coach/coach_orchestrator.py](physio/backend/coach/coach_orchestrator.py#L25-L33) | Optional | Backend | No | Duplicate cue block.
ELEVENLABS_API_KEY | [physio/backend/coach/voice_provider.py](physio/backend/coach/voice_provider.py#L29-L36) | Required for ElevenLabs | Backend | Yes | Should not be committed.
ELEVENLABS_VOICE_ID | [physio/backend/coach/voice_provider.py](physio/backend/coach/voice_provider.py#L29-L36) | Required for ElevenLabs | Backend | Yes | Should not be committed.
ELEVENLABS_MODEL_ID | [physio/backend/coach/voice_provider.py](physio/backend/coach/voice_provider.py#L29-L33) | Optional | Backend | No | Defaults to eleven_multilingual_v2.
ELEVENLABS_TIMEOUT_SEC | [physio/backend/coach/voice_provider.py](physio/backend/coach/voice_provider.py#L31-L33) | Optional | Backend | No | Request timeout.
ELEVENLABS_STABILITY | [physio/backend/coach/voice_provider.py](physio/backend/coach/voice_provider.py#L45-L50) | Optional | Backend | No | Voice setting.
ELEVENLABS_SIMILARITY_BOOST | [physio/backend/coach/voice_provider.py](physio/backend/coach/voice_provider.py#L45-L50) | Optional | Backend | No | Voice setting.
HEYGEN_API_KEY | [physio/backend/coach/avatar_provider.py](physio/backend/coach/avatar_provider.py#L27-L37) | Required for HeyGen | Backend | Yes | Should not be committed.
HEYGEN_AVATAR_ID | [physio/backend/coach/avatar_provider.py](physio/backend/coach/avatar_provider.py#L27-L37) | Required for HeyGen | Backend | Yes | Should not be committed.
HEYGEN_VOICE_ID | [physio/backend/coach/avatar_provider.py](physio/backend/coach/avatar_provider.py#L27-L54) | Required for HeyGen text mode | Backend | Yes | Required unless HEYGEN_USE_ELEVENLABS_AUDIO is true.
HEYGEN_TIMEOUT_SEC | [physio/backend/coach/avatar_provider.py](physio/backend/coach/avatar_provider.py#L27-L35) | Optional | Backend | No | Request timeout.
HEYGEN_API_URL | [physio/backend/coach/avatar_provider.py](physio/backend/coach/avatar_provider.py#L31-L36) | Optional | Backend | No | API base override.
HEYGEN_USE_ELEVENLABS_AUDIO | [physio/backend/coach/avatar_provider.py](physio/backend/coach/avatar_provider.py#L33-L38) | Optional | Backend | No | Use audio URL for HeyGen.
PUBLIC_BASE_URL | [physio/backend/env_loader.py](physio/backend/env_loader.py#L19-L24) | Optional | Backend | No | Required when HeyGen uses audio URL.
STORAGE_PROVIDER | [physio/backend/storage_provider.py](physio/backend/storage_provider.py#L20-L29) | Optional | Backend | No | sqlite or local.
SENSOR_ENDPOINT | [physio/hardware/sensor_client.py](physio/hardware/sensor_client.py#L9-L24) | Optional | Backend/Python | No | Sensor source URL.
PHYSIO_BACKEND_URL | [physio/vision/packet_emitter.py](physio/vision/packet_emitter.py#L10-L17) | Optional | Python tracker | No | Backend URL for Python tracker.

Danger flags:
- A .env file exists with populated keys; this is a secret leakage risk. Evidence: [physio/.env](physio/.env), [physio/backend/env_loader.py](physio/backend/env_loader.py#L1-L24).

## 15. WebSocket / Sensor Readiness Audit

Sensor/WebSocket support present: Yes (partial)

Files:
- WebSocket routes: [physio/backend/main.py](physio/backend/main.py#L521-L561)
- WebSocket client helper (unused): [physio/frontend/src/api/client.js](physio/frontend/src/api/client.js#L83-L90)
- Sensor client: [physio/hardware/sensor_client.py](physio/hardware/sensor_client.py#L1-L33)
- Python tracker uses sensor client: [physio/vision/pose_tracker.py](physio/vision/pose_tracker.py#L20-L82)

Packet shape: Includes distance_cm, sensor_status, sensor_jitter_score (see PhysioPacket). Evidence: [physio/backend/schemas.py](physio/backend/schemas.py#L45-L100).

Currently wired into analyzer: Python tracker only; browser path hardcodes sensor offline. Evidence: [physio/vision/pose_tracker.py](physio/vision/pose_tracker.py#L118-L144), [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx#L314-L356).

Currently wired into UI: Metric cards display distance when present. Evidence: [physio/frontend/src/components/LiveSession.jsx](physio/frontend/src/components/LiveSession.jsx#L124-L156).

Risk: WebSockets are not used in the frontend; polling is used instead. Evidence: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L82-L116), [physio/frontend/src/api/client.js](physio/frontend/src/api/client.js#L83-L90).

## 16. Data Flow Diagram

Current actual flow:

- Browser camera (MediaPipe Tasks Vision)
  -> landmark extraction + elbow analyzer
  -> PhysioPacket with analyzer_output
  -> POST /api/packets
  -> backend stores + applies local rules
  -> frontend polls /api/live/latest

Evidence: [physio/frontend/src/components/BrowserPoseOverlay.jsx](physio/frontend/src/components/BrowserPoseOverlay.jsx#L300-L372), [physio/backend/main.py](physio/backend/main.py#L234-L262), [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L82-L116).

Python flow:

- Python OpenCV tracker
  -> MediaPipe landmarks + right-arm metrics
  -> PhysioPacket (exercise right_arm_raise)
  -> POST /api/packets + POST /api/vision/frame
  -> frontend shows overlay via /api/vision/frame if Python mode selected

Evidence: [physio/vision/pose_tracker.py](physio/vision/pose_tracker.py#L108-L180), [physio/backend/main.py](physio/backend/main.py#L284-L315), [physio/frontend/src/components/LiveSession.jsx](physio/frontend/src/components/LiveSession.jsx#L60-L94).

AI flow:

- Local analyzer packet
  -> buildPhysioAIPacket
  -> POST /api/ai/gemini-coach
  -> AI cue displayed; optional ElevenLabs TTS

Evidence: [physio/frontend/src/ai/buildPhysioAIPacket.js](physio/frontend/src/ai/buildPhysioAIPacket.js#L1-L30), [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L520-L639), [physio/backend/main.py](physio/backend/main.py#L357-L455).

Intended flow (per prompt):

camera/tracker
-> local angle calculation
-> local elbow analyzer
-> local coach cue
-> structured AI packet
-> Gemini text cue
-> AI textbox
-> ElevenLabs audio

Differences:
- Two AI paths exist: /api/coach/cue and /api/ai/gemini-coach. Evidence: [physio/backend/main.py](physio/backend/main.py#L316-L455).
- Python tracker is still right_arm_raise while frontend flow is elbow flexion.

## 17. Risk List

P0 - Breaks app/demo:
1. Runtime/build status is unverified; blank-page issue cannot be ruled out without running the app.
2. Secrets appear to be stored in a committed .env file (security risk that can block demo if revoked or flagged). Evidence: [physio/.env](physio/.env).

P1 - Breaks AI integration:
1. Two AI paths (coach orchestrator vs direct Gemini endpoints) can produce inconsistent cues. Evidence: [physio/backend/main.py](physio/backend/main.py#L316-L455).
2. Gemini/ElevenLabs require keys; missing keys return error statuses and UI errors. Evidence: [physio/backend/main.py](physio/backend/main.py#L357-L455).

P2 - Demo polish issue:
1. Python tracker emits right_arm_raise packets while the UI is tuned for elbow flexion; can cause mismatched metrics. Evidence: [physio/vision/pose_tracker.py](physio/vision/pose_tracker.py#L116-L134), [physio/frontend/src/exercises/elbowFlexionExtension.js](physio/frontend/src/exercises/elbowFlexionExtension.js#L1-L43).
2. WebSockets exist but are unused; polling may be adequate but less efficient. Evidence: [physio/backend/main.py](physio/backend/main.py#L521-L561), [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L82-L116).

## 18. Recommended Fix Order

Step 1: Verify dev/build and blank-page behavior.
Reason: Runtime status is unknown; fixes should be driven by actual errors.
Files likely involved: [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L1-L1080), [physio/frontend/src/main.jsx](physio/frontend/src/main.jsx#L1-L10).

Step 2: Align the demo path (browser elbow analyzer vs python right-arm tracker).
Reason: Current UI is elbow-centric while Python tracker is shoulder raise.
Files likely involved: [physio/vision/pose_tracker.py](physio/vision/pose_tracker.py#L108-L180), [physio/frontend/src/components/LiveSession.jsx](physio/frontend/src/components/LiveSession.jsx#L60-L156).

Step 3: Collapse AI to a single, consistent path.
Reason: Duplicate AI flows can produce inconsistent cues.
Files likely involved: [physio/backend/main.py](physio/backend/main.py#L316-L455), [physio/frontend/src/App.jsx](physio/frontend/src/App.jsx#L520-L639).

Step 4: Harden secret handling (remove .env from repo and rely on .env.example).
Reason: Prevent leaked keys and quota issues.
Files likely involved: [physio/.env](physio/.env), [physio/.env.example](physio/.env.example).

## 19. Questions / Unknowns

- Does `npm run dev` currently render without errors? (Not tested.)
- Does `npm run build` pass? (Not tested.)
- Which live source is intended for the demo: Browser MediaPipe or Python OpenCV?
- Are the Gemini/ElevenLabs keys valid, or are quota errors expected? (Not tested.)
- Is the .env file intended to be in the repo? (Security risk.)
- Should the backend be required for the browser-only demo, or should it be optional?

## 20. Final Audit Verdict

Current repo status:
Unknown (not validated by running the app or builds).

Main blocker:
Runtime status is unverified; cannot confirm blank page or build behavior.

Highest confidence fix:
Run dev/build commands, capture errors, and resolve any runtime failures before changing logic.

Do not touch yet:
Do not refactor analyzer logic or AI provider routing until runtime behavior and target demo path are confirmed.
