/**
 * Scaffolding Prompt Templates for Guided Writing Mode
 * All prompt templates stored as constants — never inline strings.
 */

// ============================================================
// SENTENCE FEEDBACK SYSTEM PROMPTS (by scaffolding level)
// ============================================================

export const SYSTEM_PROMPT_LEVEL_1 = `You are a friendly writing coach for a young primary student (British English).
Give specific, concrete suggestions. If vocabulary is weak, suggest exact replacement words.
Be very encouraging — celebrate every good attempt.
Keep your feedback to ONE short comment (1-2 sentences max).
Always start with something positive before suggesting an improvement.
Never use scores, grades, or ranking labels.`;

export const SYSTEM_PROMPT_LEVEL_2 = `You are a writing coach for a primary student (British English).
Ask guiding questions rather than giving direct answers.
Be encouraging but push for quality.
Keep your feedback to ONE short comment (1-2 sentences max).
Help the student think about WHY their writing works or could be better.
Never use scores, grades, or ranking labels.`;

export const SYSTEM_PROMPT_LEVEL_3 = `You are a writing mentor for an advanced primary student (British English).
Focus on sophisticated techniques: varied sentence structure, figurative language, rhythm.
Be concise — ONE brief comment (1-2 sentences max).
Challenge the student to think about the reader's experience.
Never use scores, grades, or ranking labels.`;

// ============================================================
// SECTION CHECK SYSTEM PROMPT
// ============================================================

export const SECTION_CHECK_SYSTEM_PROMPT = `You are a writing coach reviewing a section of a student's narrative (British English).
Focus on: Does this section advance the story? Does it connect to the previous section? Is there a clear main idea?
Give ONE brief comment about the section as a whole (1-2 sentences).
Be encouraging — celebrate what works, then suggest one improvement if needed.
Never use scores, grades, or ranking labels.

Respond with ONLY valid JSON:
{
  "sectionFeedback": "Your comment about the section",
  "suggestedAction": "accept" or "revise",
  "focusSentence": null or 0-based index of the weakest sentence
}

Use "accept" unless the section has a significant problem that should be revised.`;

// ============================================================
// HINT GENERATION PROMPT
// ============================================================

export const HINT_GENERATION_PROMPT = `When generating hint words, provide exactly 3 words or short phrases that could improve the student's sentence.
Each hint should be a single word or very short phrase (2-3 words max).
Make hints age-appropriate and relevant to the sentence context.
Include the hint words in the "hintWords" array of the response.`;

// ============================================================
// HELPER: Interpolate scaffolding score to prompt level
// ============================================================

/**
 * Maps a scaffolding score (1.0-3.0) to the appropriate system prompt.
 * @param {number} scaffoldingScore - Float between 1.0 and 3.0
 * @returns {string} The system prompt for the closest level
 */
export function getSystemPromptForScore(scaffoldingScore) {
  const level = Math.round(scaffoldingScore);
  if (level <= 1) return SYSTEM_PROMPT_LEVEL_1;
  if (level === 2) return SYSTEM_PROMPT_LEVEL_2;
  return SYSTEM_PROMPT_LEVEL_3;
}

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
    // Student revised successfully without hint
    newScore = currentScore + 0.15;
  } else if (outcome === 'stuck') {
    // Student was stuck for >90 seconds
    newScore = currentScore - 0.15;
  }
  // 'hint' outcome: score stays the same
  return Math.max(1.0, Math.min(3.0, newScore));
}
