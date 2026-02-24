export default function FeedbackCard({ data, index }) {
  const { dimension, emoji, color, highlights, suggestion } = data;

  return (
    <div
      className="feedback-card"
      style={{
        borderColor: color,
        animationDelay: `${index * 150}ms`,
      }}
    >
      <div className="card-header" style={{ backgroundColor: `${color}15` }}>
        <span className="card-emoji">{emoji}</span>
        <h2 className="card-title" style={{ color }}>
          {dimension}
        </h2>
      </div>

      {highlights.length > 0 && (
        <div className="card-section">
          <h3 className="section-title">🌟 What you did well</h3>
          <ul className="section-list">
            {highlights.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {suggestion && (
        <div className="card-section">
          <h3 className="section-title">💡 Try this next</h3>
          <p className="suggestion-text">{suggestion}</p>
        </div>
      )}
    </div>
  );
}
