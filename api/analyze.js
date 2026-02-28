import Anthropic from "@anthropic-ai/sdk";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./_firebase.js";

const client = new Anthropic();

const VCOP_EMOJIS = { V: "📚", C: "🔗", O: "✨", P: "🎯" };

const YEAR_GROUP_MAP = {
  "19": { year: 6, label: "Y6" },
  "20": { year: 5, label: "Y5" },
  "21": { year: 4, label: "Y4" },
};

function getActualYear(studentId) {
  if (!studentId) return null;
  const prefix = studentId.slice(0, 2);
  return YEAR_GROUP_MAP[prefix] || null;
}

function buildSystemPrompt(vcopFocus, topic, extraInstructions, feedbackMode, iterationNumber, previousText, previousAnnotations, studentId, feedbackDepth) {
  const dimensions = (vcopFocus && vcopFocus.length > 0 ? vcopFocus : ["V", "C", "O", "P"]);

  const dimensionDescriptions = {
    V: "Vocabulary — interesting/ambitious word choices",
    C: "Connectives — words that join ideas (because, however, furthermore, although...)",
    O: "Openers — how sentences begin (time openers, -ing openers, adverb openers...)",
    P: "Punctuation — correct and varied punctuation use",
  };

  const focusList = dimensions
    .map((d) => `- ${dimensionDescriptions[d]}`)
    .join("\n");

  const depth = feedbackDepth || 2;
  const dimCount = dimensions.length;
  const isRevision = iterationNumber > 1 && previousText;

  // For revision (v2), we DON'T find new problems — only check what was fixed
  if (isRevision) {
    const prevAnnotationsJson = previousAnnotations ? JSON.stringify(previousAnnotations) : "[]";

    return `You are a warm, encouraging English teacher for primary school students (ages 7-11). The student has revised their writing. Your ONLY job is to check which of the ORIGINAL suggestions they fixed.

PREVIOUS VERSION:
"""
${previousText}
"""

ORIGINAL FEEDBACK (from v1):
${prevAnnotationsJson}

RULES FOR REVISION EVALUATION:
1. Go through EACH annotation from the original feedback that was type "spelling", "grammar", or "suggestion".
2. For each one, check if the student fixed it in their new version.
3. If FIXED: output type "revision_good" with phrase = the NEW corrected text from their revision.
4. If NOT FIXED (still the same problem): output the ORIGINAL annotation exactly as it was (same type, phrase, suggestion, dimension).
5. Keep any "praise" annotations that still apply to the new text.
6. Do NOT find any NEW problems. Do NOT add new spelling, grammar, or suggestion annotations that weren't in the original feedback.
7. The "phrase" field MUST match EXACT text from the student's NEW writing.

You MUST respond with ONLY valid JSON in this exact format, no other text:
{
  "annotations": [
    { "phrase": "corrected text in new version", "type": "revision_good" },
    { "phrase": "unchanged misspelled word", "suggestion": "correct spelling", "type": "spelling" },
    { "phrase": "unchanged grammar error", "suggestion": "corrected grammar", "type": "grammar" },
    { "phrase": "unchanged text", "suggestion": "Try this...", "type": "suggestion", "dimension": "V" },
    { "phrase": "good text", "type": "praise", "dimension": "C" }
  ]
}`;
  }

  // First version prompt — depth controls how much feedback, but ALL dimensions must be covered
  let feedbackDepthRule = "";
  if (depth <= 2) {
    feedbackDepthRule = `7. FEEDBACK DEPTH (Light): Keep feedback focused. Flag genuine spelling/grammar errors (max 3). For each VCOP dimension, give one short suggestion OR one praise — keep it simple. Total annotations: ${Math.max(dimCount + 2, 5)}-${dimCount + 5}.`;
  } else if (depth === 3) {
    feedbackDepthRule = `7. FEEDBACK DEPTH (Standard): Give a balanced mix of praise, spelling fixes, and VCOP suggestions. For each VCOP dimension, give 1-2 annotations. Total annotations: ${Math.max(dimCount * 2, 6)}-10.`;
  } else {
    feedbackDepthRule = `7. FEEDBACK DEPTH (Detailed): Give thorough, in-depth feedback. For each VCOP dimension, give 2-3 annotations with specific examples and explanations. Include more suggestions than praise. Total annotations: ${Math.max(dimCount * 2 + 2, 8)}-14.`;
  }

  // Year-level-specific expectations
  const actualYear = getActualYear(studentId);
  let yearExpectations = "";
  if (actualYear) {
    const yearRules = {
      4: "This is a Y4 student. Focus on: basic sentence structure, correct full stops and capital letters, simple connectives (and, but, because, so). Praise even small wins.",
      5: "This is a Y5 student. Focus on: paragraph organisation, varied sentence openers (time, -ing, adverb), expanding vocabulary. Expect more than Y4 but don't demand Y6 complexity.",
      6: "This is a Y6 student. Focus on: tone control, complex sentence structures (relative clauses, subordinate clauses), precise and varied vocabulary, advanced punctuation (semicolons, colons, dashes).",
    };
    yearExpectations = yearRules[actualYear.year] || "";
  }

  const minAnnotations = depth <= 2 ? Math.max(dimCount + 2, 5) : depth === 3 ? Math.max(dimCount * 2, 6) : Math.max(dimCount * 2 + 2, 8);

  let prompt = `You are a warm, encouraging English teacher for primary school students (ages 7-11). You analyse student writing using selected dimensions from the VCOP framework and return inline annotations.

TODAY'S FOCUS DIMENSIONS:
${focusList}

${yearExpectations ? `STUDENT LEVEL CONTEXT:\n${yearExpectations}\n` : ""}
${topic ? `WRITING TOPIC: ${topic}\nUse this topic context when evaluating the writing.\n` : ""}
${extraInstructions ? `ADDITIONAL TEACHER INSTRUCTIONS: ${extraInstructions}\n` : ""}
ANNOTATION TYPES (show ALL feedback at once, not in batches):

1. "spelling" — ONLY actual spelling mistakes (wrong letters, misspelled words). Shown in red.
   - "phrase" = the EXACT misspelled word from the student's writing
   - "suggestion" = the correctly spelled word (just the fixed text, NOT "wrong → right" format)
   - Examples of SPELLING errors:
     * Misspelling: phrase "becuase", suggestion "because"
     * Misspelling: phrase "climp", suggestion "climb"
     * Misspelling: phrase "ther", suggestion "their"
     * Misspelling: phrase "freind", suggestion "friend"
   - This type is ONLY for words that are not real English words (misspelled). Do NOT put grammar errors here.
   - Maximum 3 spelling annotations. Pick the most important ones.

2. "grammar" — grammar, punctuation, capitalisation, tense, and word choice errors. Shown in orange.
   - "phrase" = the EXACT erroneous text from the student's writing (keep it short — usually one or two words)
   - "suggestion" = the corrected version (just the fixed text, NOT "wrong → right" format)
   - Examples of GRAMMAR errors:
     * Missing plural s: phrase "keep", suggestion "keeps"
     * Missing capital at sentence start: phrase "suddenly", suggestion "Suddenly"
     * Pronoun I: phrase "i", suggestion "I", also "i'm" → "I'm", "i'll" → "I'll"
     * Proper noun: phrase "london", suggestion "London"
     * Wrong word: phrase "and", suggestion "an" (for "like and egg")
     * Wrong tense: phrase "goed", suggestion "went"
     * Subject-verb agreement: phrase "the cat sit", suggestion "the cat sits"
     * Missing article: phrase "went park", suggestion "went to the park"
     * Days/months: phrase "monday", suggestion "Monday"
   - CAPITAL LETTER RULES (check carefully!):
     * Every sentence MUST start with a capital letter.
     * The pronoun "i" must ALWAYS be capitalised to "I".
     * Proper nouns must be capitalised: days, months, places, names.
     * Check EVERY sentence beginning in the entire text.
   - CRITICAL: Keep "phrase" as SHORT as possible — usually just ONE wrong word.
   - NEVER say vague things like "check your grammar". Always provide the exact corrected text.
   - Maximum 3 grammar annotations. Pick the most important ones.

3. "suggestion" — VCOP improvement ideas (student can choose to fix or not).
   - "phrase" = exact text from writing (the specific words you're commenting on)
   - "suggestion" = what to try instead, be specific and give an example
   - "dimension" = one of ${dimensions.join("/")}

4. "praise" — things done well.
   - "phrase" = exact text from writing (the specific words that are good)
   - "dimension" = one of ${dimensions.join("/")}
   - No "suggestion" needed.

RULES:
1. Be encouraging and specific — point out EXACTLY what the student did well with quotes from their writing.
2. NEVER give scores, grades, rankings, or labels like "Great", "Good", "Keep trying".
3. The "phrase" field MUST contain the EXACT text from the student's writing (case-sensitive, character-for-character match). Copy-paste from the student's text. If the phrase you write does not appear exactly in the student's text, the annotation will be thrown away.
4. Keep language simple and friendly — you're talking to a child.
5. ONLY analyse the dimensions listed above. Do NOT include other VCOP dimensions.
6. Maximum 3 "spelling" annotations AND maximum 3 "grammar" annotations. Pick the most critical errors in each category.
${feedbackDepthRule}
8. Return ${minAnnotations}-12 annotations total for a good balance of feedback.
9. Show ALL feedback at once. The student will see everything in one go.
10. CRITICAL — NEVER mark a correctly spelled word as a spelling error. Only mark words that are ACTUALLY misspelled or have ACTUAL grammar errors. If a word is spelled correctly, do NOT create a spelling annotation for it. Double-check every spelling annotation before including it.
11. MANDATORY DIMENSION COVERAGE — You MUST provide at least one annotation (either "suggestion" or "praise") for EACH of these enabled dimensions: ${dimensions.map(d => `${VCOP_EMOJIS[d]}${d}`).join(", ")}. If the student did well in a dimension, give praise. If there's room to improve, give a suggestion. No dimension should be left without feedback.

You MUST respond with ONLY valid JSON in this exact format, no other text:
{
  "annotations": [
    { "phrase": "becuase", "suggestion": "because", "type": "spelling" },
    { "phrase": "i", "suggestion": "I", "type": "grammar" },
    { "phrase": "keep", "suggestion": "keeps", "type": "grammar" },
    { "phrase": "exact text from writing", "suggestion": "Try using a more exciting word like...", "type": "suggestion", "dimension": "V" },
    { "phrase": "exact text from writing", "type": "praise", "dimension": "C" }
  ]
}`;

  return prompt;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text, sessionId, studentId, vcopFocus, topic, extraInstructions, feedbackMode, feedbackDepth, submissionId: existingSubmissionId, iterationNumber, previousText, previousAnnotations } = req.body || {};

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "Please provide some writing to analyse." });
  }

  try {
    const currentIteration = iterationNumber || 1;
    const systemPrompt = buildSystemPrompt(vcopFocus, topic, extraInstructions, feedbackMode, currentIteration, previousText, previousAnnotations, studentId, feedbackDepth);

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Please analyse this student's writing:\n\n${text}`,
        },
      ],
    });

    let content = message.content[0].text.trim();
    // Strip markdown code fences if present
    if (content.startsWith("```")) {
      content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(content);
    const rawAnnotations = parsed.annotations || [];

    // Server-side validation: filter out annotations where phrase doesn't exist in text
    const studentText = text.trim();
    const annotations = rawAnnotations.filter((a) => {
      if (!a.phrase || typeof a.phrase !== "string") return false;
      // Check exact match first, then case-insensitive
      const exactMatch = studentText.includes(a.phrase);
      const caseInsensitiveMatch = studentText.toLowerCase().includes(a.phrase.toLowerCase());
      if (!exactMatch && !caseInsensitiveMatch) {
        console.warn(`Filtered out annotation: phrase "${a.phrase}" not found in student text`);
        return false;
      }
      // For spelling/grammar type, verify the suggestion is actually different from the phrase
      if ((a.type === "spelling" || a.type === "grammar") && a.suggestion) {
        const cleanSugg = a.suggestion.includes("→") ? a.suggestion.split("→").pop().trim() : a.suggestion.trim();
        if (cleanSugg.toLowerCase() === a.phrase.toLowerCase() && cleanSugg === a.phrase) {
          console.warn(`Filtered out spelling annotation: suggestion "${a.suggestion}" same as phrase "${a.phrase}"`);
          return false;
        }
      }
      return true;
    });

    // Save to Firestore if session context provided
    let submissionId = existingSubmissionId || null;
    if (sessionId && studentId) {
      const db = getDb();
      const iterationEntry = {
        version: currentIteration,
        text: text.trim(),
        annotations,
        createdAt: new Date().toISOString(),
      };

      if (existingSubmissionId) {
        // Append new iteration to existing doc
        await db.collection("submissions").doc(existingSubmissionId).update({
          iterations: FieldValue.arrayUnion(iterationEntry),
        });
        submissionId = existingSubmissionId;
      } else {
        // Create new doc with first iteration
        const docRef = await db.collection("submissions").add({
          sessionId,
          studentId,
          sessionTopic: topic || null,
          feedbackMode: feedbackMode || "encouragement",
          teacherComment: null,
          createdAt: FieldValue.serverTimestamp(),
          iterations: [iterationEntry],
        });
        submissionId = docRef.id;
      }
    }

    return res.status(200).json({ annotations, submissionId, iterationNumber: currentIteration });
  } catch (err) {
    console.error("Claude API error:", err?.status, err?.message);

    if (err?.status === 401) {
      return res.status(500).json({ error: "API key is missing or invalid. Please check ANTHROPIC_API_KEY." });
    }
    return res.status(500).json({ error: err?.message || "Something went wrong analysing your writing. Please try again." });
  }
}
