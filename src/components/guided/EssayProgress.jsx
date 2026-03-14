/**
 * EssayProgress — "Your Essay So Far" panel
 * Shows completed sentences grouped by section with colour coding.
 */
import { SECTION_COLOURS } from "../../data/genreTemplates";

export default function EssayProgress({ sections, sentences, currentSectionIndex }) {
  return (
    <div className="essay-progress">
      <h3 className="essay-progress-title">Your Essay So Far</h3>
      <div className="essay-progress-sections">
        {sections.map((section, sIdx) => {
          const sectionSentences = sentences[section.id] || [];
          const isCurrent = sIdx === currentSectionIndex;
          const isFuture = sIdx > currentSectionIndex;
          const colour = SECTION_COLOURS[section.id] || "#64748b";

          return (
            <div
              key={section.id}
              className={`essay-progress-section ${isCurrent ? "current" : ""} ${isFuture ? "future" : ""}`}
            >
              <div className="essay-progress-section-label" style={{ color: colour }}>
                <span
                  className="essay-progress-dot"
                  style={{ backgroundColor: colour }}
                />
                {section.name}
              </div>
              {isFuture ? (
                <p className="essay-progress-future">(next...)</p>
              ) : sectionSentences.length > 0 ? (
                <div className="essay-progress-sentences">
                  {sectionSentences.map((s, i) => (
                    <p key={i} className="essay-progress-sentence">{s}</p>
                  ))}
                </div>
              ) : isCurrent ? (
                <p className="essay-progress-writing">Writing...</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
