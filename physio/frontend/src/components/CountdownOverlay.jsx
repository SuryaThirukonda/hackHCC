export default function CountdownOverlay({ value, variant = "stage" }) {
  if (!value) return null;

  return (
    <div className={`countdown-overlay countdown-overlay-${variant}`} role="status" aria-live="assertive">
      <div>
        <p className="eyebrow">Get ready</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
