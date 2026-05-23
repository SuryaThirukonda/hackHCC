const CLASSIFICATIONS = {
  NO_ISSUE: "no_issue",
  FATIGUE: "fatigue",
  TIGHTNESS: "tightness",
  DISCOMFORT: "discomfort",
  SHARP_PAIN: "sharp_pain",
  EASIER: "easier_than_last",
  HARDER: "harder_than_last",
  SAME: "same_as_last"
};

const KEYWORD_RULES = [
  { classification: CLASSIFICATIONS.SHARP_PAIN, patterns: [/sharp pain/i, /stabbing/i, /severe pain/i, /bad pain/i] },
  { classification: CLASSIFICATIONS.FATIGUE, patterns: [/fatigue/i, /tired/i, /exhausted/i, /worn out/i] },
  { classification: CLASSIFICATIONS.TIGHTNESS, patterns: [/tight/i, /stiff/i, /tension/i] },
  { classification: CLASSIFICATIONS.DISCOMFORT, patterns: [/discomfort/i, /sore/i, /ache/i, /uncomfortable/i, /mild pain/i] },
  { classification: CLASSIFICATIONS.EASIER, patterns: [/easier/i, /better than last/i, /less hard/i] },
  { classification: CLASSIFICATIONS.HARDER, patterns: [/harder/i, /more difficult/i, /tougher/i, /worse than last/i] },
  { classification: CLASSIFICATIONS.SAME, patterns: [/same as last/i, /about the same/i, /no change/i, /similar/i] },
  { classification: CLASSIFICATIONS.NO_ISSUE, patterns: [/fine/i, /good/i, /no issue/i, /felt ok/i, /felt okay/i, /no pain/i] }
];

export const FEEDBACK_CHIPS = [
  { id: CLASSIFICATIONS.NO_ISSUE, label: "Felt fine" },
  { id: CLASSIFICATIONS.FATIGUE, label: "Fatigue" },
  { id: CLASSIFICATIONS.TIGHTNESS, label: "Tightness" },
  { id: CLASSIFICATIONS.DISCOMFORT, label: "Discomfort" },
  { id: CLASSIFICATIONS.SHARP_PAIN, label: "Sharp pain" },
  { id: CLASSIFICATIONS.EASIER, label: "Easier than last time" },
  { id: CLASSIFICATIONS.HARDER, label: "Harder than last time" },
  { id: CLASSIFICATIONS.SAME, label: "About the same" }
];

export function safeResponseForClassification(classification) {
  const responses = {
    [CLASSIFICATIONS.FATIGUE]: "Thanks. I'll note that this felt tiring today. Follow your therapist's plan and keep the next session controlled.",
    [CLASSIFICATIONS.TIGHTNESS]: "Thanks. I'll note the tightness. Keep movements slow and follow your therapist's guidance.",
    [CLASSIFICATIONS.DISCOMFORT]: "Thanks for sharing. I'll note the mild discomfort. Keep movements controlled and follow your therapist's plan.",
    [CLASSIFICATIONS.SHARP_PAIN]: "Session saved. Stop here and follow your therapist's guidance before continuing.",
    [CLASSIFICATIONS.EASIER]: "Good to hear it felt easier. Keep the same controlled pace your therapist recommends.",
    [CLASSIFICATIONS.HARDER]: "Thanks for letting me know it felt harder. Keep the next session controlled and follow your therapist's plan.",
    [CLASSIFICATIONS.SAME]: "Thanks. I'll note that it felt about the same. Follow your therapist's plan for the next session.",
    [CLASSIFICATIONS.NO_ISSUE]: "Thanks. I'll note that the session felt okay. Follow your therapist's plan for your next session."
  };
  return responses[classification] || responses[CLASSIFICATIONS.NO_ISSUE];
}

export function classifyPatientFeedback(rawText = "", selectedClassification = null) {
  const text = String(rawText || "").trim();
  if (selectedClassification) {
    return buildFeedback(text, selectedClassification);
  }
  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return buildFeedback(text, rule.classification);
    }
  }
  return buildFeedback(text, text ? CLASSIFICATIONS.NO_ISSUE : CLASSIFICATIONS.NO_ISSUE);
}

function buildFeedback(rawText, classification) {
  const sharpPain = classification === CLASSIFICATIONS.SHARP_PAIN;
  const painLevel = sharpPain ? 8 : classification === CLASSIFICATIONS.DISCOMFORT ? 4 : classification === CLASSIFICATIONS.TIGHTNESS ? 3 : 0;
  const fatigueLevel = classification === CLASSIFICATIONS.FATIGUE ? 7 : classification === CLASSIFICATIONS.HARDER ? 5 : 0;
  let difficulty = "unknown";
  if (classification === CLASSIFICATIONS.EASIER) difficulty = "easier";
  if (classification === CLASSIFICATIONS.HARDER) difficulty = "harder";
  if (classification === CLASSIFICATIONS.SAME) difficulty = "same";

  return {
    raw_text: rawText,
    classification,
    pain_level: painLevel,
    fatigue_level: fatigueLevel,
    difficulty_vs_last: difficulty,
    sharp_pain: sharpPain,
    response_text: safeResponseForClassification(classification)
  };
}

export { CLASSIFICATIONS };
