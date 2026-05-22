import { ArrowLeft, Camera, CheckCircle2, Play, Target } from "lucide-react";
import ExerciseMovementDiagram from "./ExerciseMovementDiagram.jsx";

export default function ExercisePreview({ exercise, onBack, onBegin }) {
  const targetRange = exercise.targetPosition
    ? `${exercise.targetPosition.elbowAngleMin}-${exercise.targetPosition.elbowAngleMax} degrees flexed`
    : "Configured per exercise";

  return (
    <div className="preview-layout">
      <section className="preview-main">
        <button type="button" className="ghost-button" onClick={onBack}>
          <ArrowLeft size={17} /> Exercises
        </button>
        <div>
          <p className="eyebrow">Exercise preview</p>
          <h2>{exercise.name}</h2>
          <p>{exercise.description}</p>
        </div>

        <div className="clinical-note">
          <p className="eyebrow">Clinical framing</p>
          <p>{exercise.clinicalFraming}</p>
        </div>

        <div className="instruction-list">
          <InstructionStep title="Setup" text={exercise.setupCue} />
          {exercise.instructions.map((instruction, index) => (
            <InstructionStep key={instruction} title={`Step ${String(index + 1).padStart(2, "0")}`} text={instruction} />
          ))}
        </div>

        <div className="preview-facts">
          <Fact icon={Target} label="Target angle range" value={targetRange} />
          <Fact icon={CheckCircle2} label="Rep goal" value={`${exercise.repGoal} controlled reps`} />
          <Fact icon={Camera} label="Tracking" value="Live Webcam Analysis" />
        </div>

        <button type="button" className="primary-wide" onClick={onBegin}>
          <Play size={18} /> Begin Session
        </button>
      </section>

      <aside className="movement-preview">
        <ExerciseMovementDiagram exerciseId={exercise.id} />
        <div>
          <p className="eyebrow">Ideal movement preview</p>
          <h3>Extend, bend, hold, straighten.</h3>
          <p>This clinical diagram is instructional only. Live analysis still comes from webcam landmarks.</p>
        </div>
      </aside>
    </div>
  );
}

function InstructionStep({ title, text }) {
  return (
    <article>
      <strong>{title}</strong>
      <p>{text}</p>
    </article>
  );
}

function Fact({ icon: Icon, label, value }) {
  return (
    <article className="fact-card">
      <Icon size={18} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}
