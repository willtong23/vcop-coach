import { useRef, useCallback, useEffect } from "react";

/**
 * HighlightedEditor — textarea with coloured highlight backdrop.
 *
 * Technique: a backdrop <div> renders the same text with <mark> spans,
 * positioned exactly behind a transparent <textarea>.  Both share identical
 * font metrics so highlights align perfectly.  When the student edits a
 * highlighted phrase away, the highlight disappears automatically because
 * the phrase no longer matches.
 *
 * Props:
 *  - scrollRef: external ref attached to the textarea (for parent scroll sync)
 *  - onSyncScroll: callback when this textarea scrolls (for parent scroll sync)
 */
export default function HighlightedEditor({ value, onChange, annotations, hiddenDimensions, scrollRef, onSyncScroll }) {
  const internalRef = useRef(null);
  const backdropRef = useRef(null);

  // Use external ref if provided, otherwise internal
  const textareaRef = scrollRef || internalRef;

  // Sync backdrop to textarea scroll
  const handleScroll = useCallback(() => {
    if (backdropRef.current && textareaRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
    // Notify parent for cross-panel sync
    if (onSyncScroll) onSyncScroll();
  }, [textareaRef, onSyncScroll]);

  // Also sync on value change (content may resize)
  useEffect(() => {
    handleScroll();
  }, [value, handleScroll]);

  // Build highlighted HTML from current text + annotations
  const highlightedContent = buildHighlights(value, annotations, hiddenDimensions);

  return (
    <div className="hl-editor">
      <div className="hl-backdrop" ref={backdropRef} aria-hidden="true">
        <div className="hl-backdrop-content">{highlightedContent}</div>
      </div>
      <textarea
        ref={textareaRef}
        className="hl-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        placeholder="Edit your writing here..."
      />
    </div>
  );
}

function buildHighlights(text, annotations, hiddenDimensions) {
  if (!text || !annotations || annotations.length === 0) {
    // Need trailing newline so backdrop height matches textarea
    return text + "\n";
  }

  const hidden = hiddenDimensions || new Set();

  // Filter to only error/suggestion types that are visible
  const relevant = annotations.filter((a) => {
    if (a.type === "spelling") return !hidden.has("spelling");
    if (a.type === "grammar") return !hidden.has("grammar");
    if (a.type === "suggestion") {
      if (a.dimension && hidden.has(a.dimension)) return false;
      return true;
    }
    return false; // praise, revision_good etc. don't need highlights
  });

  // Locate each phrase with EXACT (case-sensitive) match.
  // editText starts as a copy of the original, so all phrases match exactly.
  // Any student edit (even changing case like "i" → "I") breaks the match
  // and the highlight disappears immediately.
  const located = relevant
    .map((a) => {
      const idx = text.indexOf(a.phrase);
      if (idx === -1) return null;
      return { ...a, idx, end: idx + a.phrase.length };
    })
    .filter(Boolean)
    .sort((a, b) => a.idx - b.idx);

  // Remove overlaps
  const filtered = [];
  let lastEnd = 0;
  for (const a of located) {
    if (a.idx >= lastEnd) {
      filtered.push(a);
      lastEnd = a.end;
    }
  }

  if (filtered.length === 0) return text + "\n";

  // Build segments
  const parts = [];
  let pos = 0;

  for (const ann of filtered) {
    if (ann.idx > pos) {
      parts.push(text.slice(pos, ann.idx));
    }

    const cls = (ann.type === "spelling" || ann.type === "grammar")
      ? "hl-mark-error"
      : "hl-mark-suggestion";

    parts.push(
      <mark key={ann.idx} className={cls}>
        {text.slice(ann.idx, ann.end)}
      </mark>
    );

    pos = ann.end;
  }

  if (pos < text.length) {
    parts.push(text.slice(pos));
  }

  // Trailing newline keeps backdrop and textarea heights in sync
  parts.push("\n");
  return parts;
}
