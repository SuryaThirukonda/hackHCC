from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from coach.gemini_coach import GeminiCoachProvider
from coach.gemini_session_analysis_v2 import generate_post_session_analysis
from schemas_session_analysis_v2 import (
    AnalysisV2StatusResponse,
    FinalSessionAnalysisPacket,
    GeminiSessionAnalysisResponse,
    LocalSummaryResponse,
)

router = APIRouter(prefix="/api/analysis/v2", tags=["analysis-v2"])


@router.get("/status", response_model=AnalysisV2StatusResponse)
def analysis_v2_status() -> AnalysisV2StatusResponse:
    status = GeminiCoachProvider.debug_status()
    return AnalysisV2StatusResponse(
        ok=True,
        gemini_ready=status.get("vertex_enabled", False),
        gemini_model=status.get("model", "unknown"),
        provider="gemini" if status.get("vertex_enabled") else "local",
        details=status,
    )


@router.post("/session-summary-local", response_model=LocalSummaryResponse)
def session_summary_local(packet: FinalSessionAnalysisPacket) -> LocalSummaryResponse:
    """Validate and echo the local FinalSessionAnalysisPacket with any warnings."""
    warnings: list[str] = []

    if packet.completed_reps == 0:
        warnings.append("no_reps_completed")
    if packet.tracking_quality.valid_frame_ratio < 0.5:
        warnings.append("low_tracking_quality")
    if packet.duration_sec < 5:
        warnings.append("session_too_short")
    if not packet.rep_breakdown:
        warnings.append("rep_breakdown_missing")
    if not packet.local_recommendation:
        warnings.append("local_recommendation_missing")

    return LocalSummaryResponse(
        ok=True,
        packet=packet,
        validation_warnings=warnings,
        local_recommendation=packet.local_recommendation,
    )


@router.post("/gemini-session-analysis", response_model=GeminiSessionAnalysisResponse)
def gemini_session_analysis(packet: FinalSessionAnalysisPacket) -> GeminiSessionAnalysisResponse:
    """Run post-session Gemini analysis. Gemini must not be called during live exercise."""
    return generate_post_session_analysis(packet)
