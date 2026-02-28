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

function buildSystemPrompt(vcopFocus, topic, extraInstructions, feedbackMode, iterationNumber, previousText, previousAnnotations, studentId, feedbackLevel, pastWritingContext) {
  const dimensions = (vcopFocus && vcopFocus.length > 0 ? vcopFocus : ["V", "C", "O", "P"]);

  const dimensionDescriptions = {
    V: "Vocabulary — interesting/ambitious word choices",
    C: "Connectives — words that join ideas (because, however, furthermore, although...)",
    O: "Openers — how sentences begin. Six types: (1) Adverb opener (-ly words: Silently, Nervously, Suddenly), (2) -ing opener (Running through the forest, Gazing at the stars), (3) Question opener (Have you ever wondered...?), (4) Prepositional phrase opener (Under the bridge, At midnight, During the storm), (5) -ed opener (Exhausted from the journey, Convinced she was right), (6) Short punchy statement (It was over. She knew. Nothing moved.)",
    P: "Punctuation — correct and varied punctuation use",
  };

  const focusList = dimensions
    .map((d) => `- ${dimensionDescriptions[d]}`)
    .join("\n");

  const level = feedbackLevel || 1;
  const dimCount = dimensions.length;
  const actualYear = getActualYear(studentId);
  const baseYear = actualYear ? actualYear.year : 5; // default Y5 if unknown
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

  // Feedback level determines the STANDARD we judge by, not quantity.
  // Level 1 = student's actual year group standard
  // Level 2 = 1-2 years above actual year
  // Level 3 = 3+ years above actual year
  const targetYear = level === 1 ? baseYear : level === 2 ? baseYear + 2 : baseYear + 4;
  const actualYearLabel = actualYear ? actualYear.label : `Y${baseYear}`;

  // Build expectations based on the TARGET year (which depends on level)
  function getYearExpectations(yr) {
    if (yr <= 4) return "Y4 standard: Focus on basic sentence structure, correct full stops and capital letters, simple connectives (and, but, because, so). Praise even small wins. Keep suggestions simple.";
    if (yr === 5) return "Y5 standard: Expect paragraph organisation, varied sentence openers (time, -ing, adverb), expanding vocabulary. More than Y4 but not Y6 complexity.";
    if (yr === 6) return "Y6 standard: Expect tone control, complex sentence structures (relative clauses, subordinate clauses), precise and varied vocabulary, advanced punctuation (semicolons, colons, dashes).";
    if (yr <= 8) return "Y7-8 standard (secondary level): Expect sophisticated vocabulary choices, deliberate rhetorical techniques (rhetorical questions, tricolon, metaphor), paragraph cohesion with discourse markers, varied sentence length for effect, controlled formality shifts, semicolons and colons used correctly for emphasis.";
    return "Y9+ standard (advanced): Expect mastery of tone and register, subtle word connotations, complex multi-clause sentences with embedded clauses, advanced literary devices (juxtaposition, antithesis, anaphora), cohesive argument structure, confident use of all punctuation for stylistic effect.";
  }

  const yearExpectations = `The student is actually ${actualYearLabel} (age ${baseYear + 3}-${baseYear + 4}).
Feedback level: ${level}/3. You are evaluating at ${targetYear <= 6 ? `Y${targetYear}` : `Y${targetYear}`} standard.
${getYearExpectations(targetYear)}
${level >= 2 ? "Because this is above the student's actual year, push them with more ambitious suggestions — ask for more precise vocabulary, more complex sentence structures, and higher-level techniques. But remain encouraging." : "Match suggestions to what is realistic for this year group."}`;

  const minAnnotations = Math.max(dimCount + 2, 5);

  let prompt = `You are a warm, encouraging English teacher for primary school students (ages 7-11). You analyse student writing using selected dimensions from the VCOP framework and return inline annotations.

TODAY'S FOCUS DIMENSIONS:
${focusList}

${yearExpectations ? `STUDENT LEVEL CONTEXT:\n${yearExpectations}\n` : ""}
${topic ? `WRITING TOPIC: ${topic}\nUse this topic context when evaluating the writing.\n` : ""}
${extraInstructions ? `ADDITIONAL TEACHER INSTRUCTIONS: ${extraInstructions}\n` : ""}
${pastWritingContext ? `
STUDENT'S PAST WRITING (use this to personalise your feedback):
${pastWritingContext}

PAST WRITING RULES:
- When giving VCOP suggestions, reference specific examples from the student's past writing when relevant.
  Example: "You used a great -ly opener before: 'Nervously, she opened the letter.' Try one here too!"
  Example: "Last time you used 'meanwhile' as a connective — nice! Can you use another time connective here?"
- If the student did something well before but NOT in this piece, gently remind them using POSITIVE framing:
  Example: "In your last piece you remembered to use commas after your openers — don't forget here!"
- NEVER use negative framing like "you used to be better" or "you've gotten worse".
- Always frame past references as encouragement: "you did this well before, try it again!"
- Only reference past writing in "suggestion" or "praise" annotations, not in spelling/grammar.
- If no past examples are relevant, just give normal feedback — don't force past references.
` : ""}
${dimensions.includes("O") ? `OPENERS DIMENSION — DETAILED ANALYSIS INSTRUCTIONS:
You must analyse sentence openers using these 6 specific types:
1. Adverb opener (-ly words): e.g. "Silently, the cat crept..." / "Nervously, she opened..."
2. -ing opener (action words): e.g. "Running through the forest, he..." / "Gazing at the stars, she..."
3. Question opener: e.g. "Have you ever wondered...?" / "What would you do if...?"
4. Prepositional phrase opener (where/when): e.g. "Under the bridge, ..." / "At midnight, ..." / "During the storm, ..."
5. -ed opener (past participle): e.g. "Exhausted from the journey, he..." / "Convinced she was right, ..."
6. Short punchy statement: e.g. "It was over." / "She knew." / "Nothing moved."

OPENER FEEDBACK RULES:
- PRAISE (type "praise", dimension "O"): When the student uses one of the 6 opener types, praise it and NAME the type. In the suggestion field or as part of what you highlight, say which type it is. Example: praise phrase "Silently, the cat crept" — this is an adverb (-ly) opener.
- SUGGESTION (type "suggestion", dimension "O"): If most sentences start the same way (e.g. all starting with "I" or "The"), pick one sentence and suggest rewriting it with a specific opener type. Give the FULL rewritten example using the student's own words. Example: phrase "The cat crept across the room", suggestion "Try an adverb opener: 'Silently, the cat crept across the room.'"
- Count how many DIFFERENT opener types the student uses. If fewer than 3 types, suggest trying a new type they haven't used yet.
- COMMA RULE: Remind students that -ly openers, -ing openers, prepositional phrase openers, and -ed openers need a COMMA after them. If a student uses one of these openers but forgets the comma, flag it as a grammar annotation.
` : ""}ANNOTATION TYPES (show ALL feedback at once, not in batches):

1. "spelling" — ONLY actual spelling mistakes (wrong letters, misspelled words). Shown in red.
   - "phrase" = the EXACT misspelled word from the student's writing
   - "suggestion" = the correctly spelled word (just the fixed text, NOT "wrong → right" format)
   - Examples of SPELLING errors:
     * Misspelling: phrase "becuase", suggestion "because"
     * Misspelling: phrase "climp", suggestion "climb"
     * Misspelling: phrase "ther", suggestion "their"
     * Misspelling: phrase "freind", suggestion "friend"
   - This type is ONLY for words that are not real English words (misspelled). Do NOT put grammar errors here.
   - IMPORTANT: American spellings (color, favorite, organize, traveled, center, gray, etc.) are NOT spelling errors. Use "american_spelling" type for those instead.
   - Maximum 3 spelling annotations. Pick the most important ones.

5. "american_spelling" — American English spelling that differs from British English. Shown in purple (informational, not an error).
   - "phrase" = the EXACT American-spelled word from the student's writing
   - "suggestion" = the British English spelling
   - This is NOT an error — just a gentle note about the British English form.
   - Examples:
     * phrase "color", suggestion "colour"
     * phrase "favorite", suggestion "favourite"
     * phrase "organize", suggestion "organise"
     * phrase "traveled", suggestion "travelled"
     * phrase "center", suggestion "centre"
     * phrase "gray", suggestion "grey"
   - Only flag words that are clearly American vs British spelling differences. If unsure, do NOT flag it.
   - Maximum 3 american_spelling annotations.

2. "grammar" — grammar, punctuation, capitalisation, tense, and word choice errors. Shown in orange.
   - IMPORTANT: Use British English as the standard. British spellings (colour, favourite, organise, travelled, centre) are CORRECT.
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
7. FEEDBACK LEVEL: Your suggestions should match the TARGET year standard described above. At higher levels, push for more sophisticated vocabulary, complex sentence structures, and advanced techniques. At lower levels, keep suggestions simple and achievable.
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
    { "phrase": "color", "suggestion": "colour", "type": "american_spelling" },
    { "phrase": "exact text from writing", "suggestion": "Try using a more exciting word like...", "type": "suggestion", "dimension": "V" },
    { "phrase": "exact text from writing", "type": "praise", "dimension": "C" }
  ]
}`;

  return prompt;
}

