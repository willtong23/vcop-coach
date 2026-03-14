/**
 * SectionCheckCard — Section-level feedback card with blue border treatment.
 */

export default function SectionCheckCard({
  sectionName,
  sectionColour,
  feedback,
  onRevise,
  onContinue,
  isLastSection,
}) {
  if (!feedback) return null;

  return (
    <div className="section-check-card">
      <div className="section-check-header">
        <span className="section-check-badge" style={{ backgroundColor: sectionColour || "#3498db" }}>
          {sectionName} Review
        </span>
      </div>
      <p className="section-check-feedback">{feedback.sectionFeedback}</p>
      {feedback.focusSentence !== null && feedback.focusSentence !== undefined && (
        <p className="section-check-focus">
          Take another look at sentence {feedback.focusSentence + 1}.
        </p>
      )}
      <div className="section-check-actions">
        <button
          type="button"
          className="section-check-btn section-check-btn-revise"
          onClick={onRevise}
        >
          Revise a sentence
        </button>
        <button
          type="button"
          className="section-check-btn section-check-btn-continue"
          onClick={onContinue}
        >
          {isLastSection ? "Finish my story!" : "Move to next section"}
        </button>
      </div>
    </div>
  );
}
