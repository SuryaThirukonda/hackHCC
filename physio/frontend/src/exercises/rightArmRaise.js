export const rightArmRaise = {
  id: "right_arm_raise",
  name: "Right Arm Raise",
  shortName: "Arm Raise",
  status: "soon",
  joint: "shoulder",
  side: "right",
  description: "Lift your arm toward a target range while keeping the motion smooth.",
  clinicalFraming: "Planned shoulder range-of-motion tracking module.",
  setupCue: "Keep your shoulder, elbow, and wrist visible.",
  instructions: [
    "Start with your arm resting at your side.",
    "Raise your arm toward the target angle.",
    "Hold briefly at the top.",
    "Lower with control."
  ],
  repGoal: 8,
  metrics: ["shoulder_angle", "pace", "jitter_score"]
};
