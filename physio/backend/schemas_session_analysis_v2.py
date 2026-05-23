from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class SessionInfoV2(BaseModel):
    session_id: str
    user_id: str = "demo-user"
    side: str = "right"
    started_at_ms: int | None = None
    ended_at_ms: int | None = None
    duration_sec: int = Field(default=0, ge=0)


class SessionGoalsV2(BaseModel):
    rep_goal: int = Field(default=0, ge=0)
    target_elbow_range: str | None = None
    required_hold_sec: float | None = None


class AggregateMetricsV2(BaseModel):
    total_reps: int = Field(default=0, ge=0)
    clean_reps: int = Field(default=0, ge=0)
    average_physio_score: int | None = Field(default=None, ge=0, le=100)
    best_range_of_motion: float | None = None
    average_range_of_motion: float | None = None
    average_hold_time_sec: float | None = None
    average_rep_duration_sec: float | None = None
    average_jitter_score: float | None = None
    max_jitter_score: float | None = None
    raw_average_elbow_angle: float | None = None
    smoothed_average_elbow_angle: float | None = None
    raw_average_shoulder_angle: float | None = None
    smoothed_average_shoulder_angle: float | None = None


class TrackingQualityV2(BaseModel):
    data_quality: Literal["high", "medium", "low"] = "low"
    total_frames: int = Field(default=0, ge=0)
    valid_frames: int = Field(default=0, ge=0)
    invalid_frames: int = Field(default=0, ge=0)
    valid_frame_ratio: float = Field(default=0, ge=0, le=1)
    average_landmark_confidence: float | None = Field(default=None, ge=0, le=1)
    average_jitter_score: float | None = Field(default=None, ge=0, le=1)


class IssueSummaryV2(BaseModel):
    common_issue: str = "none"
    issue_label: str = "none"
    issue_counts: dict[str, int] = Field(default_factory=dict)
    zero_rep_reason: str | None = None
    warnings: list[str] = Field(default_factory=list)


class MovementTracePointV2(BaseModel):
    t_sec: float
    raw_elbow_angle: float | None = None
    smoothed_elbow_angle: float | None = None
    angle_residual: float | None = None
    jitter_score: float | None = Field(default=None, ge=0, le=1)
    phase: str | None = None
    rep_count: int = 0
    confidence: float | None = Field(default=None, ge=0, le=1)
    valid: bool = True


class RepBreakdownV2(BaseModel):
    rep_index: int
    range_of_motion: float | None = None
    hold_time_sec: float | None = None
    rep_duration_sec: float | None = None
    pace: str = "unknown"
    jitter_score: float | None = None
    shoulder_drift: float | None = None
    physio_score: int | None = None
    issue: str = "none"
    clean: bool = False


class LocalSummaryTextV2(BaseModel):
    summary_text: str = ""
    recommendation_text: str = ""


class FinalSessionAnalysisPacketV2(BaseModel):
    schema_version: str = "session_analysis_v2"
    exercise_id: str = "elbow_flexion_extension"
    exercise_name: str = "Elbow Flexion / Extension"
    mode: Literal["post_session_analysis"] = "post_session_analysis"
    session: SessionInfoV2
    goals: SessionGoalsV2 = Field(default_factory=SessionGoalsV2)
    aggregate_metrics: AggregateMetricsV2 = Field(default_factory=AggregateMetricsV2)
    tracking_quality: TrackingQualityV2 = Field(default_factory=TrackingQualityV2)
    movement_trace: list[MovementTracePointV2] = Field(default_factory=list, max_length=160)
    trace_summary: dict[str, Any] = Field(default_factory=dict)
    issue_summary: IssueSummaryV2 = Field(default_factory=IssueSummaryV2)
    rep_breakdown: list[RepBreakdownV2] = Field(default_factory=list)
    patient_reported: dict[str, Any] = Field(default_factory=dict)
    local_summary: LocalSummaryTextV2 = Field(default_factory=LocalSummaryTextV2)


class GeminiSessionAnalysisTextV2(BaseModel):
    spoken_summary: str
    written_summary: str
    what_went_well: str
    focus_next_time: str
    safety_note: str
    bonus_rep_suggestion: str
    return_suggestion: str


class GeminiSessionAnalysisResponseV2(BaseModel):
    ok: bool
    provider: str = "local"
    model: str = "local-fallback"
    analysis: GeminiSessionAnalysisTextV2
    fallback_used: bool = False
    error_message_sanitized: str | None = None
