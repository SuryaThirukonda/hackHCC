export const elbowFlexionExtension = {
  id: "elbow_flexion_extension",
  name: "Elbow Flexion / Extension",
  shortName: "Elbow Flexion",
  status: "ready",
  joint: "elbow",
  side: "right",
  description: "Bend and straighten your elbow with controlled motion while keeping your upper arm steady.",
  clinicalFraming:
    "Tracks elbow range of motion similarly to how a therapist would measure elbow movement with a goniometer.",
  setupCue: "Sit sideways to the camera. Keep your shoulder, elbow, and wrist visible.",
  instructions: [
    "Start with your arm mostly straight.",
    "Bend your elbow toward your shoulder.",
    "Hold the bend briefly.",
    "Straighten your arm with control.",
    "Keep your upper arm as still as possible."
  ],
  repGoal: 3,
  bonusRepAvailable: true,
  startPosition: {
    elbowAngleMin: 145,
    elbowAngleMax: 180
  },
  targetPosition: {
    elbowAngleMin: 55,
    elbowAngleMax: 95
  },
  holdSeconds: 2.5,
  minRepSeconds: 2.0,
  maxRepSeconds: 6.0,
  jitterThreshold: 0.35,
  shoulderDriftThreshold: 28,
  metrics: [
    "elbow_angle",
    "shoulder_angle",
    "range_of_motion",
    "hold_time_sec",
    "pace",
    "jitter_score",
    "physio_score"
  ]
};
