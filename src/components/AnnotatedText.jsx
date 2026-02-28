const VCOP_EMOJIS = { V: "📚", C: "🔗", O: "✨", P: "🎯" };
const VCOP_LABELS = { V: "Vocabulary", C: "Connectives", O: "Openers", P: "Punctuation" };
const VCOP_COLORS = { V: "#8B5CF6", C: "#3B82F6", O: "#10B981", P: "#F59E0B" };
const VCOP_BG = { V: "#ede9fe", C: "#dbeafe", O: "#d1fae5", P: "#fef3c7" };
const DIM_ORDER = { V: 0, C: 1, O: 2, P: 3 };

/**
 * Clean up the suggestion in case AI returned "wrong → right" format.
 */
function cleanSuggestion(suggestion, phrase) {
  if (!suggestion) return phrase;
  if (suggestion.includes("→")) {
    const parts = suggestion.split("→");
    return parts[parts.length - 1].trim();
  }
  return suggestion.trim();
}

export default function AnnotatedText({ text, annotations, changedWords, isFinalized, hiddenDimensions }) {
  if (!annotations || annotations.length === 0) {
    if (changedWords && changedWords.size > 0) {
      return <p className="annotated-text">{renderWithChangedWords(text, changedWords)}</p>;
    }
    return <p className="annotated-text">{text}</p>;
  }

  // Filter annotations based on 10 toggles
  const hidden = hiddenDimensions || new Set();
  const visibleAnnotations = annotations.filter((a) => {
    if (a.type === "revision_good") return true;
    if (a.type === "spelling") return !hidden.has("spelling");
    if (a.type === "grammar") return !hidden.has("grammar");
    if (a.type === "american_spelling") return !hidden.has("spelling");
    if (a.type === "revision_retry") {
      if (a.originalType === "spelling") return !hidden.has("spelling");
      if (a.originalType === "grammar") return !hidden.has("grammar");
      if (a.dimension) return !hidden.has(`${a.dimension}_suggestion`);
      return true;
    }
    if (a.type === "praise" && a.dimension) return !hidden.has(`${a.dimension}_praise`);
    if (a.type === "suggestion" && a.dimension) return !hidden.has(`${a.dimension}_suggestion`);
    return true;
  });

  // Find each annotation's phrase position in the text
  const located = visibleAnnotations
    .map((a) => {
      const idx = text.toLowerCase().indexOf(a.phrase.toLowerCase());
      return { ...a, idx };
    })
    .filter((a) => a.idx !== -1)
    .sort((a, b) => a.idx - b.idx);

  // Remove overlapping annotations (keep earlier ones)
  const filtered = [];
  let lastEnd = 0;
  for (const a of located) {
    if (a.idx >= lastEnd) {
      filtered.push(a);
      lastEnd = a.idx + a.phrase.length;
    }
  }

  // === INLINE TEXT with highlights only (no note boxes) ===
  const segments = [];
  let key = 0;
  let pos = 0;

  for (const ann of filtered) {
    if (ann.idx > pos) {
      const before = text.slice(pos, ann.idx);
      segments.push(
        <span key={key++}>
          {changedWords ? renderWithChangedWords(before, changedWords, getWordOffset(text, pos)) : before}
        </span>
      );
    }

    const phraseText = text.slice(ann.idx, ann.idx + ann.phrase.length);

    if (ann.type === "praise") {
      segments.push(<span key={key++} className="ann-praise">{phraseText}</span>);
    } else if (ann.type === "spelling" || (ann.type === "revision_retry" && ann.originalType === "spelling")) {
      if (isFinalized && ann.fixed) {
        segments.push(
          <span key={key++} className="ann-fixed-wrap">
            <span className="ann-fixed">{phraseText}</span>
            <span className="ann-fixed-badge">✅</span>
          </span>
        );
      } else {
        segments.push(<span key={key++} className="ann-error-text">{phraseText}</span>);
      }
    } else if (ann.type === "grammar" || (ann.type === "revision_retry" && ann.originalType === "grammar")) {
      if (isFinalized && ann.fixed) {
        segments.push(
          <span key={key++} className="ann-fixed-wrap">
            <span className="ann-fixed">{phraseText}</span>
            <span className="ann-fixed-badge">✅</span>
          </span>
        );
      } else {
        segments.push(<span key={key++} className="ann-grammar-text">{phraseText}</span>);
      }
    } else if (ann.type === "american_spelling") {
      segments.push(<span key={key++} className="ann-american-text">{phraseText}</span>);
    } else if (ann.type === "suggestion" || (ann.type === "revision_retry" && !["spelling", "grammar"].includes(ann.originalType))) {
      if (isFinalized && ann.fixed) {
        segments.push(
          <span key={key++} className="ann-fixed-wrap">
            <span className="ann-fixed">{phraseText}</span>
            <span className="ann-fixed-badge">✅</span>
          </span>
        );
      } else {
        segments.push(<span key={key++} className="ann-suggestion-text-inline">{phraseText}</span>);
      }
    } else if (ann.type === "revision_good") {
      segments.push(
        <span key={key++} className="ann-fixed-wrap">
          <span className="ann-fixed">{phraseText}</span>
          <span className="ann-fixed-badge">✅</span>
        </span>
      );
    } else {
      segments.push(<span key={key++}>{phraseText}</span>);
    }

    pos = ann.idx + ann.phrase.length;
  }

  if (pos < text.length) {
    const remaining = text.slice(pos);
    segments.push(
      <span key={key++}>
        {changedWords ? renderWithChangedWords(remaining, changedWords, getWordOffset(text, pos)) : remaining}
      </span>
    );
  }

  // === GROUPED FEEDBACK CARDS below text ===
  const sortByDim = (a, b) => (DIM_ORDER[a.dimension] ?? 99) - (DIM_ORDER[b.dimension] ?? 99);

  const praiseAnns = filtered.filter(a => a.type === "praise").sort(sortByDim);
  const suggestionAnns = filtered.filter(a => a.type === "suggestion" || (a.type === "revision_retry" && !["spelling", "grammar"].includes(a.originalType))).sort(sortByDim);
  const errorAnns = filtered.filter(a =>
    a.type === "spelling" || a.type === "grammar" || a.type === "american_spelling" ||
    (a.type === "revision_retry" && ["spelling", "grammar"].includes(a.originalType))
  );
  const revisionGoodAnns = filtered.filter(a => a.type === "revision_good");

  const hasFeedbackCards = praiseAnns.length > 0 || suggestionAnns.length > 0 || errorAnns.length > 0 || revisionGoodAnns.length > 0;

  return (
    <div className="annotated-text-container">
      <p className="annotated-text">{segments}</p>

      {hasFeedbackCards && (
        <div className="feedback-cards">
          {/* Revision good */}
          {revisionGoodAnns.length > 0 && (
            <div className="feedback-group feedback-group-fixed">
              <div className="feedback-group-header">
                <span className="feedback-group-icon">✅</span> You fixed these!
              </div>
              {revisionGoodAnns.map((a, i) => (
                <div key={`rg-${i}`} className="feedback-card feedback-card-fixed">
                  <span className="feedback-card-phrase">"{text.slice(a.idx, a.idx + a.phrase.length)}"</span>
                </div>
              ))}
            </div>
          )}

          {/* Praises: V → C → O → P */}
          {praiseAnns.length > 0 && (
            <div className="feedback-group feedback-group-praise">
              <div className="feedback-group-header">
                <span className="feedback-group-icon">🟢</span> What you did well
              </div>
              {praiseAnns.map((a, i) => {
                const dimEmoji = a.dimension ? VCOP_EMOJIS[a.dimension] : "";
                const dimLabel = a.dimension ? VCOP_LABELS[a.dimension] : "";
                const dimColor = a.dimension ? VCOP_COLORS[a.dimension] : "#666";
                const dimBg = a.dimension ? VCOP_BG[a.dimension] : "#f1f5f9";
                return (
                  <div key={`p-${i}`} className="feedback-card feedback-card-praise">
                    <span className="ann-vcop-pill" style={{ background: dimBg, color: dimColor, borderColor: dimColor }}>
                      {dimEmoji} {dimLabel}
                    </span>
                    <span className="feedback-card-phrase">"{text.slice(a.idx, a.idx + a.phrase.length)}"</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Suggestions: V → C → O → P */}
          {suggestionAnns.length > 0 && (
            <div className="feedback-group feedback-group-suggestion">
              <div className="feedback-group-header">
                <span className="feedback-group-icon">💡</span> What to try next
              </div>
              {suggestionAnns.map((a, i) => {
                const dimEmoji = a.dimension ? VCOP_EMOJIS[a.dimension] : "";
                const dimLabel = a.dimension ? VCOP_LABELS[a.dimension] : "";
                const dimColor = a.dimension ? VCOP_COLORS[a.dimension] : "#666";
                const dimBg = a.dimension ? VCOP_BG[a.dimension] : "#f1f5f9";
                return (
                  <div key={`s-${i}`} className="feedback-card feedback-card-suggestion">
                    <span className="ann-vcop-pill" style={{ background: dimBg, color: dimColor, borderColor: dimColor }}>
                      {dimEmoji} {dimLabel}
                    </span>
                    <span className="feedback-card-phrase">"{text.slice(a.idx, a.idx + a.phrase.length)}"</span>
                    {a.suggestion && <span className="feedback-card-tip">💡 {a.suggestion}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Spelling & Grammar */}
          {errorAnns.length > 0 && (
            <div className="feedback-group feedback-group-errors">
              <div className="feedback-group-header">
                <span className="feedback-group-icon">✏️</span> Spelling & Grammar
              </div>
              {errorAnns.map((a, i) => {
                const phraseText = text.slice(a.idx, a.idx + a.phrase.length);
                const actualType = a.type === "revision_retry" ? a.originalType : a.type;
                if (actualType === "american_spelling") {
                  return (
                    <div key={`e-${i}`} className="feedback-card feedback-card-american">
                      <span className="feedback-card-icon">🟣</span>
                      <span className="feedback-card-phrase">"{phraseText}"</span>
                      <span className="feedback-card-tip">is American spelling — in British English we write '{a.suggestion}'</span>
                    </div>
                  );
                }
                const isSpelling = actualType === "spelling";
                const suggestion = a.suggestion ? cleanSuggestion(a.suggestion, phraseText) : null;
                return (
                  <div key={`e-${i}`} className={`feedback-card ${isSpelling ? "feedback-card-spelling" : "feedback-card-grammar"}`}>
                    <span className="feedback-card-icon">{isSpelling ? "🔴" : "🟠"}</span>
                    <span className="feedback-card-phrase">"{phraseText}"</span>
                    {suggestion && <span className="feedback-card-arrow">→</span>}
                    {suggestion && <span className="feedback-card-correction">{suggestion}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getWordOffset(text, pos) {
  const before = text.slice(0, pos);
  const words = before.split(/\s+/).filter(Boolean);
  return words.length;
}

function renderWithChangedWords(textSlice, changedWords, startWordOffset = 0) {
  if (!changedWords || changedWords.size === 0) return textSlice;

  const tokens = textSlice.split(/(\s+)/);
  let wordIdx = startWordOffset;
  const result = [];

  tokens.forEach((token, i) => {
    if (/^\s+$/.test(token)) {
      result.push(token);
    } else if (token) {
      if (changedWords.has(wordIdx)) {
        result.push(
          <span key={`cw-${wordIdx}`} className="ann-revised">
            {token}
          </span>
        );
      } else {
        result.push(token);
      }
      wordIdx++;
    }
  });

  return result;
}

export function FeedbackLegend({ isRevision, isFinalized }) {
  if (isFinalized) {
    return (
      <div className="feedback-legend">
        <div className="legend-row">
          <span className="legend-sample-fixed">Green text ✅</span>
          <span className="legend-label">= You fixed this!</span>
        </div>
        <div className="legend-row">
          <span className="legend-sample-error">Red underlined</span>
          <span className="legend-label">= Still needs fixing</span>
        </div>
        <div className="legend-row">
          <span className="legend-sample-note">💡 Grey box</span>
          <span className="legend-label">= AI suggestion</span>
        </div>
      </div>
    );
  }

  return (
    <div className="feedback-legend">
      <div className="legend-row">
        <span className="legend-sample-praise">Green text</span>
        <span className="legend-label">= Well done! 🟢</span>
      </div>
      <div className="legend-row">
        <span className="legend-sample-error">Red underlined</span>
        <span className="legend-label">= Spelling error 🔴</span>
      </div>
      <div className="legend-row">
        <span className="legend-sample-grammar">Orange underlined</span>
        <span className="legend-label">= Grammar error 🟠</span>
      </div>
      <div className="legend-row">
        <span className="legend-sample-american">Purple dotted</span>
        <span className="legend-label">= American spelling (not an error) 🟣</span>
      </div>
      <div className="legend-row">
        <span className="legend-sample-suggestion">Blue text</span>
        <span className="legend-label">= VCOP suggestion (could be better) 💡</span>
      </div>
      {isRevision && (
        <div className="legend-row">
          <span className="legend-sample-fixed">Green text ✅</span>
          <span className="legend-label">= You fixed this!</span>
        </div>
      )}
      <div className="legend-divider" />
      <div className="legend-row">
        <span className="legend-label" style={{ marginLeft: 0 }}>
          📚 V&nbsp;&nbsp;🔗 C&nbsp;&nbsp;✨ O&nbsp;&nbsp;🎯 P
        </span>
      </div>
    </div>
  );
}

const VCOP_TOGGLE_GROUPS = [
  { dim: "V", label: "Vocabulary", color: "#8B5CF6" },
  { dim: "C", label: "Connectives", color: "#3B82F6" },
  { dim: "O", label: "Openers", color: "#10B981" },
  { dim: "P", label: "Punctuation", color: "#F59E0B" },
];

const ERROR_TOGGLES = [
  { key: "spelling", label: "Spelling", color: "#DC2626" },
  { key: "grammar", label: "Grammar", color: "#92400e" },
];

export function VcopFilterBar({ hiddenDimensions, onToggle, compact }) {
  return (
    <div className={`vcop-inline-filter ${compact ? "vcop-inline-filter-compact" : ""}`}>
      {VCOP_TOGGLE_GROUPS.map((g) => (
        <span key={g.dim} className="vcop-toggle-pair">
          <button
            className={`vcop-inline-filter-btn ${!hiddenDimensions.has(`${g.dim}_praise`) ? "active" : ""} ${compact ? "vcop-btn-compact" : ""}`}
            style={{ "--btn-color": g.color }}
            onClick={() => onToggle(`${g.dim}_praise`)}
            title={!hiddenDimensions.has(`${g.dim}_praise`) ? `Hide ${g.label} praise` : `Show ${g.label} praise`}
          >
            {compact ? g.dim : g.label} ✅
          </button>
          <button
            className={`vcop-inline-filter-btn ${!hiddenDimensions.has(`${g.dim}_suggestion`) ? "active" : ""} ${compact ? "vcop-btn-compact" : ""}`}
            style={{ "--btn-color": g.color }}
            onClick={() => onToggle(`${g.dim}_suggestion`)}
            title={!hiddenDimensions.has(`${g.dim}_suggestion`) ? `Hide ${g.label} suggestions` : `Show ${g.label} suggestions`}
          >
            {compact ? g.dim : g.label} 💡
          </button>
        </span>
      ))}
      {ERROR_TOGGLES.map((t) => (
        <button
          key={t.key}
          className={`vcop-inline-filter-btn ${!hiddenDimensions.has(t.key) ? "active" : ""} ${compact ? "vcop-btn-compact" : ""}`}
          style={{ "--btn-color": t.color }}
          onClick={() => onToggle(t.key)}
          title={!hiddenDimensions.has(t.key) ? `Hide ${t.label}` : `Show ${t.label}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
