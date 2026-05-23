function pickExerciseName(exercise, summary) {
  return exercise?.name || summary?.exercise_name || summary?.exercise || "today's exercise";
}

function pickRepStats(summary) {
  const total = summary?.total_reps ?? 0;
  const goal = summary?.rep_goal ?? summary?.repGoal ?? 0;
  const score = summary?.average_physio_score ?? summary?.physio_score;
  return { total, goal, score };
}

function pickFocus(summary, geminiAnalysis) {
  return (
    geminiAnalysis?.analysis?.focus_next_time
    || summary?.recommendation_text
    || summary?.common_issue?.replaceAll?.("_", " ")
    || "controlled, steady movement"
  );
}

function pickWentWell(summary, geminiAnalysis) {
  return geminiAnalysis?.analysis?.what_went_well || summary?.summary_text || "";
}

function formatScore(score) {
  return Number.isFinite(score) ? `${Math.round(score)} out of 100` : "not scored";
}

export function buildCoachSessionContext({ exercise, summary, geminiAnalysis, sessionId } = {}) {
  const exerciseName = pickExerciseName(exercise, summary);
  const { total, goal, score } = pickRepStats(summary);
  const focus = pickFocus(summary, geminiAnalysis);
  const wentWell = pickWentWell(summary, geminiAnalysis);
  const joint = exercise?.joint || "movement";
  const setupCue = exercise?.setupCue || exercise?.clinicalFraming || "";
  const instructions = Array.isArray(exercise?.instructions) ? exercise.instructions.slice(0, 4) : [];

  const briefLines = [
    `Exercise: ${exerciseName}`,
    goal ? `Reps: ${total} of ${goal} planned` : `Reps completed: ${total}`,
    Number.isFinite(score) ? `Movement quality score: ${formatScore(score)}` : null,
    focus ? `Focus next time: ${focus}` : null,
  ].filter(Boolean);

  const openingMessage =
    `You just finished ${exerciseName}. You completed ${total}${goal ? ` of ${goal}` : ""} reps` +
    `${Number.isFinite(score) ? ` with a movement score of ${Math.round(score)}` : ""}. ` +
    "How did that feel? Any pain, tightness, or fatigue? Was it easier or harder than last time?";

  const liveAvatarPrompt = [
    "You are a supportive physical therapy coach reviewing a home exercise session.",
    "You are NOT diagnosing or prescribing treatment. Encourage the patient and ask brief follow-up questions.",
    `Exercise performed: ${exerciseName} (${joint} focus).`,
    goal ? `Reps completed: ${total} of ${goal}.` : `Reps completed: ${total}.`,
    Number.isFinite(score) ? `Average movement quality score: ${Math.round(score)}/100.` : "",
    wentWell ? `What went well: ${wentWell}` : "",
    `Coach focus for next session: ${focus}.`,
    setupCue ? `Setup cue for this exercise: ${setupCue}` : "",
    instructions.length ? `Key movement steps: ${instructions.join("; ")}.` : "",
    "Ask how the session felt, whether anything hurt, and if it was easier or harder than last time.",
    "Keep replies warm, short, and non-diagnostic.",
  ].filter(Boolean).join(" ");

  const chatBriefing =
    `Session briefing — use these facts when I ask questions: ` +
    `Exercise: ${exerciseName}. Reps: ${total}${goal ? ` of ${goal}` : ""}.` +
    `${Number.isFinite(score) ? ` Movement score: ${Math.round(score)}/100.` : ""} ` +
    `Focus next time: ${focus}.`;

  const spokenIntro =
    `Nice work on ${exerciseName}. You finished ${total}${goal ? ` of ${goal}` : ""} reps.` +
    `${Number.isFinite(score) ? ` Your movement score was ${Math.round(score)}.` : ""} ` +
    "Tell me how that felt — any pain, tightness, or fatigue? Was it easier or harder than last time?";

  return {
    session_id: sessionId || summary?.session_id || null,
    exercise_id: exercise?.id || summary?.exercise || null,
    exercise_name: exerciseName,
    opening_message: openingMessage,
    spoken_intro: spokenIntro,
    live_avatar_prompt: liveAvatarPrompt,
    chat_briefing: chatBriefing,
    brief_lines: briefLines,
    check_in_questions: [
      {
        id: "feel",
        label: "How did this session feel?",
        placeholder: "Describe comfort, fatigue, tightness, or anything you noticed…",
      },
      {
        id: "pain",
        label: "Any pain during or after the exercise?",
        type: "pain_scale",
      },
      {
        id: "compare",
        label: "Compared to your last session",
        type: "compare",
      },
    ],
  };
}
