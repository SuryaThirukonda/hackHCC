# Physio Skeleton App

Physio is an edge-AI rehab coaching skeleton for a right-arm raise demo. BC-0
builds the shared structure for Person B and Person C to implement on:

- FastAPI backend with contract-first Pydantic models.
- React/Vite dashboard driven by mock live packets.
- Local JSON session summaries.
- Mock coach, voice, and avatar providers.
- Hardware adapter skeleton and real OpenCV/MediaPipe vision tracker.

The core app works with no hardware and no external API keys.

## Canonical Python OpenCV Demo Path

Terminal 1:

```powershell
cd physio\backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Terminal 2:

```powershell
cd physio\frontend
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

If another local app is already using `5173`, Vite will print the next
available port, such as `http://localhost:5174`.

Terminal 3:

```powershell
cd physio
python vision\pose_tracker.py
```

Open the frontend. If the Python tracker is already posting recent packets, the
dashboard selects `Python OpenCV`. The large left panel displays the Python
overlay from `GET /api/vision/frame`, and metric cards read
`GET /api/live/latest?source=python`.

Health check:

```powershell
curl http://localhost:8000/api/health
curl http://localhost:8000/api/live/source
```

## Browser Camera Fallback

1. Start the backend and frontend.
2. Open the dashboard.
3. Select `Browser Camera Fallback`.
4. Click `Enable webcam` in the large left panel.
5. Approve the browser camera prompt.

The tab uses browser MediaPipe to draw live video, tracked shoulder/elbow/wrist
points, hand landmarks, skeleton lines, and coaching telemetry directly on the
canvas. It also posts the calculated Final Physio packets to `POST /api/packets`
so the backend, coach panel, session summary, and history all consume real
camera-derived data.

## Mock Demo Mode

Select `Mock Demo` in the dashboard. Mock packets are generated only for this
explicit mode through:

```powershell
curl http://localhost:8000/api/live/latest?source=mock
```

Mock mode is labeled in the UI and should not be used as evidence of real
movement tracking.

## Run Fake Sensor

The backend mock packets do not require this server, but Person A can use it as
the sensor contract reference. Python OpenCV packets display sensor data as real
only when `distance_cm` is present and `sensor_status` is `ok`. The forward
press exercise uses the websocket command channel at `ws://localhost:8765` by
default. Set `VITE_SENSOR_WS_URL=ws://<pi-host>:8765` for the Pi.

```powershell
cd physio\hardware
python fake_sensor_server.py
```

The websocket mode requires the `websockets` package, which is included when
the backend requirements are installed.

Test:

```powershell
curl http://localhost:8010/sensor/latest
```

Websocket command format:

```json
{"command": "start"}
```

```json
{"command": "stop"}
```

Distance messages can be plain text:

```text
Distance: 113.05 cm
```

## Python Tracker Options

```powershell
cd physio
python -m pip install -r backend\requirements.txt
python vision\pose_tracker.py
```

The tracker uses MediaPipe Pose for shoulder/elbow/wrist/hip and MediaPipe
Hands for visible hand landmark points. It calculates shoulder raise angle,
elbow angle, reps, pace, jitter, PhysioScore, and local coach state, then posts
Final Physio packets to `POST /api/packets`. It also posts the drawn webcam
overlay to `POST /api/vision/frame`, so the dashboard Real tab can show exactly
what is being tracked.

Useful options:

```powershell
python vision\pose_tracker.py --camera 1
python vision\pose_tracker.py --no-post
python vision\pose_tracker.py --no-sensor
python vision\pose_tracker.py --process-every 2
```

In the dashboard, use the source segmented control:

- Python OpenCV: canonical real demo source from `vision/pose_tracker.py`.
- Browser Camera Fallback: in-tab MediaPipe fallback, no hardware sensor.
- Mock Demo: generated packets only.

Python mode shows:

```text
Python OpenCV tracker not connected. Start python vision/pose_tracker.py or switch to Browser Camera Fallback.
```

until recent Python packets are available.

## Mock Live Session Test

1. Start the backend.
2. Start the frontend.
3. Click Start.
4. Watch angle, target, reps, PhysioScore, jitter, coach state, and coach cue update.
5. Click End.
6. Confirm the summary appears and a JSON file is saved under `backend/data/sessions`.

Backend curl examples:

```powershell
curl http://localhost:8000/api/live/latest?source=mock
curl -X POST http://localhost:8000/api/session/start -H "Content-Type: application/json" -d "{\"user_id\":\"demo-user\",\"exercise\":\"right_arm_raise\",\"side\":\"right\",\"target_angle\":90}"
curl -X POST http://localhost:8000/api/session/end -H "Content-Type: application/json" -d "{\"session_id\":\"mock-session\",\"pain_level\":2,\"fatigue_level\":4}"
curl http://localhost:8000/api/sessions
```

For `/api/coach/cue`, POST a full `PhysioPacket` from `/api/live/latest`.

## Verification Checklist

1. Open the frontend.
2. Confirm source auto-selects `Python OpenCV` if `python vision\pose_tracker.py` is running.
3. Confirm the main panel shows the Python overlay frame, not BrowserPoseOverlay.
4. Raise your arm and confirm shoulder angle changes.
5. Confirm rep count changes after raise-and-lower cycles.
6. Confirm PhysioScore changes with range, pace, jitter, hold, and confidence.
7. Stop `pose_tracker.py` and confirm the UI shows tracker offline instead of fake real data.
8. Switch to `Browser Camera Fallback` and confirm the browser overlay asks for webcam permission and works after approval.
9. Switch to `Mock Demo` and confirm mock mode is clearly labeled.
10. Confirm dashboard labels mock/demo history separately from saved real sessions.

## Person B Implemented Files

Person B's current implementation lives in:

- `vision/pose_tracker.py`
- `vision/angle_utils.py`
- `vision/rep_counter.py`
- `vision/scoring.py`
- `vision/overlay.py`
- `backend/packet_merge.py`
- `frontend/src/components/LiveSession.jsx`
- `frontend/src/components/ProgressDashboard.jsx`

The tracker now covers OpenCV webcam capture, MediaPipe Pose landmarks,
MediaPipe hand points, angle calculation, rep counting, pace, jitter, overlays,
and final packet emission. Tuning should focus on thresholds, camera placement,
and exercise-specific rules.

Person B prompt coverage:

- B-1 through B-4: webcam, landmarks, angles, readable overlay.
- B-5 through B-8: rep state, pace/jitter, local score/rules, final packets.
- B-9: optional sensor merge with offline fallback.
- B-10: target arc, skeleton lines, score/state overlay.
- B-11: dashboard real/mock mode and live packet display.
- B-12: session summary/history and progress cards.

## Person C AI Communication Layer

Person C is implemented in:

- `backend/coach/base.py`
- `backend/coach/mock_coach.py`
- `backend/coach/gemini_coach.py`
- `backend/coach/voice_provider.py`
- `backend/coach/avatar_provider.py`
- `backend/coach/coach_orchestrator.py`
- `backend/storage_provider.py`
- `backend/sqLite_store.py`
- `backend/main.py`
- `frontend/src/components/CoachPanel.jsx`

The mock providers are intentionally non-blocking. Real Gemini, ElevenLabs,
HeyGen, and SQLite are enabled by environment variables and keep the same
fallback behavior. See `PERSON_C_README.md` for curl tests and provider flags.

## Contracts

The final packet contract lives in:

- `shared/physio_packet_schema.json`
- `backend/schemas.py`

Everything should produce, consume, display, or store this packet. That packet
is the integration boundary.
