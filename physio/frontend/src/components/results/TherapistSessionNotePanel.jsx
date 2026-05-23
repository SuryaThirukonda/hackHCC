import React from "react";
import { ClipboardList } from "lucide-react";

export default function TherapistSessionNotePanel({ note, status = "idle", error = "" }) {
  if (!note && status === "idle") return null;

  const fields = note ? [
    { label: "Exercise", value: note.exercise },
    { label: "Completed", value: note.completed },
    { label: "Movement Quality", value: note.movement_quality },
    { label: "Main Issue", value: note.main_issue },
    { label: "Sensor/Tracking Quality", value: note.sensor_tracking_quality },
    { label: "Patient Feedback", value: note.patient_feedback },
    { label: "Next Focus", value: note.next_focus },
    { label: "Safety Note", value: note.safety_note }
  ] : [];

  return (
    <section className="therapist-note-panel">
      <div className="therapist-note-header">
        <ClipboardList size={18} />
        <div>
          <p className="eyebrow">Session note</p>
          <h2>Therapist-style session note</h2>
        </div>
        {status === "loading" && <span className="coach-blob-status">Generating note…</span>}
      </div>

      {status === "error" && error && (
        <p className="muted-sub">{error}</p>
      )}

      {note && (
        <dl className="therapist-note-grid">
          {fields.map(({ label, value }) => (
            <div key={label} className="therapist-note-row">
              <dt>{label}</dt>
              <dd>{value || "—"}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
