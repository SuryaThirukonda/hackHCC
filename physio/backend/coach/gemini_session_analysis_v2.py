from __future__ import annotations

import json
import os
from typing import Any

from coach.base import clean_coach_text
from coach.gemini_coach import GeminiCoachProvider, sanitize_gemini_error
from schemas_session_analysis_v2 import (
    FinalSessionAnalysisPacket,
    GeminiSessionAnalysis,
    GeminiSessionAnalysisResponse,
)

SAFE_SYSTEM_CONTEXT = (
    "You are a physical therapy exercise assistant summarizing a completed home exercise session. "
    "You are not diagnosing, prescribing treatment, or replacing a physical therapist. "
    "Use only the structured session data provided. "
    "Do not invent injuries, medical conditions, or treatment plans. "
    "Stay encouraging, concrete, and safe."
)

FORBIDDEN_PHRASES = (
    "your arm has a problem",
    "you should train every day",
    "your injury is improving",
    "you need treatment",
    "this will heal",
    "diagnosis",
)

_SAFE_RETURN = (
    "Follow your therapist's plan. "
    "Based on today's session, return for another short practice session when scheduled."
)

_SAFE_BONUS = (
    "If it feels comfortable, try one extra controlled rep next time."
)


def _build_prompt(packet: FinalSessionAnalysisPacket) -> str:
    agg = packet.aggregate_metrics
    iss = packet.issue_summary
    tq = packet.tracking_quality

    reps_summary = []
    for rep in packet.rep_breakdown:
        reps_summary.append({
            "rep": rep.rep_number,
            "clean": rep.clean,
            "rom": rep.range_of_motion,
            "hold_sec": rep.hold_time_sec,
            "pace_ok": rep.issue_label == "none" or rep.issue_label is None,
            "issue": rep.issue_label,
            "score": rep.physio_score,
        })

    data = {
        "exercise": packet.exercise_name,
        "duration_sec": round(packet.duration_sec),
        "rep_goal": packet.rep_goal,
        "completed_reps": packet.completed_reps,
        "clean_reps": packet.clean_reps,
        "bonus_rep_attempted": packet.bonus_rep_attempted,
        "bonus_rep_completed": packet.bonus_rep_completed,
        "best_range_of_motion_deg": agg.best_range_of_motion,
        "average_range_of_motion_deg": agg.average_range_of_motion,
        "average_hold_sec": agg.average_hold_time_sec,
        "average_rep_duration_sec": agg.average_rep_duration_sec,
        "average_physio_score": agg.average_physio_score,
        "average_jitter_score": agg.average_jitter_score,
        "average_shoulder_drift_deg": agg.average_shoulder_drift,
        "best_rep": agg.best_rep_number,
        "weakest_rep": agg.weakest_rep_number,
        "common_issue": iss.common_issue,
        "too_fast_count": iss.too_fast_count,
        "too_jittery_count": iss.too_jittery_count,
        "short_hold_count": iss.short_hold_count,
        "shoulder_comp_count": iss.shoulder_compensation_count,
        "tracking_confidence": tq.confidence_label,
        "local_recommendation": packet.local_recommendation,
        "rep_details": reps_summary,
    }

    prompt = (
        f"{SAFE_SYSTEM_CONTEXT}\n\n"
        "Using only the structured metrics below, return a JSON object with exactly these keys:\n"
        "- spoken_summary: 2-3 calm spoken sentences suitable for text-to-speech. No markdown.\n"
        "- written_summary: 2-3 written sentences for the results screen. Can use light punctuation.\n"
        "- what_went_well: One specific positive observation from the data (under 20 words).\n"
        "- focus_next_time: One specific, actionable focus for the next session (under 20 words).\n"
        "- safety_note: A single safe, encouraging sentence (use the therapist-plan language).\n"
        "- bonus_rep_suggestion: A short suggestion only if completed_reps >= rep_goal AND average_physio_score >= 70. Otherwise empty string.\n"
        "- return_suggestion: When to return (use the scheduled-session language).\n\n"
        "Rules:\n"
        "- No medical diagnosis. No injury claims. No treatment prescriptions.\n"
        "- Do not say 'your arm has a problem' or similar.\n"
        "- Use only data from the metrics. Do not invent observations.\n"
        "- Return JSON only. No extra text, no markdown code blocks.\n\n"
        f"Session metrics: {json.dumps(data, sort_keys=True)}"
    )
    return prompt


