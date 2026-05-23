from __future__ import annotations

import json
import os
from typing import Any

from google import genai
from google.genai.types import GenerateContentConfig, HttpOptions, ThinkingConfig

from coach.gemini_session_analysis_v2 import (
    DEFAULT_LOCATION,
    DEFAULT_MODEL,
    DEFAULT_PROJECT,
    AI_STUDIO_ENV_KEYS,
    extract_json_object,
    response_text,
    sanitize_error,
)
from schemas_session_analysis_v2 import (
    FinalSessionAnalysisPacketV2,
    PatientFeedbackV2,
    TherapistNoteResponseV2,
    TherapistSessionNoteV2,
)

MAX_NOTE_OUTPUT_TOKENS = 4096


def feedback_label(feedback: PatientFeedbackV2) -> str:
    mapping = {
        "no_issue": "No issues reported",
        "fatigue": "Reported mild fatigue, no sharp pain",
        "tightness": "Reported tightness, no sharp pain",
        "discomfort": "Reported mild discomfort, no sharp pain",
        "sharp_pain": "Reported sharp pain — stop and follow therapist guidance",
        "easier_than_last": "Felt easier than last time",
        "harder_than_last": "Felt harder than last time",
        "same_as_last": "Felt about the same as last time",
    }
    return mapping.get(feedback.classification, feedback.raw_text or "No feedback recorded")


def sensor_tracking_quality(packet: FinalSessionAnalysisPacketV2) -> str:
    sensor = packet.sensor_quality
    tracking = packet.tracking_quality.data_quality
    if packet.exercise_id == "seated_one_arm_forward_press":
        sensor_part = "Sensor offline"
        if sensor:
            if sensor.sensor_status in {"ok", "connected"} and sensor.calibration_complete:
                sensor_part = "Sensor connected"
            elif sensor.calibration_complete:
                sensor_part = "Sensor connected with calibration"
            elif sensor.sensor_status not in {"offline", ""}:
                sensor_part = f"Sensor {sensor.sensor_status}"
        camera_part = "camera tracking stable" if tracking in {"high", "medium"} else "camera tracking limited"
        return f"{sensor_part}, {camera_part}"
    return f"Camera tracking {tracking}"


def local_fallback_note(
    packet: FinalSessionAnalysisPacketV2,
    feedback: PatientFeedbackV2,
    gemini_analysis: dict[str, Any] | None = None,
) -> TherapistSessionNoteV2:
    metrics = packet.aggregate_metrics
    rep_goal = packet.goals.rep_goal or 3
    reps = metrics.total_reps
    issue = packet.issue_summary.common_issue.replace("_", " ")
    focus = (gemini_analysis or {}).get("focus_next_time") or packet.local_summary.recommendation_text or f"Slower, steadier {issue}."
    quality = "Controlled overall"
    if metrics.average_jitter_score and metrics.average_jitter_score > 0.35:
        quality = "Controlled overall, with mild jitter during movement"
    if packet.exercise_id == "seated_one_arm_forward_press" and metrics.best_push_depth_cm:
        quality = f"{quality}; best push depth {metrics.best_push_depth_cm} cm"

    safety = "Follow your therapist's plan and stop if sharp pain occurs."
    if feedback.sharp_pain or feedback.classification == "sharp_pain":
        safety = "Patient reported sharp pain. Stop here and follow therapist guidance before continuing."

    return TherapistSessionNoteV2(
        exercise=packet.exercise_name,
        completed=f"{reps} of {rep_goal} reps",
        movement_quality=quality,
        main_issue=issue if issue != "none" else "No major issue detected",
        sensor_tracking_quality=sensor_tracking_quality(packet),
        patient_feedback=feedback_label(feedback),
        next_focus=focus[:240],
        safety_note=safety,
    )


class TherapistNoteV2Provider:
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

    def generate(
        self,
        packet: FinalSessionAnalysisPacketV2,
        feedback: PatientFeedbackV2,
        gemini_analysis: dict[str, Any] | None = None,
    ) -> TherapistNoteResponseV2:
        fallback = local_fallback_note(packet, feedback, gemini_analysis)
        if not self._client:
            return TherapistNoteResponseV2(
                ok=False,
                provider="local",
                model="local-fallback",
                note=fallback,
                fallback_used=True,
                error_message_sanitized=self._error or "vertex_not_configured",
            )

        prompt = (
            "You are writing a therapist-style session note for a home exercise session. "
            "Use ONLY the structured data provided. Do not diagnose or prescribe treatment.\n\n"
            "Return ONLY JSON with keys: exercise, completed, movement_quality, main_issue, "
            "sensor_tracking_quality, patient_feedback, next_focus, safety_note.\n\n"
            f"Session packet: {json.dumps(packet.model_dump(exclude_none=True), sort_keys=True)}\n"
            f"Patient feedback: {json.dumps(feedback.model_dump(), sort_keys=True)}\n"
            f"Gemini summary: {json.dumps(gemini_analysis or {}, sort_keys=True)}"
        )
        try:
            response = self._client.models.generate_content(
                model=self.model,
                contents=prompt,
                config=GenerateContentConfig(
                    temperature=0.2,
                    max_output_tokens=MAX_NOTE_OUTPUT_TOKENS,
                    response_mime_type="application/json",
                    thinking_config=ThinkingConfig(thinking_budget=0),
                ),
            )
            parsed = extract_json_object(response_text(response))
            note = TherapistSessionNoteV2(
                exercise=str(parsed.get("exercise") or fallback.exercise),
                completed=str(parsed.get("completed") or fallback.completed),
                movement_quality=str(parsed.get("movement_quality") or fallback.movement_quality),
                main_issue=str(parsed.get("main_issue") or fallback.main_issue),
                sensor_tracking_quality=str(parsed.get("sensor_tracking_quality") or fallback.sensor_tracking_quality),
                patient_feedback=str(parsed.get("patient_feedback") or fallback.patient_feedback),
                next_focus=str(parsed.get("next_focus") or fallback.next_focus),
                safety_note=str(parsed.get("safety_note") or fallback.safety_note),
            )
            return TherapistNoteResponseV2(
                ok=True,
                provider="vertex",
                model=self.model,
                note=note,
                fallback_used=False,
            )
        except Exception as exc:
            return TherapistNoteResponseV2(
                ok=False,
                provider="local",
                model="local-fallback",
                note=fallback,
                fallback_used=True,
                error_message_sanitized=sanitize_error(exc),
            )
