from __future__ import annotations

import json
import os
import re
from typing import Any

from google import genai
from google.genai.types import GenerateContentConfig, HttpOptions, ThinkingConfig

from schemas_session_analysis_v2 import (
    FinalSessionAnalysisPacketV2,
    GeminiSessionAnalysisResponseV2,
    GeminiSessionAnalysisTextV2,
)

DEFAULT_PROJECT = "project-f3192730-7603-48b5-a64"
DEFAULT_LOCATION = "us-central1"
DEFAULT_MODEL = "gemini-2.5-flash"
MAX_ANALYSIS_OUTPUT_TOKENS = 8192
MAX_ANALYSIS_ATTEMPTS = 2
BANNED_PHRASES = (
    "your arm has a problem",
    "you should train every day",
    "your injury is improving",
    "you need treatment",
    "this will heal your elbow",
)
AI_STUDIO_ENV_KEYS = (
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
)


def sanitize_error(exc: BaseException) -> str:
    text = " ".join(str(exc).split())
    text = re.sub(r"\{[^{}]{80,}\}", "{...}", text)
    return (text[:217].rstrip() + "...") if len(text) > 220 else text or exc.__class__.__name__


def extract_json_object(text: str) -> dict[str, Any]:
    # Strip thinking-model chain-of-thought wrapped in <think>...</think>
    if "<think>" in text:
        end_think = text.rfind("</think>")
        if end_think != -1:
            text = text[end_think + len("</think>"):].strip()
    # Strip markdown code fences  ```json ... ```  or  ``` ... ```
    code_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if code_match:
        text = code_match.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("gemini_response_missing_json")
    return json.loads(text[start:end + 1])


def analysis_generate_config() -> GenerateContentConfig:
    return GenerateContentConfig(
        temperature=0.3,
        max_output_tokens=MAX_ANALYSIS_OUTPUT_TOKENS,
        response_mime_type="application/json",
        thinking_config=ThinkingConfig(thinking_budget=0),
    )


def response_text(response: Any) -> str:
    text = getattr(response, "text", None)
    if text and str(text).strip():
        return str(text).strip()
    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None) or []
        chunks = [str(getattr(part, "text", "")) for part in parts if getattr(part, "text", None)]
        if chunks:
            return " ".join(chunks).strip()
    return ""


def clean_text(value: Any, fallback: str, limit: int = 360) -> str:
    text = " ".join(str(value or "").split()).strip()
    if not text:
        text = fallback
    lowered = text.lower()
    if any(phrase in lowered for phrase in BANNED_PHRASES):
        text = fallback
    return text[:limit].rstrip()


def is_forward_press(packet: FinalSessionAnalysisPacketV2) -> bool:
    return packet.exercise_id == "seated_one_arm_forward_press"


def patient_has_sharp_pain(packet: FinalSessionAnalysisPacketV2) -> bool:
    reported = packet.patient_reported or {}
    if reported.get("sharp_pain"):
        return True
    classification = str(reported.get("classification") or "").lower()
    return classification in {"sharp_pain", "sharp pain"}


def bonus_text(packet: FinalSessionAnalysisPacketV2) -> str:
    if patient_has_sharp_pain(packet):
        return ""
    metrics = packet.aggregate_metrics
    rep_goal = packet.goals.rep_goal
    if rep_goal and metrics.total_reps >= rep_goal and (metrics.average_physio_score or 0) >= 75 and packet.tracking_quality.data_quality != "low":
        return "If it feels comfortable, try one extra controlled rep next time."
    return ""


