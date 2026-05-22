from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from coach.coach_orchestrator import CoachOrchestrator
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
from storage_provider import get_session_store


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
    exercise: str = "right_arm_raise"
    side: str = "right"
    target_angle: float = 90
    started_at_ms: int = field(default_factory=lambda: int(time.time() * 1000))
    packets: list[PhysioPacket] = field(default_factory=list)
    latest_packet: PhysioPacket | None = None
    latest_real_packet: PhysioPacket | None = None
    latest_source: str = "mock"
    latest_received_at: float = 0.0
    real_received_at: float = 0.0
    latest_frame: bytes | None = None
    latest_frame_received_at: float = 0.0


state = SessionState()
mock_generator = MockPacketGenerator()
coach_orchestrator = CoachOrchestrator()
store = get_session_store()
websockets: set[WebSocket] = set()


def waiting_for_real_packet() -> PhysioPacket:
    return PhysioPacket(
        session_id=state.session_id,
        timestamp_ms=int(time.time() * 1000),
        exercise=state.exercise,
        side=state.side,
        device_id="opencv-waiting",
        sensor_status="offline",
        camera_status="warning",
        distance_cm=None,
        sensor_jitter_score=0,
        opencv_jitter_score=0,
        combined_jitter_score=0,
        jitter_detected=False,
        shoulder_angle=0,
        elbow_angle=0,
        target_angle=state.target_angle,
        landmark_confidence=0,
        rep_count=0,
        rep_phase="idle",
        hold_time_sec=0,
        pace="unknown",
        range_status="unknown",
        compensation="unknown",
        physio_score=0,
        coach_state="low_confidence",
        local_coach_message="Waiting for OpenCV packets from pose_tracker.py.",
        avatar_status="idle",
        voice_status="idle",
    )


def current_or_mock_packet(source: str = "auto") -> PhysioPacket:
    if source == "real":
        return state.latest_real_packet or waiting_for_real_packet()

    if source == "auto" and state.latest_real_packet and time.time() - state.real_received_at < 2:
        state.latest_packet = state.latest_real_packet
        state.latest_source = "real"
        return state.latest_real_packet

    packet = mock_generator.next_packet(state.session_id, state.target_angle)
    state.latest_packet = packet
    state.latest_source = "mock"
    state.latest_received_at = time.time()
    state.packets.append(packet)
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
    state.latest_real_packet = None
    state.latest_source = "mock"
    state.latest_received_at = 0.0
    state.real_received_at = 0.0
    state.latest_frame = None
    state.latest_frame_received_at = 0.0
    mock_generator.started = time.time()
    coach_orchestrator.reset_session(session_id)
    return SessionStartResponse(session_id=session_id, status="started")


@app.post("/api/packets")
async def ingest_packet(packet: PhysioPacket) -> dict[str, int | str]:
    normalized = apply_local_rules(packet)
    state.latest_packet = normalized
    state.latest_real_packet = normalized
    state.latest_source = "real"
    state.latest_received_at = time.time()
    state.real_received_at = state.latest_received_at
    state.packets.append(normalized)
    await broadcast_packet(normalized)
    return {"status": "accepted", "packet_count": len(state.packets)}


@app.get("/api/live/latest", response_model=PhysioPacket)
def latest_packet(source: str = Query("auto", pattern="^(auto|mock|real)$")) -> PhysioPacket:
    return current_or_mock_packet(source)


@app.get("/api/live/source")
def live_source() -> dict[str, Any]:
    return {
        "latest_source": state.latest_source,
        "session_id": state.session_id,
        "has_real_packet": state.latest_real_packet is not None,
        "real_age_sec": None if state.latest_real_packet is None else round(time.time() - state.real_received_at, 2),
        "has_vision_frame": state.latest_frame is not None,
        "vision_frame_age_sec": None if state.latest_frame is None else round(time.time() - state.latest_frame_received_at, 2),
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
        packets = [current_or_mock_packet()]

    ended_at_ms = int(time.time() * 1000)
    total_reps = max(packet.rep_count for packet in packets)
    clean_reps = sum(
        1 for packet in packets
        if packet.rep_phase == "rep_complete" and packet.physio_score >= 75
    )
    best_angle = max(packet.shoulder_angle for packet in packets)
    average_angle = sum(packet.shoulder_angle for packet in packets) / len(packets)
    average_score = round(sum(packet.physio_score for packet in packets) / len(packets))
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
        summary_text=f"User completed {total_reps} reps with a best angle of {best_angle:.1f} degrees.",
        recommendation_text="Repeat this target next session and focus on smooth lowering.",
    )
    summary = coach_orchestrator.summarize_session(packets, fallback_summary)
    store.save_summary(summary)
    return summary


@app.get("/api/sessions", response_model=list[SessionSummary])
def list_sessions() -> list[SessionSummary]:
    return store.list_summaries()


@app.websocket("/ws/live")
async def live_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    websockets.add(websocket)
    try:
        while True:
            packet = current_or_mock_packet("auto")
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
