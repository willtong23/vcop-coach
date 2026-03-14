/**
 * VocabHintChips — Clickable hint word chips for vocabulary help.
 */

export default function VocabHintChips({ hintWords, onSelectHint, scaffoldingScore }) {
  if (!hintWords || hintWords.length === 0) return null;

  // Visual prominence based on scaffolding level
  const level = Math.round(scaffoldingScore || 1);

  return (
    <div className={`vocab-hint-chips vocab-hint-level-${level}`}>
      <p className="vocab-hint-label">
        Try one of these words:
      </p>
      <div className="vocab-hint-list">
        {hintWords.map((hint, i) => (
          <button
            key={i}
            type="button"
            className="vocab-hint-chip"
            onClick={() => onSelectHint(hint)}
            title={hint.context || ""}
          >
            {hint.word}
          </button>
        ))}
      </div>
    </div>
  );
}
