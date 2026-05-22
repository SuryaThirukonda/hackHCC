export default function MetricCard({ icon: Icon, label, value, unit, accent = "mint" }) {
  return (
    <article className={`metric-card metric-${accent}`}>
      <div className="metric-icon" aria-hidden="true">
        <Icon size={18} strokeWidth={2.2} />
      </div>
      <div>
        <p>{label}</p>
        <strong>
          {value}
          {unit && <span>{unit}</span>}
        </strong>
      </div>
    </article>
  );
}
