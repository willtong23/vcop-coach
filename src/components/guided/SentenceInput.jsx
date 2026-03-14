/**
 * SentenceInput — Single-line input with submit button and sentence starters.
 */
import { useState } from "react";

export default function SentenceInput({
  value,
  onChange,
  onSubmit,
  disabled,
  sentenceStarters,
  placeholder,
}) {
  const [showStarters, setShowStarters] = useState(false);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && value.trim()) {
      e.preventDefault();
      onSubmit();
    }
  };

  const handleStarterClick = (starter) => {
    onChange(starter);
    setShowStarters(false);
  };

  return (
    <div className="sentence-input-container">
      {sentenceStarters && sentenceStarters.length > 0 && (
        <div className="sentence-starters">
          <button
            type="button"
            className="sentence-starters-toggle"
            onClick={() => setShowStarters((prev) => !prev)}
            disabled={disabled}
          >
            {showStarters ? "Hide starters" : "Need a starter?"}
          </button>
          {showStarters && (
            <div className="sentence-starters-chips">
              {sentenceStarters.map((starter, i) => (
                <button
                  key={i}
                  type="button"
                  className="sentence-starter-chip"
                  onClick={() => handleStarterClick(starter)}
                  disabled={disabled}
                >
                  {starter}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="sentence-input-row">
        <input
          type="text"
          className="sentence-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder || "Write your sentence here..."}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoFocus
        />
        <button
          type="button"
          className="sentence-submit-btn"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
        >
          Submit
        </button>
      </div>
    </div>
  );
}
