from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Rep-level breakdown
# ---------------------------------------------------------------------------

class RepBreakdown(BaseModel):
    rep_number: int
    completed: bool
    clean: bool
    start_timestamp: int | None = None
    end_timestamp: int | None = None
    duration_sec: float | None = None
    min_elbow_angle: float | None = None
    max_elbow_angle: float | None = None
    range_of_motion: float | None = None
    hold_time_sec: float | None = None
    jitter_score: float | None = None
    shoulder_drift: float | None = None
    physio_score: int | None = None
    issue_label: str | None = None
    confidence_label: str | None = None
    notes: str | None = None


# ---------------------------------------------------------------------------
# Aggregate metrics
# ---------------------------------------------------------------------------

class AggregateMetrics(BaseModel):
    best_range_of_motion: float = 0
    average_range_of_motion: float = 0
    average_hold_time_sec: float = 0
    average_rep_duration_sec: float = 0
    average_jitter_score: float = 0
    average_shoulder_drift: float = 0
    average_physio_score: int = 0
    best_rep_number: int | None = None
    weakest_rep_number: int | None = None


# ---------------------------------------------------------------------------
# Issue summary
# ---------------------------------------------------------------------------

class IssueSummary(BaseModel):
    common_issue: str = "none"
    too_fast_count: int = 0
    too_jittery_count: int = 0
    short_hold_count: int = 0
    incomplete_extension_count: int = 0
    tracking_lost_count: int = 0
    shoulder_compensation_count: int = 0


# ---------------------------------------------------------------------------
# Tracking quality
# ---------------------------------------------------------------------------

class TrackingQuality(BaseModel):
    valid_frame_ratio: float = 1.0
    average_landmark_confidence: float = 0.0
    dropped_frame_count: int = 0
    jitter_level: str = "low"
    confidence_label: str = "high"


# ---------------------------------------------------------------------------
# Full final packet sent to Gemini
# ---------------------------------------------------------------------------

class FinalSessionAnalysisPacket(BaseModel):
    session_id: str
    exercise_id: str
    exercise_name: str
    timestamp_start: int
    timestamp_end: int
    duration_sec: float
    rep_goal: int
    completed_reps: int
    clean_reps: int
    bonus_rep_attempted: bool = False
    bonus_rep_completed: bool = False
    tracking_quality: TrackingQuality
    local_summary: str
    aggregate_metrics: AggregateMetrics
    rep_breakdown: list[RepBreakdown] = Field(default_factory=list)
    issue_summary: IssueSummary
    confidence_notes: str = ""
    local_recommendation: str


# ---------------------------------------------------------------------------
# Gemini post-session analysis response
# ---------------------------------------------------------------------------

class GeminiSessionAnalysis(BaseModel):
    spoken_summary: str
    written_summary: str
    what_went_well: str
    focus_next_time: str
    safety_note: str
    bonus_rep_suggestion: str
    return_suggestion: str


class GeminiSessionAnalysisResponse(BaseModel):
    ok: bool
    provider: str
    model: str
    analysis: GeminiSessionAnalysis | None = None
    fallback_used: bool = False
    error_message_sanitized: str | None = None


# ---------------------------------------------------------------------------
# Local summary validation response
# ---------------------------------------------------------------------------

class LocalSummaryResponse(BaseModel):
    ok: bool
    packet: FinalSessionAnalysisPacket | None = None
    validation_warnings: list[str] = Field(default_factory=list)
    local_recommendation: str = ""


# ---------------------------------------------------------------------------
# Status response
# ---------------------------------------------------------------------------

class AnalysisV2StatusResponse(BaseModel):
    ok: bool = True
    gemini_ready: bool
    gemini_model: str
    provider: str
    details: dict[str, Any] = Field(default_factory=dict)