def local_fallback_analysis(packet: FinalSessionAnalysisPacketV2) -> GeminiSessionAnalysisTextV2:
    metrics = packet.aggregate_metrics
    issue = packet.issue_summary.common_issue.replace("_", " ")
    reps = metrics.total_reps
    rep_goal = packet.goals.rep_goal
    summary = packet.local_summary.summary_text or f"You completed {reps} of {rep_goal} planned reps."
    focus = packet.local_summary.recommendation_text or "Focus on controlled movement next time."
    if reps == 0 and packet.issue_summary.zero_rep_reason:
        focus = f"Next time, focus on {packet.issue_summary.zero_rep_reason.replace('_', ' ')}."
    went_well = (
        "You completed the planned goal with controlled reps."
        if rep_goal and reps >= rep_goal and (metrics.average_physio_score or 0) >= 70
        else "You completed structured practice data for review."
    )
    bonus = bonus_text(packet)
    is_press = is_forward_press(packet)
    if is_press and metrics.best_push_depth_cm:
        spoken_extra = f" Best push depth was {metrics.best_push_depth_cm} cm."
        if spoken_extra not in summary:
            summary = f"{summary}{spoken_extra}"
    return GeminiSessionAnalysisTextV2(
        spoken_summary=clean_text(summary, "Session complete. Follow your therapist's plan.", 220),
        written_summary=clean_text(summary, "Session complete. Your local metrics are ready for review.", 420),
        what_went_well=clean_text(went_well, "You practiced the movement with local tracking.", 240),
        focus_next_time=clean_text(focus, f"Focus on {issue} next time.", 240),
        safety_note="Stop if you feel pain and follow your therapist's plan.",
        bonus_rep_suggestion=bonus,
        return_suggestion="Follow your therapist's plan. Based on today's session, return for another short practice session when scheduled.",
    )


