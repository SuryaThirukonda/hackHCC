export const seatedOneArmForwardPress = {
  id: "seated_one_arm_forward_press",
  name: "Seated One-Arm Forward Press",
  shortName: "Forward Press",
  status: "ready",
  joint: "elbow",
  movementType: "forward_press",
  side: "right",
  description: "Push your hand forward from a bent elbow position, then return with steady control.",
  clinicalFraming:
    "Tracks press smoothness using webcam elbow extension and distance readings from the hand sensor.",
  setupCue: "Sit tall facing the sensor. Keep your shoulder, elbow, wrist, and hand sensor path visible.",
  instructions: [
    "Start with your elbow bent and your hand near your chest.",
    "Push your hand forward slowly toward the sensor.",
    "Hold the reach briefly.",
    "Return to the bent start position with control.",
    "Keep your shoulder relaxed and your arm level."
  ],
  repGoal: 3,
  startPosition: {
    elbowAngleMin: 65,
    elbowAngleMax: 115
  },
  targetPosition: {
    elbowAngleMin: 145,
    elbowAngleMax: 178
  },
  holdSeconds: 1.2,
  minRepSeconds: 2.0,
  maxRepSeconds: 7.0,
  targetPushDepthCm: 10,
  minPushDepthCm: 6,
  sensorStaleMs: 500,
  jitterThreshold: 0.38,
  shoulderDriftThreshold: 24,
  metrics: [
    "elbow_angle",
    "distance_cm",
    "push_depth_cm",
    "sensor_linearity",
    "hold_time_sec",
    "pace",
    "jitter_score",
    "physio_score"
  ]
};