function buildPastContext(pastDocs) {
  const entries = pastDocs.map((doc, i) => {
    const data = doc.data();
    const firstIteration = data.iterations?.[0];
    if (!firstIteration) return null;

    const text = (firstIteration.text || "").slice(0, 300);
    const topic = data.sessionTopic || "untitled";
    const annotations = firstIteration.annotations || [];

    const praises = annotations
      .filter(a => a.type === "praise" && a.phrase && a.dimension)
      .map(a => `- ${VCOP_EMOJIS[a.dimension] || ""}${a.dimension}: "${a.phrase}"`)
      .slice(0, 3);

    const suggestions = annotations
      .filter(a => a.type === "suggestion" && a.phrase && a.dimension)
      .map(a => `- ${VCOP_EMOJIS[a.dimension] || ""}${a.dimension}: "${a.phrase}"${a.suggestion ? ` (${a.suggestion})` : ""}`)
      .slice(0, 3);

    let entry = `PAST WRITING #${i + 1} (topic: "${topic}"):\nText: "${text}${firstIteration.text?.length > 300 ? "..." : ""}"`;
    if (praises.length > 0) entry += `\nGood examples found:\n${praises.join("\n")}`;
    if (suggestions.length > 0) entry += `\nIssues found:\n${suggestions.join("\n")}`;
    return entry;
  }).filter(Boolean);

  return entries.join("\n\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text, sessionId, studentId, vcopFocus, topic, extraInstructions, feedbackMode, feedbackLevel, submissionId: existingSubmissionId, iterationNumber, previousText, previousAnnotations } = req.body || {};

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "Please provide some writing to analyse." });
  }

  try {
    const currentIteration = iterationNumber || 1;

    // Fetch student's past writing for context
    let pastWritingContext = "";
    if (studentId && currentIteration === 1) {
      try {
        const db = getDb();
        const pastSnap = await db.collection("submissions")
          .where("studentId", "==", studentId)
          .orderBy("createdAt", "desc")
          .limit(6)
          .get();

        const pastDocs = pastSnap.docs
          .filter(d => d.id !== existingSubmissionId)
          .slice(0, 5);

        if (pastDocs.length > 0) {
          pastWritingContext = buildPastContext(pastDocs);
        }
      } catch (err) {
        console.warn("Failed to fetch past submissions:", err.message);
      }
    }

    const systemPrompt = buildSystemPrompt(vcopFocus, topic, extraInstructions, feedbackMode, currentIteration, previousText, previousAnnotations, studentId, feedbackLevel, pastWritingContext);

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1536,
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
