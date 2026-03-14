/**
 * CoachPrompt — The coach's guiding question / feedback display card.
 * Shows the current prompt or AI feedback with appropriate styling.
 */

export default function CoachPrompt({ prompt, feedback, isLoading, sectionName, sectionColour }) {
  if (isLoading) {
    return (
      <div className="coach-prompt coach-prompt-loading">
        <div className="coach-prompt-icon">
          <span className="analyzing-pencil" style={{ fontSize: "28px" }}>&#9998;</span>
        </div>
        <p className="coach-prompt-text" style={{ color: "#64748b" }}>
          Reading your sentence...
        </p>
      </div>
    );
  }

  if (feedback) {
    return (
      <div className="coach-prompt coach-prompt-feedback">
        <div className="coach-prompt-header">
          <span className="coach-prompt-badge" style={{ backgroundColor: sectionColour || "#3498db" }}>
            {sectionName || "Coach"}
          </span>
        </div>
        <p className="coach-prompt-text">{feedback.feedback}</p>
        {feedback.spellingCorrection && (
          <div className="coach-correction coach-correction-spelling">
            <span className="coach-correction-label">Spelling:</span>{" "}
            <span className="coach-correction-wrong">{feedback.spellingCorrection.wrong}</span>
            {" → "}
            <span className="coach-correction-right">{feedback.spellingCorrection.right}</span>
          </div>
        )}
        {feedback.grammarCorrection && (
          <div className="coach-correction coach-correction-grammar">
            <span className="coach-correction-label">Grammar:</span>{" "}
            <span className="coach-correction-wrong">{feedback.grammarCorrection.wrong}</span>
            {" → "}
            <span className="coach-correction-right">{feedback.grammarCorrection.right}</span>
          </div>
        )}
        {feedback.encouragement && (
          <p className="coach-encouragement">{feedback.encouragement}</p>
        )}
      </div>
    );
  }

  return (
    <div className="coach-prompt">
      <div className="coach-prompt-header">
        <span className="coach-prompt-badge" style={{ backgroundColor: sectionColour || "#3498db" }}>
          {sectionName || "Coach"}
        </span>
      </div>
      <p className="coach-prompt-text">{prompt}</p>
    </div>
  );
}
