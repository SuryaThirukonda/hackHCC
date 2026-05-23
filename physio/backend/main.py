from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from coach.coach_orchestrator import CoachOrchestrator
from env_loader import configured_secret, load_env_file, public_base_url
from mock_packet_generator import MockPacketGenerator
from packet_merge import apply_local_rules
from schemas import (
    CoachCueResponse,
    PhysioPacket,
    SessionEndRequest,
    SessionStartRequest,
    SessionStartResponse,
    SessionSummary,
)
from sqlite_store import SQLitePhysioStore


load_env_file()
app = FastAPI(title="Physio Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
AUDIO_DIR = Path(__file__).parent / "data" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static/audio", StaticFiles(directory=str(AUDIO_DIR)), name="audio")


@dataclass
class SessionState:
    session_id: str = "mock-session"
    user_id: str = "demo-user"
    exercise: str = "elbow_flexion_extension"
    side: str = "right"
    target_angle: float = 90
    started_at_ms: int = field(default_factory=lambda: int(time.time() * 1000))
    packets: list[PhysioPacket] = field(default_factory=list)
    latest_packet: PhysioPacket | None = None
    latest_python_packet: PhysioPacket | None = None
    latest_browser_packet: PhysioPacket | None = None
    latest_mock_packet: PhysioPacket | None = None
    active_source: str = "none"
    latest_received_at: float = 0.0
    python_received_at: float = 0.0
    browser_received_at: float = 0.0
    mock_received_at: float = 0.0
    latest_frame: bytes | None = None
    latest_frame_received_at: float = 0.0


state = SessionState()
mock_generator = MockPacketGenerator()
coach_orchestrator = CoachOrchestrator()
store = SQLitePhysioStore()
websockets: set[WebSocket] = set()


SOURCE_RECENT_WINDOW_SEC = 2.5
FRAME_RECENT_WINDOW_SEC = 3.0


def source_age_ms(source: str) -> int:
    received_at = {
        "python": state.python_received_at,
        "browser": state.browser_received_at,
        "mock": state.mock_received_at,
    }.get(source, 0)
    if not received_at:
        return -1
    return int((time.time() - received_at) * 1000)


def source_recent(source: str) -> bool:
    return 0 <= source_age_ms(source) <= int(SOURCE_RECENT_WINDOW_SEC * 1000)


def active_source() -> str:
    if source_recent("python"):
        return "python"
    if source_recent("browser"):
        return "browser"
    if state.latest_mock_packet is not None:
        return "mock"
    return "none"


def latest_packet_for_source(source: str) -> PhysioPacket:
    if source == "python":
        if not state.latest_python_packet or not source_recent("python"):
            raise HTTPException(
                status_code=404,
                detail="Python OpenCV tracker not connected. Start python vision/pose_tracker.py or switch to Browser Camera Fallback.",
            )
        return state.latest_python_packet

    if source == "browser":
        if not state.latest_browser_packet or not source_recent("browser"):
            raise HTTPException(
                status_code=404,
                detail="Browser Camera Fallback has no recent packet. Enable webcam tracking in the dashboard.",
            )
        return state.latest_browser_packet

    packet = mock_generator.next_packet(state.session_id, state.target_angle, state.exercise)
    state.latest_packet = packet
    state.latest_mock_packet = packet
    state.active_source = "mock"
    state.latest_received_at = time.time()
    state.mock_received_at = state.latest_received_at
    state.packets.append(packet)
    store.save_packet(packet)
    if len(state.packets) > 1200:
        state.packets = state.packets[-800:]
    return packet


async def broadcast_packet(packet: PhysioPacket) -> None:
    stale: list[WebSocket] = []
    for websocket in websockets:
        try:
            await websocket.send_json(packet.model_dump())
        except RuntimeError:
            stale.append(websocket)
    for websocket in stale:
        websockets.discard(websocket)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "physio-backend"}


@app.get("/api/coach/provider-status")
def coach_provider_status() -> dict[str, Any]:
    return {
        "providers": coach_orchestrator.provider_status(),
        "env": {
            "gemini_key_configured": configured_secret("GEMINI_API_KEY"),
            "elevenlabs_key_configured": configured_secret("ELEVENLABS_API_KEY"),
            "elevenlabs_voice_configured": configured_secret("ELEVENLABS_VOICE_ID"),
            "heygen_key_configured": configured_secret("HEYGEN_API_KEY"),
            "heygen_avatar_configured": configured_secret("HEYGEN_AVATAR_ID"),
            "heygen_voice_configured": configured_secret("HEYGEN_VOICE_ID"),
            "public_base_url_configured": public_base_url() is not None,
        },
    }


