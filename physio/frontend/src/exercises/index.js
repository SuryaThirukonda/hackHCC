import { elbowFlexionExtension } from "./elbowFlexionExtension.js";
import { rightArmRaise } from "./rightArmRaise.js";
import { seatedOneArmForwardPress } from "./seatedOneArmForwardPress.js";

export const exercises = [
  elbowFlexionExtension,
  seatedOneArmForwardPress,
  rightArmRaise,
  {
    id: "shoulder_flexion",
    name: "Shoulder Flexion",
    shortName: "Shoulder Flexion",
    status: "soon",
    joint: "shoulder",
    side: "right",
    description: "Practice a controlled forward shoulder lift with posture feedback.",
    clinicalFraming: "Planned shoulder mobility tracking module.",
    setupCue: "Keep your torso and arm visible.",
    instructions: [
      "Stand or sit tall.",
      "Raise your arm forward with control.",
      "Pause briefly at the top.",
      "Return slowly."
    ],
    repGoal: 8,
    metrics: ["shoulder_angle", "range_of_motion", "control"]
  },
  {
    id: "wrist_extension",
    name: "Wrist Extension",
    shortName: "Wrist Extension",
    status: "soon",
    joint: "wrist",
    side: "right",
    description: "Track wrist extension range once hand rotation analysis is added.",
    clinicalFraming: "Planned wrist mobility tracking module.",
    setupCue: "Keep your hand close to the camera and steady.",
    instructions: [
      "Place your forearm on a stable surface.",
      "Lift your wrist upward.",
      "Pause briefly.",
      "Lower with control."
    ],
    repGoal: 8,
    metrics: ["wrist_angle", "hold_time_sec", "smoothness"]
  }
];

export const defaultExercise = seatedOneArmForwardPress;
