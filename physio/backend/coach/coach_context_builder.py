from __future__ import annotations

from typing import Any


def _exercise_name(exercise: dict[str, Any] | None, summary: dict[str, Any] | None) -> str:
    if exercise and exercise.get("name"):
        return str(exercise["name"])
    if summary and summary.get("exercise_name"):
        return str(summary["exercise_name"])
    if summary and summary.get("exercise"):
        return str(summary["exercise"]).replace("_", " ")
    return "today's exercise"


def build_coach_session_context(
    *,
    exercise: dict[str, Any] | None = None,
    summary: dict[str, Any] | None = None,
    gemini_analysis: dict[str, Any] | None = None,
    session_id: str | None = None,
) -> dict[str, Any]:
    exercise = exercise or {}
    summary = summary or {}
    analysis = (gemini_analysis or {}).get("analysis") or gemini_analysis or {}

    exercise_name = _exercise_name(exercise, summary)
    total = int(summary.get("total_reps") or 0)
    goal = int(summary.get("rep_goal") or exercise.get("repGoal") or 0)
    score = summary.get("average_physio_score") or summary.get("physio_score")
    focus = (
        analysis.get("focus_next_time")
        or summary.get("recommendation_text")
        or str(summary.get("common_issue") or "controlled, steady movement").replace("_", " ")
    )
    went_well = analysis.get("what_went_well") or summary.get("summary_text") or ""
    joint = exercise.get("joint") or "movement"
    setup_cue = exercise.get("setupCue") or exercise.get("clinicalFraming") or ""
    instructions = [str(item) for item in (exercise.get("instructions") or [])[:4]]

    brief_lines = [
        f"Exercise: {exercise_name}",
        f"Reps: {total} of {goal} planned" if goal else f"Reps completed: {total}",
    ]
    if isinstance(score, (int, float)):
        brief_lines.append(f"Movement quality score: {int(round(score))} out of 100")
    if focus:
        brief_lines.append(f"Focus next time: {focus}")

    score_text = f" with a movement score of {int(round(score))}" if isinstance(score, (int, float)) else ""
    goal_text = f" of {goal}" if goal else ""
    opening_message = (
        f"You just finished {exercise_name}. You completed {total}{goal_text} reps{score_text}. "
        "How did that feel? Any pain, tightness, or fatigue? Was it easier or harder than last time?"
    )

    prompt_parts = [
        "You are a supportive physical therapy coach reviewing a home exercise session.",
        "You are NOT diagnosing or prescribing treatment. Encourage the patient and ask brief follow-up questions.",
        f"Exercise performed: {exercise_name} ({joint} focus).",
        f"Reps completed: {total} of {goal}." if goal else f"Reps completed: {total}.",
    ]
    if isinstance(score, (int, float)):
        prompt_parts.append(f"Average movement quality score: {int(round(score))}/100.")
    if went_well:
        prompt_parts.append(f"What went well: {went_well}")
    prompt_parts.extend([
        f"Coach focus for next session: {focus}.",
        f"Setup cue for this exercise: {setup_cue}." if setup_cue else "",
        f"Key movement steps: {'; '.join(instructions)}." if instructions else "",
        "Ask how the session felt, whether anything hurt, and if it was easier or harder than last time.",
        "Keep replies warm, short, and non-diagnostic.",
    ])
    live_avatar_prompt = " ".join(part for part in prompt_parts if part)

    chat_briefing = (
        "Session briefing — use these facts when I ask questions: "
        f"Exercise: {exercise_name}. Reps: {total}{f' of {goal}' if goal else ''}."
        f"{f' Movement score: {int(round(score))}/100.' if isinstance(score, (int, float)) else ''} "
        f"Focus next time: {focus}."
    )

    spoken_intro = (
        f"Nice work on {exercise_name}. You finished {total}{goal_text} reps."
        f"{f' Your movement score was {int(round(score))}.' if isinstance(score, (int, float)) else ''} "
        "Tell me how that felt — any pain, tightness, or fatigue? Was it easier or harder than last time?"
    )

    return {
        "session_id": session_id or summary.get("session_id"),
        "exercise_id": exercise.get("id") or summary.get("exercise"),
        "exercise_name": exercise_name,
        "opening_message": opening_message,
        "spoken_intro": spoken_intro,
        "live_avatar_prompt": live_avatar_prompt,
        "chat_briefing": chat_briefing,
        "brief_lines": brief_lines,
        "check_in_questions": [
            {
                "id": "feel",
                "label": "How did this session feel?",
                "placeholder": "Describe comfort, fatigue, tightness, or anything you noticed…",
            },
            {"id": "pain", "label": "Any pain during or after the exercise?", "type": "pain_scale"},
            {"id": "compare", "label": "Compared to your last session", "type": "compare"},
        ],
    }
