# Person C: AI Communication Layer

Person C lives inside the existing Physio FastAPI/React app. It consumes Person B's final `PhysioPacket` and returns coach cue text, speak decisions, provider statuses, and media URLs when a provider can produce them.

## Safe Defaults

The app runs without API keys.

```text
COACH_PROVIDER=mock
VOICE_PROVIDER=mock
AVATAR_PROVIDER=mock
STORAGE_PROVIDER=local
```

Mock providers never call external services. Real providers are enabled only with environment variables and all failures fall back to mock/local behavior.

## Backend Endpoints

Start the backend from `physio/backend`:

```bash
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

REST cue test:

```bash
curl -X POST http://localhost:8000/api/coach/cue \
  -H "Content-Type: application/json" \
  --data-binary @test_packets/good_form.json
```

Live WebSocket:

```text
ws://localhost:8000/ws/coach
```

Send a full `PhysioPacket` JSON message. The response is a `CoachCueResponse`.

Session summaries use `POST /api/session/end`. If Gemini is enabled, it can rewrite the text summary from scalar session metrics only. If Gemini is missing or fails, the local summary is returned.

## Anti-Spam Speak Logic

`CoachOrchestrator` returns a visual cue for every request, but voice/avatar providers are called only when `should_speak=true`.

Speak triggers:

- First cue in a session.
- Important state changes: `error`, `low_confidence`, `too_fast`, `too_jittery`, `session_complete`.
- Rep progress for good form/session complete states.
- Important states after cooldown.

Environment knobs:

```text
COACH_MIN_SPEAK_GAP_MS=5000
COACH_DUPLICATE_GAP_MS=14000
```

The response `reason` field explains the decision, such as `first_cue`, `duplicate_cue`, `speak_cooldown`, `state_changed`, or `visual_only_tick`.

## Real Providers

Gemini cues:

```text
COACH_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-1.5-flash
```

ElevenLabs voice:

```text
VOICE_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
```

Audio files are saved under `backend/data/audio` and served at `/static/audio/{file}`.

HeyGen avatar:

```text
AVATAR_PROVIDER=heygen
HEYGEN_API_KEY=...
HEYGEN_AVATAR_ID=...
```

The HeyGen call is non-blocking from the app's point of view. If HeyGen returns a video ID or URL, it is included in the cue response.

SQLite summaries:

```text
STORAGE_PROVIDER=sqlite
```

SQLite writes to `backend/data/physio_sessions.sqlite3`. The default `local` provider keeps the existing JSON files.

## Privacy Boundary

Remote AI calls send only scalar `PhysioPacket` metrics like angle, pace, rep phase, confidence, score, and local coach state. They do not send raw video, frames, images, or landmark arrays.
