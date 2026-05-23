from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from storage.session_recording_store import get_recording_store

router = APIRouter(prefix="/api/recordings/v2", tags=["recordings-v2"])


@router.post("/session")
def save_recording(payload: dict[str, Any]) -> dict[str, Any]:
    session_id = str(payload.get("session_id") or "unknown")
    if not payload:
        raise HTTPException(status_code=400, detail="Empty payload")
    store = get_recording_store()
    store.save_recording(session_id, payload)
    sample_count = len(payload.get("samples") or [])
    event_count = len(payload.get("events") or [])
    rep_count = len(payload.get("reps") or [])
    return {
        "status": "saved",
        "session_id": session_id,
        "sample_count": sample_count,
        "event_count": event_count,
        "rep_count": rep_count,
    }


@router.get("/session/{session_id}")
def get_recording(session_id: str) -> dict[str, Any]:
    store = get_recording_store()
    recording = store.get_recording(session_id)
    if recording is None:
        raise HTTPException(status_code=404, detail=f"No recording found for session {session_id}")
    return recording


@router.get("/session/{session_id}/timeline")
def get_timeline(session_id: str) -> list[dict[str, Any]]:
    store = get_recording_store()
    timeline = store.get_recording_timeline(session_id)
    if not timeline:
        raise HTTPException(status_code=404, detail=f"No timeline found for session {session_id}")
    return timeline


@router.get("/list")
def list_recordings() -> list[dict[str, Any]]:
    store = get_recording_store()
    return store.list_recordings()