@app.post("/api/session/start", response_model=SessionStartResponse)
def start_session(request: SessionStartRequest) -> SessionStartResponse:
    session_id = f"session-{int(time.time() * 1000)}"
    state.session_id = session_id
    state.user_id = request.user_id
    state.exercise = request.exercise
    state.side = request.side
    state.target_angle = request.target_angle
    state.started_at_ms = int(time.time() * 1000)
    state.packets = []
    state.latest_packet = None
    state.latest_python_packet = None
    state.latest_browser_packet = None
    state.latest_mock_packet = None
    state.active_source = "none"
    state.latest_received_at = 0.0
    state.python_received_at = 0.0
    state.browser_received_at = 0.0
    state.mock_received_at = 0.0
    state.latest_frame = None
    state.latest_frame_received_at = 0.0
    mock_generator.started = time.time()
    coach_orchestrator.reset_session(session_id)
    store.save_session_start(
        session_id=session_id,
        user_id=state.user_id,
        exercise=state.exercise,
        side=state.side,
        target_angle=state.target_angle,
        started_at_ms=state.started_at_ms,
    )
    return SessionStartResponse(session_id=session_id, status="started")


@app.post("/api/packets")
async def ingest_packet(packet: PhysioPacket) -> dict[str, int | str]:
    normalized = apply_local_rules(packet)
    now = time.time()
    state.latest_packet = normalized
    state.latest_received_at = now
    if normalized.source == "python_opencv":
        state.latest_python_packet = normalized
        state.python_received_at = now
        state.active_source = "python"
    elif normalized.source == "browser_mediapipe":
        state.latest_browser_packet = normalized
        state.browser_received_at = now
        if not source_recent("python"):
            state.active_source = "browser"
    else:
        state.latest_mock_packet = normalized
        state.mock_received_at = now
        if not source_recent("python") and not source_recent("browser"):
            state.active_source = "mock"
    state.packets.append(normalized)
    store.save_packet(normalized)
    await broadcast_packet(normalized)
    return {"status": "accepted", "packet_count": len(state.packets)}


@app.get("/api/live/latest", response_model=PhysioPacket)
def latest_packet(source: str = Query("python", pattern="^(python|browser|mock)$")) -> PhysioPacket:
    return latest_packet_for_source(source)


@app.get("/api/live/source")
def live_source() -> dict[str, Any]:
    current_active = active_source()
    active_age_ms = source_age_ms(current_active)
    return {
        "active_source": current_active,
        "session_id": state.session_id,
        "latest_packet_age_ms": active_age_ms,
        "python_recent": source_recent("python"),
        "browser_recent": source_recent("browser"),
        "mock_enabled": True,
        "vision_frame_available": state.latest_frame is not None and time.time() - state.latest_frame_received_at <= FRAME_RECENT_WINDOW_SEC,
        "python_packet_age_ms": source_age_ms("python"),
        "browser_packet_age_ms": source_age_ms("browser"),
        "mock_packet_age_ms": source_age_ms("mock"),
        "vision_frame_age_ms": -1 if state.latest_frame is None else int((time.time() - state.latest_frame_received_at) * 1000),
    }


@app.post("/api/vision/frame")
async def ingest_vision_frame(request: Request) -> dict[str, int | str]:
    frame = await request.body()
    if not frame:
        return {"status": "empty", "bytes": 0}
    state.latest_frame = frame
    state.latest_frame_received_at = time.time()
    return {"status": "accepted", "bytes": len(frame)}