def _fallback_analysis(packet: FinalSessionAnalysisPacket) -> GeminiSessionAnalysis:
    local_rec = packet.local_recommendation or "Keep the same controlled pace next session."
    completed = packet.completed_reps
    goal = packet.rep_goal
    rom = packet.aggregate_metrics.best_range_of_motion

    spoken = (
        f"You completed {completed} out of {goal} reps today. "
        f"Your best range of motion was {rom:.0f} degrees. "
        f"{local_rec}"
    )
    bonus = _SAFE_BONUS if (completed >= goal and packet.aggregate_metrics.average_physio_score >= 70) else ""

    return GeminiSessionAnalysis(
        spoken_summary=spoken,
        written_summary=spoken,
        what_went_well=f"You completed {completed} rep{'s' if completed != 1 else ''} with consistent effort.",
        focus_next_time=local_rec,
        safety_note="Follow your therapist's plan and only do what feels comfortable.",
        bonus_rep_suggestion=bonus,
        return_suggestion=_SAFE_RETURN,
    )


def _clean_analysis(raw: dict[str, Any], packet: FinalSessionAnalysisPacket) -> GeminiSessionAnalysis:
    fallback = _fallback_analysis(packet)
    completed = packet.completed_reps
    goal = packet.rep_goal
    score = packet.aggregate_metrics.average_physio_score

    spoken = clean_coach_text(str(raw.get("spoken_summary") or ""), fallback.spoken_summary)
    written = clean_coach_text(str(raw.get("written_summary") or ""), fallback.written_summary)
    what_well = clean_coach_text(str(raw.get("what_went_well") or ""), fallback.what_went_well)
    focus = clean_coach_text(str(raw.get("focus_next_time") or ""), fallback.focus_next_time)
    safety = clean_coach_text(str(raw.get("safety_note") or ""), fallback.safety_note)

    raw_bonus = str(raw.get("bonus_rep_suggestion") or "")
    if completed < goal or score < 70:
        bonus = ""
    else:
        bonus = clean_coach_text(raw_bonus, fallback.bonus_rep_suggestion)

    return_sug = clean_coach_text(str(raw.get("return_suggestion") or ""), _SAFE_RETURN)

    # Sanitise forbidden phrases from all text fields
    def sanitise(text: str) -> str:
        lower = text.lower()
        for phrase in FORBIDDEN_PHRASES:
            if phrase in lower:
                return fallback.spoken_summary
        return text

    return GeminiSessionAnalysis(
        spoken_summary=sanitise(spoken),
        written_summary=sanitise(written),
        what_went_well=sanitise(what_well),
        focus_next_time=sanitise(focus),
        safety_note=sanitise(safety),
        bonus_rep_suggestion=bonus,
        return_suggestion=return_sug,
    )


def generate_post_session_analysis(
    packet: FinalSessionAnalysisPacket,
) -> GeminiSessionAnalysisResponse:
    provider = GeminiCoachProvider()
    model_name = provider.model

    if not provider.vertex_enabled:
        fallback = _fallback_analysis(packet)
        return GeminiSessionAnalysisResponse(
            ok=True,
            provider="local",
            model=model_name,
            analysis=fallback,
            fallback_used=True,
            error_message_sanitized="Gemini not available — using local analysis.",
        )

    prompt = _build_prompt(packet)
    try:
        raw_text = provider._generate_text(prompt, max_output_tokens=512)
        start = raw_text.find("{")
        end = raw_text.rfind("}")
        if start == -1 or end <= start:
            raise ValueError("gemini_response_missing_json")
        parsed = json.loads(raw_text[start:end + 1])
        analysis = _clean_analysis(parsed, packet)
        return GeminiSessionAnalysisResponse(
            ok=True,
            provider="gemini",
            model=model_name,
            analysis=analysis,
            fallback_used=False,
        )
    except Exception as exc:
        fallback = _fallback_analysis(packet)
        return GeminiSessionAnalysisResponse(
            ok=True,
            provider="local_fallback",
            model=model_name,
            analysis=fallback,
            fallback_used=True,
            error_message_sanitized=sanitize_gemini_error(exc),
        )
