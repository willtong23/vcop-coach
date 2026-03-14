/**
 * Client-side scaffolding score helpers.
 * These mirror the logic in api/_scaffolding-prompts.js but are safe for browser use.
 */

/**
 * Returns the integer scaffolding level (1, 2, or 3) from a float score.
 * @param {number} scaffoldingScore - Float between 1.0 and 3.0
 * @returns {number} 1, 2, or 3
 */
export function getScaffoldingLevel(scaffoldingScore) {
  return Math.max(1, Math.min(3, Math.round(scaffoldingScore)));
}

/**
 * Adjusts scaffolding score based on student performance.
 * @param {number} currentScore - Current scaffolding score
 * @param {'success'|'hint'|'stuck'} outcome - What happened
 * @returns {number} New scaffolding score, clamped to [1.0, 3.0]
 */
export function adjustScaffoldingScore(currentScore, outcome) {
  let newScore = currentScore;
  if (outcome === 'success') {
    newScore = currentScore + 0.15;
  } else if (outcome === 'stuck') {
    newScore = currentScore - 0.15;
  }
  // 'hint' outcome: score stays the same
  return Math.max(1.0, Math.min(3.0, newScore));
}