@app.get("/api/vision/frame")
def latest_vision_frame() -> Response:
    if state.latest_frame:
        return Response(
            content=state.latest_frame,
            media_type="image/jpeg",
            headers={
                "Cache-Control": "no-store",
                "X-Frame-Age-Sec": str(round(time.time() - state.latest_frame_received_at, 2)),
            },
        )
    svg = """
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
      <rect width="960" height="540" fill="#171b1b"/>
      <rect x="28" y="28" width="904" height="484" rx="14" fill="none" stroke="#56d8a7" stroke-opacity=".35" stroke-width="2"/>
      <text x="480" y="250" text-anchor="middle" fill="#f4f1e8" font-family="Segoe UI, Arial" font-size="32" font-weight="700">Waiting for OpenCV overlay</text>
      <text x="480" y="300" text-anchor="middle" fill="#a8ada6" font-family="Segoe UI, Arial" font-size="20">Run python vision\\pose_tracker.py</text>
    </svg>
    """.strip()
    return Response(content=svg, media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


@app.post("/api/coach/cue", response_model=CoachCueResponse)
def coach_cue(packet: PhysioPacket) -> CoachCueResponse:
    normalized = apply_local_rules(packet)
    return coach_orchestrator.cue_for_packet(normalized)


@app.post("/api/session/end", response_model=SessionSummary)
def end_session(request: SessionEndRequest) -> SessionSummary:
    packets = [packet for packet in state.packets if packet.session_id == request.session_id]
    if not packets:
        packets = [latest_packet_for_source("mock")]

    ended_at_ms = int(time.time() * 1000)
    total_reps = max(packet.rep_count for packet in packets)
    clean_rep_indexes = {
        packet.rep_count for packet in packets
        if packet.rep_phase == "rep_complete" and packet.rep_count > 0 and (packet.physio_score or 0) >= 75
    }
    clean_reps = len(clean_rep_indexes)
    if state.exercise == "elbow_flexion_extension":
        valid_angles = [packet.elbow_angle for packet in packets if packet.elbow_angle is not None]
        best_angle = min(valid_angles) if valid_angles else 0.0
        summary_angle_label = "best elbow flexion"
    else:
        valid_angles = [packet.shoulder_angle for packet in packets if packet.shoulder_angle is not None]
        best_angle = max(valid_angles) if valid_angles else 0.0
        summary_angle_label = "best angle"
    valid_scores = [packet.physio_score for packet in packets if packet.physio_score is not None]
    average_angle = sum(valid_angles) / len(valid_angles) if valid_angles else 0.0
    average_score = round(sum(valid_scores) / len(valid_scores)) if valid_scores else 0
    max_jitter = max(packet.combined_jitter_score for packet in packets)
    average_jitter = sum(packet.combined_jitter_score for packet in packets) / len(packets)

    fallback_summary = SessionSummary(
        session_id=request.session_id,
        user_id=state.user_id,
        exercise=state.exercise,
        side=state.side,
        started_at_ms=state.started_at_ms,
        ended_at_ms=ended_at_ms,
        duration_sec=max(1, int((ended_at_ms - state.started_at_ms) / 1000)),
        total_reps=total_reps,
        clean_reps=clean_reps,
        best_angle=round(best_angle, 1),
        average_angle=round(average_angle, 1),
        average_physio_score=average_score,
        max_jitter_score=round(max_jitter, 2),
        average_jitter_score=round(average_jitter, 2),
        pain_level=request.pain_level,
        fatigue_level=request.fatigue_level,
        summary_text=f"User completed {total_reps} reps with {summary_angle_label} of {best_angle:.1f} degrees.",
        recommendation_text="Focus on a controlled bend, brief hold, and smooth straighten phase.",
    )
    summary = coach_orchestrator.summarize_session(packets, fallback_summary)
    store.save_summary(summary)
    return summary


@app.get("/api/sessions", response_model=list[SessionSummary])
def list_sessions() -> list[SessionSummary]:
    return store.list_summaries()


@app.get("/api/storage/status")
def storage_status() -> dict[str, Any]:
    return store.counts()


@app.websocket("/ws/live")
async def live_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    websockets.add(websocket)
    try:
        while True:
            current_active = active_source()
            if current_active == "none":
                await asyncio.sleep(0.5)
                continue
            packet = latest_packet_for_source(current_active)
            await websocket.send_json(packet.model_dump())
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        websockets.discard(websocket)


@app.websocket("/ws/coach")
async def coach_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            payload = await websocket.receive_json()
            try:
                packet = PhysioPacket(**payload)
            except ValidationError as exc:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid PhysioPacket",
                    "details": exc.errors(),
                })
                continue

            normalized = apply_local_rules(packet)
            cue = coach_orchestrator.cue_for_packet(normalized)
            await websocket.send_json(cue.model_dump())
    except WebSocketDisconnect:
        return
