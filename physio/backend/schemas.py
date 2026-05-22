from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


SensorStatus = Literal["ok", "warning", "error", "offline"]
CameraStatus = Literal["ok", "warning", "error"]
Side = Literal["right", "left"]
RepPhase = Literal["idle", "resting", "raising", "holding", "lowering", "rep_complete"]
Pace = Literal["too_slow", "good", "too_fast", "unknown"]
RangeStatus = Literal["below_start", "too_low", "almost_there", "target_met", "overextended", "unknown"]
Compensation = Literal["none", "shoulder_shrug", "torso_lean", "low_confidence", "unknown"]
CoachState = Literal[
    "good_form",
    "almost_there",
    "bend_more",
    "straighten_more",
    "too_fast",
    "too_jittery",
    "hold_longer",
    "keep_upper_arm_still",
    "low_confidence",
    "rep_complete",
    "rest_needed",
    "session_complete",
    "error"
]
PacketSource = Literal["python_opencv", "browser_mediapipe", "mock"]


class SensorPacket(BaseModel):
    device_id: str
    timestamp_ms: int
    sensor_status: SensorStatus
    recording_active: bool
    distance_cm: float | None
    sensor_jitter_score: float = Field(ge=0, le=1)
    sensor_jitter_detected: bool
    sample_rate_hz: float
    raw_distance_cm: float | None = None
    filtered_distance_cm: float | None = None
    hardware_notes: str | None = None
    battery_percent: float | None = None
    error_message: str | None = None


class PosePacket(BaseModel):
    timestamp_ms: int
    camera_status: CameraStatus
    landmark_confidence: float = Field(ge=0, le=1)
    exercise: str = "elbow_flexion_extension"
    side: Side = "right"
    shoulder_angle: float | None
    elbow_angle: float | None
    wrist_height_relative: float
    opencv_jitter_score: float = Field(ge=0, le=1)
    rep_count: int = Field(ge=0)
    rep_phase: RepPhase
    hold_time_sec: float = Field(ge=0)
    pace: Pace
    range_status: RangeStatus
    compensation: Compensation


class PhysioPacket(BaseModel):
    source: PacketSource = "mock"
    session_id: str
    timestamp_ms: int
    exercise: str = "elbow_flexion_extension"
    side: Side = "right"
    device_id: str
    sensor_status: SensorStatus
    camera_status: CameraStatus
    distance_cm: float | None
    sensor_jitter_score: float = Field(ge=0, le=1)
    opencv_jitter_score: float = Field(ge=0, le=1)
    combined_jitter_score: float = Field(ge=0, le=1)
    jitter_detected: bool
    shoulder_angle: float | None
    elbow_angle: float | None
    target_angle: float
    landmark_confidence: float = Field(ge=0, le=1)
    rep_count: int = Field(ge=0)
    rep_phase: RepPhase
    hold_time_sec: float = Field(ge=0)
    pace: Pace
    range_status: RangeStatus
    compensation: Compensation
    physio_score: int | None = Field(default=None, ge=0, le=100)
    coach_state: CoachState
    local_coach_message: str
    ai_coach_message: str | None = None
    avatar_status: str = "idle"
    voice_status: str = "idle"
    pose_detected: bool | None = None
    shoulder_present: bool | None = None
    elbow_present: bool | None = None
    wrist_present: bool | None = None
    hip_present: bool | None = None
    angle_valid: bool | None = None
    using_torso_reference: bool | None = None
    using_screen_axis_fallback: bool | None = None
    shoulder_coords: dict[str, float] | None = None
    elbow_coords: dict[str, float] | None = None
    wrist_coords: dict[str, float] | None = None
    angle_rejection_reason: str | None = None


class SessionStartRequest(BaseModel):
    user_id: str = "demo-user"
    exercise: str = "elbow_flexion_extension"
    side: Side = "right"
    target_angle: float = 90


class SessionStartResponse(BaseModel):
    session_id: str
    status: Literal["started"]


class SessionEndRequest(BaseModel):
    session_id: str
    pain_level: int = Field(ge=0, le=10)
    fatigue_level: int = Field(ge=0, le=10)


class SessionSummary(BaseModel):
    session_id: str
    user_id: str
    exercise: str
    side: Side
    started_at_ms: int
    ended_at_ms: int
    duration_sec: int
    total_reps: int
    clean_reps: int
    best_angle: float
    average_angle: float
    average_physio_score: int
    max_jitter_score: float
    average_jitter_score: float
    pain_level: int
    fatigue_level: int
    summary_text: str
    recommendation_text: str


class CoachCueResponse(BaseModel):
    coach_state: CoachState
    message: str
    source: Literal["mock", "local", "gemini"]
    voice_status: str
    avatar_status: str
    should_speak: bool = True
    reason: str = "mock_provider"
    audio_url: str | None = None
    local_file_path: str | None = None
    avatar_url: str | None = None