def compact_packet_for_gemini(packet: FinalSessionAnalysisPacketV2) -> dict[str, Any]:
    trace = packet.movement_trace or []
    max_points = 16
    if len(trace) > max_points:
        step = max(1, len(trace) // max_points)
        trace = trace[::step][:max_points]
    compact_trace = [
        {
            "t_sec": point.t_sec,
            "angle": point.smoothed_elbow_angle if point.smoothed_elbow_angle is not None else point.raw_elbow_angle,
            "push_depth_cm": point.push_depth_cm,
            "distance_cm": point.distance_cm,
            "phase": point.phase,
            "rep": point.rep_count,
        }
        for point in trace
    ]
    payload: dict[str, Any] = {
        "exercise_id": packet.exercise_id,
        "exercise_name": packet.exercise_name,
        "session": {
            "session_id": packet.session.session_id,
            "duration_sec": packet.session.duration_sec,
            "side": packet.session.side,
        },
        "goals": packet.goals.model_dump(),
        "aggregate_metrics": packet.aggregate_metrics.model_dump(exclude_none=True),
        "tracking_quality": {
            "data_quality": packet.tracking_quality.data_quality,
            "valid_frame_ratio": packet.tracking_quality.valid_frame_ratio,
            "average_jitter_score": packet.tracking_quality.average_jitter_score,
        },
        "trace_summary": packet.trace_summary,
        "issue_summary": packet.issue_summary.model_dump(),
        "rep_breakdown": [rep.model_dump(exclude_none=True) for rep in packet.rep_breakdown[:12]],
        "movement_trace_sample": compact_trace,
        "local_summary": packet.local_summary.model_dump(),
    }
    if packet.patient_reported:
        payload["patient_reported"] = packet.patient_reported
    if packet.sensor_quality:
        payload["sensor_quality"] = packet.sensor_quality.model_dump(exclude_none=True)
    return payload


def build_analysis_prompt(packet: FinalSessionAnalysisPacketV2, safe_packet: dict[str, Any]) -> str:
    metrics = packet.aggregate_metrics
    reps = metrics.total_reps
    rep_goal = packet.goals.rep_goal
    avg_score = metrics.average_physio_score
    is_press = is_forward_press(packet)

    if is_press:
        metric_hint = (
            "Mention the rep count, best push depth in cm, sensor linearity if available, "
            "and extension angle — not flexion ROM degrees."
        )
        written_hint = (
            "Cover: reps completed vs goal, push depth (cm), sensor/tracking quality, "
            "extension angle, hold times, pace, and one improvement tip."
        )
    else:
        metric_hint = "Mention the rep count, best range of motion, and one key takeaway."
        written_hint = (
            "Cover: how many reps were completed vs goal, quality (score, jitter), range of motion achieved, "
            "notable observations from the rep breakdown (e.g. hold times, pace), and one specific improvement tip."
        )

    return (
        "You are a supportive physical therapy exercise assistant writing a detailed post-session summary "
        "for a patient who just completed a home exercise session. "
        "You are NOT diagnosing, prescribing treatment, or replacing a licensed physical therapist. "
        "Use ONLY the structured session data provided. Do not invent injuries, pain, or medical conditions.\n\n"

        "Return ONLY a JSON object with exactly these keys:\n"
        f"  spoken_summary   — 2-3 warm, natural sentences read aloud. {metric_hint}\n"
        f"  written_summary  — 4-6 sentences for display. {written_hint}\n"
        "  what_went_well   — 1-2 encouraging sentences referencing specific strengths from the data.\n"
        "  focus_next_time  — 1-2 concrete, actionable sentences with a specific technique cue.\n"
        "  safety_note      — One short safety reminder in non-diagnostic language.\n"
        "  bonus_rep_suggestion — ONLY 'If it feels comfortable, try one extra controlled rep next time.' "
        f"if reps={reps} >= goal={rep_goal} AND avg_score >= 75 and no sharp pain reported. Otherwise empty string.\n"
        "  return_suggestion — Must contain: 'Follow your therapist's plan. Based on today's session, "
        "return for another short practice session when scheduled.' You may add one sentence.\n\n"

        "Rules: No diagnosis. No treatment promises. No injury claims. No unscheduled training advice. "
        "Be warm, specific, and concise.\n\n"

        f"Session data: {json.dumps(safe_packet, sort_keys=True)}"
    )


class GeminiSessionAnalysisV2Provider:
    def __init__(self) -> None:
        self.project = (os.getenv("GOOGLE_CLOUD_PROJECT") or DEFAULT_PROJECT).strip()
        self.location = (os.getenv("GOOGLE_CLOUD_LOCATION") or DEFAULT_LOCATION).strip()
        self.model = (os.getenv("GEMINI_SESSION_MODEL") or os.getenv("GEMINI_MODEL") or DEFAULT_MODEL).strip()
        self._client: genai.Client | None = None
        self._error: str | None = None
        self._init_client()

    def _init_client(self) -> None:
        try:
            for key in AI_STUDIO_ENV_KEYS:
                os.environ.pop(key, None)
            self._client = genai.Client(
                vertexai=True,
                project=self.project,
                location=self.location,
                http_options=HttpOptions(api_version="v1"),
            )
        except Exception as exc:
            self._client = None
            self._error = sanitize_error(exc)

    def status(self) -> dict[str, Any]:
        return {
            "provider": "vertex-google-genai-v1",
            "auth_mode": "gcloud_adc_vertex",
            "uses_api_key": False,
            "enabled": self._client is not None,
            "project": self.project,
            "location": self.location,
            "model": self.model,
            "error": self._error,
        }

    def analyze(self, packet: FinalSessionAnalysisPacketV2) -> GeminiSessionAnalysisResponseV2:
        fallback = local_fallback_analysis(packet)
        if not self._client:
            return GeminiSessionAnalysisResponseV2(
                ok=False,
                provider="local",
                model="local-fallback",
                analysis=fallback,
                fallback_used=True,
                error_message_sanitized=self._error or "vertex_not_configured",
            )

        safe_packet = compact_packet_for_gemini(packet)
        prompt = build_analysis_prompt(packet, safe_packet)
        try:
            parsed: dict[str, Any] | None = None
            last_exc: BaseException | None = None
            for _ in range(MAX_ANALYSIS_ATTEMPTS):
                try:
                    response = self._client.models.generate_content(
                        model=self.model,
                        contents=prompt,
                        config=analysis_generate_config(),
                    )
                    parsed = extract_json_object(response_text(response))
                    break
                except Exception as exc:
                    last_exc = exc
            if parsed is None:
                raise last_exc or ValueError("gemini_response_missing_json")
            analysis = GeminiSessionAnalysisTextV2(
                spoken_summary=clean_text(parsed.get("spoken_summary"), fallback.spoken_summary, 400),
                written_summary=clean_text(parsed.get("written_summary"), fallback.written_summary, 900),
                what_went_well=clean_text(parsed.get("what_went_well"), fallback.what_went_well, 400),
                focus_next_time=clean_text(parsed.get("focus_next_time"), fallback.focus_next_time, 400),
                safety_note=clean_text(parsed.get("safety_note"), fallback.safety_note, 300),
                bonus_rep_suggestion=bonus_text(packet),
                return_suggestion=clean_text(parsed.get("return_suggestion"), fallback.return_suggestion, 400),
            )
            return GeminiSessionAnalysisResponseV2(
                ok=True,
                provider="vertex",
                model=self.model,
                analysis=analysis,
                fallback_used=False,
                error_message_sanitized=None,
            )
        except Exception as exc:
            return GeminiSessionAnalysisResponseV2(
                ok=False,
                provider="local",
                model="local-fallback",
                analysis=fallback,
                fallback_used=True,
                error_message_sanitized=sanitize_error(exc),
            )
