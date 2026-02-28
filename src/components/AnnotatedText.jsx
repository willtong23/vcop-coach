const VCOP_EMOJIS = { V: "📚", C: "🔗", O: "✨", P: "🎯" };
const VCOP_LABELS = { V: "Vocabulary", C: "Connectives", O: "Openers", P: "Punctuation" };
const VCOP_COLORS = { V: "#8B5CF6", C: "#3B82F6", O: "#10B981", P: "#F59E0B" };
const VCOP_BG = { V: "#ede9fe", C: "#dbeafe", O: "#d1fae5", P: "#fef3c7" };

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

  // Filter annotations based on 6 toggles: V, C, O, P, spelling, grammar
  const hidden = hiddenDimensions || new Set();
  const visibleAnnotations = annotations.filter((a) => {
    // revision_good always shown
    if (a.type === "revision_good") return true;
    // spelling errors — controlled by spelling toggle
    if (a.type === "spelling") return !hidden.has("spelling");
    // grammar errors — controlled by grammar toggle
    if (a.type === "grammar") return !hidden.has("grammar");
    // revision_retry follows original type
    if (a.type === "revision_retry") {
      if (a.originalType === "spelling") return !hidden.has("spelling");
      if (a.originalType === "grammar") return !hidden.has("grammar");
      if (a.dimension && hidden.has(a.dimension)) return false;
      return true;
    }
    // suggestion/praise — controlled by VCOP dimension toggles
    if (a.dimension && hidden.has(a.dimension)) return false;
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

  const segments = [];
  let key = 0;
  let pos = 0;

  for (const ann of filtered) {
    // Plain text before this annotation (always black)
    if (ann.idx > pos) {
      const before = text.slice(pos, ann.idx);
      segments.push(
        <span key={key++}>
          {changedWords ? renderWithChangedWords(before, changedWords, getWordOffset(text, pos)) : before}
        </span>
      );
    }

    const phraseText = text.slice(ann.idx, ann.idx + ann.phrase.length);
    const dimEmoji = ann.dimension ? VCOP_EMOJIS[ann.dimension] : null;
    const dimLabel = ann.dimension ? VCOP_LABELS[ann.dimension] : null;
    const dimColor = ann.dimension ? VCOP_COLORS[ann.dimension] : null;
    const dimBg = ann.dimension ? VCOP_BG[ann.dimension] : null;

    if (ann.type === "praise") {
      // Green text inline + small VCOP pill
      segments.push(
        <span key={key++} className="ann-praise-wrap">
          <span className="ann-praise">{phraseText}</span>
          {dimEmoji && (
            <span className="ann-vcop-pill" style={{ background: dimBg, color: dimColor, borderColor: dimColor }}>
              {dimEmoji} {dimLabel}
            </span>
          )}
        </span>
      );
    } else if (ann.type === "spelling") {
      if (isFinalized && ann.fixed) {
        segments.push(
          <span key={key++} className="ann-fixed-wrap">
            <span className="ann-fixed">{phraseText}</span>
            <span className="ann-fixed-badge">✅</span>
          </span>
        );
      } else if (ann.suggestion) {
        const suggestion = cleanSuggestion(ann.suggestion, phraseText);
        segments.push(
          <span key={key++} className="ann-error-block">
            <span className="ann-error-text">{phraseText}</span>
            <span className="ann-suggestion-note ann-suggestion-note-error">
              <span className="ann-suggestion-icon">🔴</span>
              <span className="ann-suggestion-content">{phraseText} → {suggestion}</span>
            </span>
          </span>
        );
      } else {
        segments.push(
          <span key={key++} className="ann-error-block">
            <span className="ann-error-text">{phraseText}</span>
          </span>
        );
      }
    } else if (ann.type === "grammar") {
      if (isFinalized && ann.fixed) {
        segments.push(
          <span key={key++} className="ann-fixed-wrap">
            <span className="ann-fixed">{phraseText}</span>
            <span className="ann-fixed-badge">✅</span>
          </span>
        );
      } else if (ann.suggestion) {
        const suggestion = cleanSuggestion(ann.suggestion, phraseText);
        segments.push(
          <span key={key++} className="ann-error-block">
            <span className="ann-grammar-text">{phraseText}</span>
            <span className="ann-suggestion-note ann-suggestion-note-grammar">
              <span className="ann-suggestion-icon">🟠</span>
              <span className="ann-suggestion-content">{phraseText} → {suggestion}</span>
            </span>
          </span>
        );
      } else {
        segments.push(
          <span key={key++} className="ann-error-block">
            <span className="ann-grammar-text">{phraseText}</span>
          </span>
        );
      }
    } else if (ann.type === "suggestion") {
      if (isFinalized && ann.fixed) {
        segments.push(
          <span key={key++} className="ann-fixed-wrap">
            <span className="ann-fixed">{phraseText}</span>
            <span className="ann-fixed-badge">✅</span>
          </span>
        );
      } else {
        segments.push(
          <span key={key++} className="ann-suggestion-block">
            <span>{phraseText}</span>
            <span className="ann-suggestion-note">
              {dimEmoji && (
                <span className="ann-vcop-pill" style={{ background: dimBg, color: dimColor, borderColor: dimColor }}>
                  {dimEmoji} {dimLabel}
                </span>
              )}
              <span className="ann-suggestion-icon">💡</span>
              <span className="ann-suggestion-content">{ann.suggestion || ""}</span>
            </span>
          </span>
        );
      }
    } else if (ann.type === "revision_good") {
      segments.push(
        <span key={key++} className="ann-fixed-wrap">
          <span className="ann-fixed">{phraseText}</span>
          <span className="ann-fixed-badge">✅</span>
        </span>
      );
    } else if (ann.type === "revision_retry") {
      if (ann.originalType === "spelling" && ann.suggestion) {
        const suggestion = cleanSuggestion(ann.suggestion, phraseText);
        segments.push(
          <span key={key++} className="ann-error-block">
            <span className="ann-error-text">{phraseText}</span>
            <span className="ann-suggestion-note ann-suggestion-note-error">
              <span className="ann-suggestion-icon">🔴</span>
              <span className="ann-suggestion-content">{phraseText} → {suggestion}</span>
            </span>
          </span>
        );
      } else if (ann.originalType === "spelling") {
        segments.push(
          <span key={key++} className="ann-error-block">
            <span className="ann-error-text">{phraseText}</span>
          </span>
        );
      } else if (ann.originalType === "grammar" && ann.suggestion) {
        const suggestion = cleanSuggestion(ann.suggestion, phraseText);
        segments.push(
          <span key={key++} className="ann-error-block">
            <span className="ann-grammar-text">{phraseText}</span>
            <span className="ann-suggestion-note ann-suggestion-note-grammar">
              <span className="ann-suggestion-icon">🟠</span>
              <span className="ann-suggestion-content">{phraseText} → {suggestion}</span>
            </span>
          </span>
        );
      } else if (ann.originalType === "grammar") {
        segments.push(
          <span key={key++} className="ann-error-block">
            <span className="ann-grammar-text">{phraseText}</span>
          </span>
        );
      } else {
        segments.push(
          <span key={key++} className="ann-suggestion-block">
            <span>{phraseText}</span>
            <span className="ann-suggestion-note">
              <span className="ann-suggestion-icon">💡</span>
              <span className="ann-suggestion-content">{ann.suggestion || ""}</span>
            </span>
          </span>
        );
      }
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

  return <p className="annotated-text">{segments}</p>;
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
        <span className="legend-sample-suggestion">Blue text</span>
        <span className="legend-label">= VCOP suggestion (could be better) 💡</span>
      </div>
      <div className="legend-row">
        <span className="legend-sample-note">💡 Grey box</span>
        <span className="legend-label">= AI suggestion detail</span>
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

const ALL_TOGGLES = [
  { key: "V", emoji: "📚", label: "V", color: "#8B5CF6" },
  { key: "C", emoji: "🔗", label: "C", color: "#3B82F6" },
  { key: "O", emoji: "✨", label: "O", color: "#10B981" },
  { key: "P", emoji: "🎯", label: "P", color: "#F59E0B" },
  { key: "spelling", emoji: "🔤", label: "Spelling", color: "#DC2626" },
  { key: "grammar", emoji: "📏", label: "Grammar", color: "#92400e" },
];

export function VcopFilterBar({ hiddenDimensions, onToggle, compact }) {
  return (
    <div className={`vcop-inline-filter ${compact ? "vcop-inline-filter-compact" : ""}`}>
      {ALL_TOGGLES.map((t) => (
        <button
          key={t.key}
          className={`vcop-inline-filter-btn ${!hiddenDimensions.has(t.key) ? "active" : ""} ${compact ? "vcop-btn-compact" : ""}`}
          style={{ "--btn-color": t.color }}
          onClick={() => onToggle(t.key)}
          title={!hiddenDimensions.has(t.key) ? `Hide ${t.emoji} ${t.label}` : `Show ${t.emoji} ${t.label}`}
        >
          {t.emoji}{compact ? "" : t.label}
        </button>
      ))}
    </div>
  );
}
