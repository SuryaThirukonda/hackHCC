# Physio AI Setup (Vertex Gemini + ElevenLabs)

Gemini runs only on the backend through **Google Cloud Vertex AI**. The app does not use AI Studio API keys (`GEMINI_API_KEY`).

## Prerequisites

1. [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) installed.
2. A GCP project with Vertex AI API enabled and access to the target model (for example `gemini-2.5-flash`).
3. Application Default Credentials from local gcloud auth:

```powershell
gcloud auth application-default login
gcloud config set project project-f3192730-7603-48b5-a64
```

## Backend environment

Copy `physio/.env.example` to `physio/.env` and set:

```env
GOOGLE_CLOUD_PROJECT=project-f3192730-7603-48b5-a64
GOOGLE_CLOUD_LOCATION=us-central1
GEMINI_MODEL=gemini-2.5-flash
GEMINI_TIMEOUT_SEC=30
```

Optional ElevenLabs (unchanged):

```env
ELEVENLABS_API_KEY=your_key
ELEVENLABS_VOICE_ID=your_voice_id
```

Do **not** set `GEMINI_API_KEY` for Gemini; Vertex uses ADC only. If `GEMINI_API_KEY` remains in `.env`, remove it and **fully restart** the backend (stop uvicorn, start again). A stale process can keep calling AI Studio (`generativelanguage.googleapis.com`) and show `gemini_http_429` quota errors.

After restart, `GET /api/coach/provider-status` must include `gemini.implementation: "vertex-google-genai-v1"`. If you still see `gemini_key_configured`, the old backend is still running.

## Install and run

Backend:

```powershell
cd physio\backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Frontend:

```powershell
cd physio\frontend
npm install
npm run dev
```

Open the URL Vite prints (often `http://localhost:5173`).

## API endpoints (unchanged contract)

| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/api/ai/gemini-coach` | `{ "packet": { ...structured scalars... } }` | Live cue; falls back to `local_coach_message` |
| POST | `/api/ai/session-summary` | `{ "summary": { ...session metrics... } }` | Session text; falls back to local recommendation |
| POST | `/api/ai/elevenlabs-tts` | `{ "text": "..." }` | TTS from coach text |
| GET | `/api/coach/provider-status` | — | Includes `gemini` Vertex debug block |

## Debug visibility

On the **Debug / System Status** tab, **AI / voice status** includes `gemini_vertex`:

- `vertex_enabled` — yes/no
- `project`, `location`, `model`
- `last_status` — e.g. `vertex_ready`, `success`, `vertex_error`
- `last_error` — sanitized short message only (no huge Google JSON)

## Quick API tests

Gemini coach (structured packet only):

```powershell
$body = @{
  packet = @{
    exercise_id = "elbow_flexion_extension"
    coach_state = "too_fast"
    local_coach_message = "Slow down and control the movement."
    elbow_angle = 95
    rep_count = 2
    physio_score = 72
  }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/ai/gemini-coach" -Method POST -Body $body -ContentType "application/json"
```

Session summary:

```powershell
$body = @{
  summary = @{
    exercise = "elbow_flexion_extension"
    duration_sec = 120
    total_reps = 8
    clean_reps = 6
    recommendation_text = "Keep the same controlled pace next session."
  }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/ai/session-summary" -Method POST -Body $body -ContentType "application/json"
```

Provider status:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/coach/provider-status"
```

## Failure behavior

- If Vertex is unavailable or returns an error, endpoints respond with `ok: false`, `source: "local"`, and safe fallback text from the packet/summary.
- Errors in responses are truncated/sanitized; the UI should not show raw Google error blobs.
- The backend does not crash on Gemini failures.

## Orchestrator (optional)

For `/api/coach/cue` to use Gemini instead of mock:

```env
COACH_PROVIDER=gemini
```

This uses the same `GeminiCoachProvider` (Vertex) as the `/api/ai/*` routes.
