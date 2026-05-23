from __future__ import annotations

from fastapi import APIRouter

from coach.gemini_session_analysis_v2 import GeminiSessionAnalysisV2Provider, local_fallback_analysis
from coach.therapist_note_v2 import TherapistNoteV2Provider
from schemas_session_analysis_v2 import (
    FinalSessionAnalysisPacketV2,
    GeminiSessionAnalysisResponseV2,
    TherapistNoteRequestV2,
    TherapistNoteResponseV2,
)

router = APIRouter(prefix="/api/analysis/v2", tags=["session-analysis-v2"])


def local_recommendation(packet: FinalSessionAnalysisPacketV2) -> str:
    if packet.local_summary.recommendation_text:
        return packet.local_summary.recommendation_text
    if packet.issue_summary.zero_rep_reason:
        return f"Focus on {packet.issue_summary.zero_rep_reason.replace('_', ' ')}."
    if packet.issue_summary.common_issue != "none":
        return f"Focus on {packet.issue_summary.common_issue.replace('_', ' ')}."
    return "Keep the same controlled pace next session."


@router.post("/session-summary-local")
def session_summary_local(packet: FinalSessionAnalysisPacketV2) -> dict:
    warnings = list(packet.issue_summary.warnings)
    if packet.aggregate_metrics.total_reps == 0 and not packet.issue_summary.zero_rep_reason:
        warnings.append("zero_reps_without_reason")
    if packet.tracking_quality.data_quality == "low":
        warnings.append("low_tracking_quality")
    return {
        "ok": True,
        "normalized": packet.model_dump(),
        "validation_warnings": sorted(set(warnings)),
        "local_recommendation": local_recommendation(packet),
    }


@router.post("/gemini-session-analysis", response_model=GeminiSessionAnalysisResponseV2)
def gemini_session_analysis(packet: FinalSessionAnalysisPacketV2) -> GeminiSessionAnalysisResponseV2:
    return GeminiSessionAnalysisV2Provider().analyze(packet)


@router.post("/therapist-note", response_model=TherapistNoteResponseV2)
def therapist_note(request: TherapistNoteRequestV2) -> TherapistNoteResponseV2:
    return TherapistNoteV2Provider().generate(
        request.session_packet,
        request.patient_feedback,
        request.gemini_analysis,
    )


@router.get("/status")
def session_analysis_status() -> dict:
    provider = GeminiSessionAnalysisV2Provider()
    return {
        "ok": True,
        "route": "session_analysis_v2",
        "gemini": provider.status(),
        "fallback_preview": local_fallback_analysis(
            FinalSessionAnalysisPacketV2(
                session={"session_id": "debug-session", "duration_sec": 0}
            )
        ).model_dump(),
    }
