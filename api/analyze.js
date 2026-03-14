import Anthropic from "@anthropic-ai/sdk";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./_firebase.js";
import { MODEL_ID } from "./_config.js";
import { checkContentSafety } from "./_content-safety.js";

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

// ============================================================
// STEP 1: Spelling & Grammar Check (focused, short prompt)
// ============================================================
function buildSpellingGrammarPrompt(studentId) {
  const actualYear = getActualYear(studentId);
  const yearLabel = actualYear ? actualYear.label : "Y5";

  return `You are a careful proofreader for ${yearLabel} primary school students (British English standard).

YOUR ONLY JOB: Find spelling errors, grammar errors, and American spellings. Nothing else.

SPELLING ERRORS (type "spelling"):
- Words that are NOT real English words (misspelled): becuase→because, climp→climb, delicous→delicious, freind→friend
- Maximum 3. Pick the most important.
- Do NOT flag American spellings here (use "american_spelling" instead).
- Do NOT flag character names, proper nouns, place names, or made-up names as spelling errors. If a word looks like a name (capitalised, used as a character/person), leave it alone. Only flag genuine English spelling mistakes.

GRAMMAR ERRORS (type "grammar"):
- Wrong word usage, capitalisation, tense, subject-verb agreement, missing articles
- HOMOPHONE ERRORS (check carefully!):
  * there/their/they're — "there cage" → "their cage", "there going" → "they're going"
  * your/you're — "your going" → "you're going"
  * its/it's — "it's tail" → "its tail"
  * to/too/two — "to big" → "too big"
  * where/wear/were — "where a hat" → "wear a hat"
- CAPITAL LETTER RULES:
  * Every sentence MUST start with a capital letter.
  * "i" must ALWAYS be "I". Also "i'm"→"I'm", "i'll"→"I'll", "i've"→"I've".
  * Proper nouns: days, months, places, names.
  * Check EVERY sentence beginning — including the very FIRST word of the writing. "quietly, i climp" → "Quietly" needs a capital Q.
- Maximum 3. Pick the most important.
- Keep "phrase" SHORT — usually just the wrong word(s).

AMERICAN SPELLING (type "american_spelling"):
- American spellings that differ from British English: color→colour, favorite→favourite, organize→organise
- NOT an error, just informational. Maximum 3.

RULES:
1. "phrase" = EXACT text from the student's writing (case-sensitive match).
2. "suggestion" = the corrected word only (NOT "wrong → right" format).
3. Do NOT flag correctly spelled/used words. Double-check before including.
4. British English is the standard. British spellings are CORRECT.

Respond with ONLY valid JSON:
{
  "annotations": [
    { "phrase": "misspeled", "suggestion": "misspelled", "type": "spelling" },
    { "phrase": "i", "suggestion": "I", "type": "grammar" },
    { "phrase": "there cage", "suggestion": "their cage", "type": "grammar" },
    { "phrase": "color", "suggestion": "colour", "type": "american_spelling" }
  ]
}`;
}

// ============================================================
// STEP 2: VCOP Analysis (focused, with error context from Step 1)
// ============================================================
function buildVcopPrompt(dimensions, studentId, feedbackLevel, feedbackAmount, topic, extraInstructions, studentProfile, errorPhrases, plan) {
  const level = feedbackLevel || 1;
  const amount = feedbackAmount || 1;
  const effectiveAmount = Math.max(level, amount);
  const dimCount = dimensions.length;
  const actualYear = getActualYear(studentId);
  const baseYear = actualYear ? actualYear.year : 5;
  const actualYearLabel = actualYear ? actualYear.label : `Y${baseYear}`;

  // 用 studentProfile 的 level 來調整難度（如果有的話）
  let profileWritingYear = null;
  if (studentProfile) {
    try {
      const profile = typeof studentProfile === "string" ? JSON.parse(studentProfile) : studentProfile;
      // 從 VCOP levels 取平均值作為寫作水平估計
      const vcopLevels = [];
      if (profile.vcop) {
        for (const dim of ["vocabulary", "connectives", "openers", "punctuation"]) {
          if (profile.vcop[dim]?.level) vcopLevels.push(profile.vcop[dim].level);
        }
      }
      if (vcopLevels.length > 0) {
        const avgLevel = vcopLevels.reduce((a, b) => a + b, 0) / vcopLevels.length;
        // VCOP level 1-5 大致對應 Y3-Y7
        profileWritingYear = Math.round(avgLevel + 2);
      }
    } catch { /* ignore parse errors */ }
  }

  // Level 1=鞏固當前水平, Level 2=+1 year, Level 3=+2 years
  const currentWritingYear = profileWritingYear || baseYear;
  const targetYear = level === 1 ? currentWritingYear : level === 2 ? currentWritingYear + 1 : currentWritingYear + 2;

  // Amount 直接對應回饋數量
  const minPraise = amount <= 1 ? 1 : amount === 2 ? 1 : 2;
  const maxPraise = amount <= 1 ? 1 : amount === 2 ? 2 : 3;
  const minSugg = amount <= 1 ? 1 : amount === 2 ? 2 : 3;
  const maxSugg = amount <= 1 ? 1 : amount === 2 ? 2 : 3;

  function getYearExpectations(yr) {
    if (yr <= 4) return "Y4: Focus on basic VCOP skills. Praise small wins. Simple suggestions.";
    if (yr === 5) return "Y5: Expect paragraph organisation, varied openers, expanding vocabulary.";
    if (yr === 6) return "Y6: Expect tone control, complex sentences, precise vocabulary, advanced punctuation.";
    if (yr <= 8) return "Y7-8: Expect sophisticated vocabulary, rhetorical techniques, discourse markers, semicolons/colons.";
    return "Y9+: Expect mastery of tone, advanced literary devices, complex multi-clause sentences, full punctuation range.";
  }

  // Build dimension-specific instructions (compact, no repetition)
  const dimInstructions = [];

  if (dimensions.includes("V")) {
    dimInstructions.push(`📚 VOCABULARY (V):
- Dead words to flag: nice, good, bad, said, went, big, happy, sad. Suggest WOW word upgrades.
- WOW words already used: praise them, name the tier level.${level >= 2 ? "\n- Look for sensory language and figurative language (similes, metaphors)." : ""}
- Suggestions: provide a concrete rewritten example using the student's words.`);
  }

  if (dimensions.includes("C")) {
    dimInstructions.push(`🔗 CONNECTIVES (C):
- Level 1: and, but, so, then. Level 2: because, when, if. Level 3: after, while, until. Level 4: although, however, nevertheless. Level 5+: despite, consequently, whereas.
- LIST ALL connectives the student used, noting their levels. Then assess variety — do they use TIME (when, after, before), CAUSE (because, so, therefore), AND CONTRAST (but, although, however) types? Which type is missing? Suggest the missing type with a concrete example using the student's content.
- "And" chains (and...and...and) → suggest upgrading to a higher-level connective.
- Praise the highest-level connective used, naming its exact level.${level >= 2 ? "\n- Push for Level 3-4+ connectives." : ""}`);
  }

  if (dimensions.includes("O")) {
    dimInstructions.push(`✨ OPENERS (O) — ISPACED framework:
I=-Ing ("Running..."), S=Simile ("Like a..."), P=Preposition ("Under...","At midnight..."), A=Adverb-ly ("Silently,..."), C=Connective ("Although..."), E=-Ed ("Exhausted,..."), D=Dialogue ("'Run!' he screamed.")
- Count ISPACED types used. If <3 types, suggest a new one with a rewritten example.
- Praise each ISPACED opener found, naming its letter.
- If 2+ consecutive sentences start the same way, suggest varying.
- COMMA RULE: -ly, -ing, prepositional, -ed openers need a comma after them.`);
  }

  if (dimensions.includes("P")) {
    dimInstructions.push(`🎯 PUNCTUATION (P) — only about punctuation MARKS (. , ; : ! ? — ... ' ""):
- Level 1 (full stops, capitals): BASIC — do NOT praise these.
- Level 2 (commas in lists, !, ?, apostrophes, speech marks): Praise if used well.
- Level 3+ (semicolons, colons, dashes, brackets, ellipsis): Praise and encourage.
- If NO noteworthy punctuation beyond full stops → give 2 suggestions instead of praise.
- ⚠️ Connective words (so, because, although) are NOT punctuation — those are dimension C.`);
  }

  const errorPhrasesStr = errorPhrases.length > 0
    ? `\n⚠️ SENTENCES WITH ERRORS (from spelling/grammar check — do NOT use these for praise):\n${errorPhrases.map(p => `- "${p}"`).join("\n")}\nAny phrase containing these errors MUST NOT be praised. Find error-free phrases instead.\n`
    : "";

  // Build plan check section if student made a plan
  let planCheckSection = "";
  if (plan && typeof plan === "object") {
    const planParts = [];
    if (plan.wowWords && plan.wowWords.length > 0) {
      planParts.push(`- WOW WORDS planned: ${plan.wowWords.join(", ")}. Check if these exact words (or close variants) appear in the writing.`);
    }
    if (plan.openerType) {
      planParts.push(`- OPENER TYPE planned: "${plan.openerType}". Check if any sentence starts with this opener style.`);
    }
    if (plan.connectives && plan.connectives.length > 0) {
      planParts.push(`- CONNECTIVES planned: ${plan.connectives.join(", ")}. Check if ANY of these connectives appear in the writing. Create one plan_check for EACH planned connective.`);
    }
    if (plan.punctuation && plan.punctuation.length > 0) {
      planParts.push(`- PUNCTUATION planned: ${plan.punctuation.join(", ")}. Check if the student used these punctuation types. Create one plan_check for EACH planned punctuation type.`);
    }
    // Backward compatibility: old single connective field
    if (plan.connective && !plan.connectives) {
      planParts.push(`- CONNECTIVE planned: "${plan.connective}". Check if this connective appears in the writing.`);
    }
    if (planParts.length > 0) {
      planCheckSection = `
PLAN VS WRITING CHECK:
The student made a plan before writing. Check if they followed through on their VCOP goals.
${planParts.join("\n")}

For EACH planned item, output a "plan_check" annotation:
- If achieved: { "type": "plan_check", "phrase": "exact text where they used it", "suggestion": "You planned to use [word/technique] and you did! Well done!", "status": "achieved" }
- If not yet: { "type": "plan_check", "phrase": "", "suggestion": "You planned to use [word/technique] — try adding it in your next revision!", "status": "not_yet" }
`;
    }
  }

  const levelDescription = level === 1
    ? `Level 1 (Consolidate): Help the student strengthen Y${currentWritingYear} skills. Suggestions should reinforce techniques at their current level.`
    : level === 2
    ? `Level 2 (Progress): Student currently writes at Y${currentWritingYear} level. Give suggestions that help them reach Y${targetYear}. Do NOT suggest techniques above Y${targetYear}.`
    : `Level 3 (Challenge): Student currently writes at Y${currentWritingYear} level. Give suggestions that help them reach Y${targetYear}. Do NOT suggest techniques above Y${targetYear}.`;

  let prompt = `You are a warm, encouraging English teacher analysing student writing using the VCOP framework. Return ONLY "suggestion" and "praise" annotations (and "plan_check" if a plan exists).

STUDENT: ${actualYearLabel} (age ${baseYear + 3}-${baseYear + 4}).
FEEDBACK LEVEL: ${level}/3, evaluating at Y${targetYear} standard.
${levelDescription}
${getYearExpectations(targetYear)}
${level >= 2 ? "Push for ambitious suggestions — more precise vocabulary, complex structures, higher-level techniques. But stay encouraging." : "Keep suggestions simple and age-appropriate."}
${topic ? `TOPIC: ${topic}` : ""}
${extraInstructions ? `TEACHER INSTRUCTIONS: ${extraInstructions}` : ""}
${studentProfile ? `STUDENT PROFILE (personalise feedback using this):\n${studentProfile}\n- Reference strengths, weaknesses, recentWowWords, ispacedNeverUsed, growthNotes when relevant.\n- Frame all references positively.` : ""}
${errorPhrasesStr}
VCOP DIMENSIONS TO ANALYSE:
${dimInstructions.join("\n\n")}

ANNOTATION FORMAT:
- "suggestion" (type): VCOP improvement idea. "phrase" = exact text from writing. "suggestion" = (1) quote student's text, (2) name the VCOP technique, (3) give a concrete rewritten example. "dimension" = V/C/O/P.
- "praise" (type): Something done well. "phrase" = exact text from writing. "suggestion" = (1) name the technique, (2) explain WHY it's good. "dimension" = V/C/O/P.
${planCheckSection}
RULES:
1. "phrase" MUST be EXACT text from the student's writing (case-sensitive). Non-matching phrases will be discarded.
2. Be encouraging, specific, friendly — you're talking to a child aged ${baseYear + 3}-${baseYear + 4}.
3. NEVER praise a phrase that contains a spelling or grammar error.
4. DIMENSION ACCURACY: V=word choice, C=linking words, O=sentence starters, P=punctuation marks. Never mix.
5. Socratic approach: give examples but ask guiding questions. Don't rewrite entire text.
6. GENUINE UPGRADES ONLY: Do NOT replace natural, effective phrases with longer or more awkward alternatives. If the original phrase already works well, praise it instead. Only suggest changes for genuinely weak parts (dead words, vague language, repetition).
7. Do NOT suggest changes to parts that are already correct and effective.

⚠️ MANDATORY DIMENSION COVERAGE — NON-NEGOTIABLE:
You MUST provide feedback for ALL ${dimensions.length} dimensions: ${dimensions.map(d => `${VCOP_EMOJIS[d]}${d}`).join(", ")}. For each dimension:
- If the student used it well → praise with specific quotes from their writing.
- If the student did NOT use it or the text is too short to demonstrate it → say so honestly (e.g. "I didn't spot any connectives yet — try adding one like 'because' or 'although' to extend your ideas") and give one concrete suggestion.
- NEVER skip a dimension. NEVER invent praise for something the student didn't do.
- Output that is MISSING any dimension will be REJECTED.

FEEDBACK AMOUNT (amount=${amount}):
- Amount 1: ${minPraise} praise + ${minSugg} suggestion per dimension
- Amount 2: 1-2 praises + 2 suggestions per dimension
- Amount 3: 2-3 praises + 3 suggestions per dimension
You are at amount ${amount}. Per dimension: ${minPraise}-${maxPraise} praise(s) + ${minSugg}-${maxSugg} suggestion(s).

PRE-OUTPUT CHECK — verify EVERY dimension has BOTH praise AND suggestion at the correct amount:
${dimensions.map(d => `- ${VCOP_EMOJIS[d]}${d}: ${minPraise}-${maxPraise} praise, ${minSugg}-${maxSugg} suggestion — MISSING = REJECTED`).join("\n")}${planCheckSection ? `\n⚠️ MANDATORY: You MUST also include plan_check annotations for EACH planned item (wowWords, openerType, connective). Missing plan_check annotations = REJECTED output.` : ""}

Respond with ONLY valid JSON:
{
  "annotations": [
${dimensions.map(d => `    { "phrase": "exact text", "suggestion": "technique + explanation + example", "type": "suggestion", "dimension": "${d}" },
    { "phrase": "exact text", "suggestion": "technique + why it's good", "type": "praise", "dimension": "${d}" }`).join(",\n")}${planCheckSection ? `,
    { "type": "plan_check", "phrase": "exact text or empty", "suggestion": "You planned to use X and you did! Well done!", "status": "achieved" },
    { "type": "plan_check", "phrase": "", "suggestion": "You planned to use X — try adding it in your next revision!", "status": "not_yet" }` : ""}
  ]
}`;

  return prompt;
}

// ============================================================
// REVISION PROMPT (v2+) — kept as-is, already focused
// ============================================================
function buildRevisionPrompt(previousText, previousAnnotations) {
  const prevAnnotationsJson = previousAnnotations ? JSON.stringify(previousAnnotations) : "[]";

  return `You are a warm, encouraging English teacher for primary school students (ages 7-11). The student has revised their writing based on your earlier feedback. Your job is to evaluate EACH original issue.

ORIGINAL VERSION (first draft):
"""
${previousText}
"""

ORIGINAL FEEDBACK (from v1):
${prevAnnotationsJson}

EVALUATION RULES:
Go through EACH annotation from the original feedback that was type "spelling", "grammar", or "suggestion". For each one, determine ONE of three statuses:

✅ IMPROVED (type "revision_good"):
- The student changed this part AND it is genuinely better than before.
- The student does NOT need to match your exact suggestion. Any improvement counts!
- Include a "suggestion" field with encouraging feedback.

🔄 ATTEMPTED (type "revision_attempted"):
- The student clearly tried to change this part, but the change did NOT improve it or introduced a new problem.
- Include "suggestion" with: acknowledge the effort → explain the issue → give guidance.
- Include "originalType" ("spelling", "grammar", or "suggestion") and "dimension" if applicable.

⬜ NOT YET (keep original annotation):
- The student did NOT change this part at all — the original problem text is still there unchanged.
- Output the ORIGINAL annotation exactly as it was (same type, phrase, suggestion, dimension).

ADDITIONAL RULES:
- Keep any "praise" annotations that still apply to the new text (phrase still exists in new version).
- Do NOT find any NEW problems. Only evaluate issues from the original feedback.
- The "phrase" field MUST match EXACT text from the student's NEW writing.
- "originalPhrase" field = the exact phrase from the ORIGINAL version that was flagged.
- CORE PRINCIPLE: Always acknowledge student effort first. Never ignore a student's attempt to improve.

You MUST respond with ONLY valid JSON in this exact format, no other text:
{
  "annotations": [
    { "phrase": "student's new text", "originalPhrase": "original text", "type": "revision_good", "suggestion": "Great improvement!" },
    { "phrase": "student's attempted text", "originalPhrase": "original text", "type": "revision_attempted", "suggestion": "Good try! ...", "originalType": "spelling" },
    { "phrase": "unchanged misspelled word", "suggestion": "correct spelling", "type": "spelling" },
    { "phrase": "good text", "type": "praise", "dimension": "C", "suggestion": "This is good because..." }
  ]
}`;
}

// ============================================================
// JSON parsing helper (shared by both steps)
// ============================================================
function parseAIResponse(content, stepName) {
  // Strip markdown code fences
  if (content.startsWith("```")) {
    content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  // Extract JSON object
  const firstBrace = content.indexOf("{");
  if (firstBrace !== -1) {
    let depth = 0;
    let lastBrace = -1;
    for (let i = firstBrace; i < content.length; i++) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") { depth--; if (depth === 0) { lastBrace = i; break; } }
    }
    if (lastBrace !== -1) {
      content = content.slice(firstBrace, lastBrace + 1);
    }
  }

  try {
    return JSON.parse(content);
  } catch (parseErr) {
    console.warn(`[${stepName}] JSON parse failed, attempting fix: ${parseErr.message}`);
    let fixed = content
      .replace(/,\s*([\]}])/g, "$1")
      .replace(/,\s*$/, "")
      .replace(/}\s*{/g, "},{");
    try {
      return JSON.parse(fixed);
    } catch (fixErr) {
      console.error(`[${stepName}] JSON fix also failed: ${fixErr.message}`);
      const annotationMatches = [...content.matchAll(/\{[^{}]*"phrase"\s*:\s*"[^"]*"[^{}]*"type"\s*:\s*"[^"]*"[^{}]*\}/g)];
      if (annotationMatches.length > 0) {
        const salvaged = annotationMatches.map(m => { try { return JSON.parse(m[0]); } catch { return null; } }).filter(Boolean);
        console.log(`[${stepName}] Salvaged ${salvaged.length} annotations from broken JSON`);
        return { annotations: salvaged };
      }
      throw new Error(`Could not parse AI response (${stepName}). Please try again.`);
    }
  }
}

// Handle truncated responses
function handleTruncation(content, stopReason, maxTokens, stepName) {
  if (stopReason === "max_tokens") {
    console.warn(`[${stepName}] Response truncated at ${maxTokens} tokens, attempting to salvage`);
    const lastCompleteObj = content.lastIndexOf("}");
    if (lastCompleteObj !== -1) {
      content = content.slice(0, lastCompleteObj + 1);
      const openBrackets = (content.match(/\[/g) || []).length - (content.match(/\]/g) || []).length;
      const openBraces = (content.match(/{/g) || []).length - (content.match(/}/g) || []).length;
      for (let i = 0; i < openBrackets; i++) content += "]";
      for (let i = 0; i < openBraces; i++) content += "}";
    }
  }
  return content;
}

function buildProfileContext(profile) {
  if (!profile) return "";
  if (profile.teacherNotes?.length > 3) {
    profile.teacherNotes = profile.teacherNotes.slice(-3);
  }
  return JSON.stringify(profile, null, 2);
}

// ============================================================
// MAIN HANDLER
// ============================================================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text, sessionId, studentId, vcopFocus, topic, extraInstructions, feedbackMode, feedbackLevel, feedbackAmount, submissionId: existingSubmissionId, iterationNumber, previousText, previousAnnotations, plan, spellCheckOnly, spellCheckOnlyStrict } = req.body || {};

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "Please provide some writing to analyse." });
  }

  // 輸入長度限制
  if (text.length > 5000) {
    return res.status(400).json({ error: "Text too long. Please keep your writing under 5000 characters." });
  }

  // Content safety check
  const safety = checkContentSafety(text, "analyze");
  if (safety.shouldBlock) {
    return res.status(400).json({ error: "Your message couldn't be processed. Please try rephrasing." });
  }

  try {
    const currentIteration = iterationNumber || 1;
    const isRevision = currentIteration > 1 && previousText;

    // ──────────────────────────────────────────────
    // REVISION FLOW (v2+) — single call, unchanged
    // ──────────────────────────────────────────────
    if (isRevision) {
      const revisionPrompt = buildRevisionPrompt(previousText, previousAnnotations);
      console.log(`[ANALYZE-REVISION] studentId=${studentId}, iteration=${currentIteration}, promptLength=${revisionPrompt.length}`);

      const message = await client.messages.create({
        model: MODEL_ID,
        max_tokens: 2048,
        system: revisionPrompt,
        messages: [{ role: "user", content: `Please evaluate the student's revised writing:\n\n${text}` }],
      });

      let content = handleTruncation(message.content[0].text.trim(), message.stop_reason, 2048, "REVISION");
      const parsed = parseAIResponse(content, "REVISION");
      const rawAnnotations = parsed.annotations || [];

      // Server-side validation
      const studentText = text.trim();
      const annotations = rawAnnotations.filter((a) => {
        if (!a.phrase || typeof a.phrase !== "string") return false;
        return studentText.includes(a.phrase) || studentText.toLowerCase().includes(a.phrase.toLowerCase());
      });

      console.log(`[ANALYZE-REVISION] stop_reason=${message.stop_reason}, annotations=${annotations.length}`);

      // Save to Firestore
      let submissionId = existingSubmissionId || null;
      if (sessionId && studentId && existingSubmissionId) {
        const db = getDb();
        await db.collection("submissions").doc(existingSubmissionId).update({
          iterations: FieldValue.arrayUnion({
            version: currentIteration,
            text: text.trim(),
            annotations,
            createdAt: new Date().toISOString(),
          }),
        });
      }

      return res.status(200).json({ annotations, submissionId, iterationNumber: currentIteration });
    }

    // ──────────────────────────────────────────────
    // STRICT SPELL CHECK ONLY (Connective extension — only misspelled words)
    // ──────────────────────────────────────────────
    if (spellCheckOnlyStrict) {
      const strictPrompt = `You are a spell checker for primary school students.
YOUR ONLY JOB: Find misspelled words. Nothing else.

RULES:
- ONLY flag words that are NOT real English words (e.g. becuase→because, teh→the, freind→friend).
- Do NOT check punctuation, grammar, capitalisation, or sentence structure.
- Do NOT flag character names, proper nouns, or made-up names.
- Do NOT suggest any changes to punctuation or word usage.
- Maximum 3 spelling errors.

Respond with ONLY valid JSON:
{ "annotations": [{ "phrase": "misspeled", "suggestion": "misspelled", "type": "spelling" }] }
If no errors found: { "annotations": [] }`;

      console.log(`[SPELLCHECK-STRICT] studentId=${studentId}, textLength=${text.length}`);

      const msg = await client.messages.create({
        model: MODEL_ID,
        max_tokens: 512,
        system: strictPrompt,
        messages: [{ role: "user", content: text }],
      });

      let content = handleTruncation(msg.content[0].text.trim(), msg.stop_reason, 512, "SPELLCHECK-STRICT");
      const parsed = parseAIResponse(content, "SPELLCHECK-STRICT");
      const annotations = (parsed.annotations || []).filter(a => {
        if (!a.phrase || typeof a.phrase !== "string") return false;
        if (a.type !== "spelling") return false; // 只保留拼寫錯誤
        const studentText = text.trim();
        const found = studentText.includes(a.phrase) || studentText.toLowerCase().includes(a.phrase.toLowerCase());
        if (!found) return false;
        if (a.suggestion) {
          const cleanSugg = a.suggestion.includes("→") ? a.suggestion.split("→").pop().trim() : a.suggestion.trim();
          if (cleanSugg.toLowerCase() === a.phrase.toLowerCase() && cleanSugg === a.phrase) return false;
        }
        return true;
      });

      console.log(`[SPELLCHECK-STRICT] annotations=${annotations.length}`);
      return res.status(200).json({ annotations });
    }

    // ──────────────────────────────────────────────
    // SPELL CHECK ONLY (Sentence Builder per-sentence check)
    // ──────────────────────────────────────────────
    if (spellCheckOnly) {
      const step1Prompt = buildSpellingGrammarPrompt(studentId);
      console.log(`[SPELLCHECK-ONLY] studentId=${studentId}, textLength=${text.length}`);

      const step1Message = await client.messages.create({
        model: MODEL_ID,
        max_tokens: 1024,
        system: step1Prompt,
        messages: [{ role: "user", content: `Check this student's writing for spelling and grammar errors:\n\n${text}` }],
      });

      let step1Content = handleTruncation(step1Message.content[0].text.trim(), step1Message.stop_reason, 1024, "SPELLCHECK");
      const step1Parsed = parseAIResponse(step1Content, "SPELLCHECK");
      const annotations = (step1Parsed.annotations || []).filter(a => {
        if (!a.phrase || typeof a.phrase !== "string") return false;
        const studentText = text.trim();
        const found = studentText.includes(a.phrase) || studentText.toLowerCase().includes(a.phrase.toLowerCase());
        if (!found) return false;
        if ((a.type === "spelling" || a.type === "grammar") && a.suggestion) {
          const cleanSugg = a.suggestion.includes("→") ? a.suggestion.split("→").pop().trim() : a.suggestion.trim();
          if (cleanSugg.toLowerCase() === a.phrase.toLowerCase() && cleanSugg === a.phrase) return false;
        }
        return true;
      });

      console.log(`[SPELLCHECK-ONLY] annotations=${annotations.length}`);
      return res.status(200).json({ annotations });
    }

    // ──────────────────────────────────────────────
    // FIRST SUBMISSION (v1) — 2-step pipeline
    // ──────────────────────────────────────────────

    // Fetch student profile
    let studentProfile = "";
    if (studentId) {
      try {
        const db = getDb();
        const profileSnap = await db.collection("studentProfiles").doc(studentId).get();
        if (profileSnap.exists) {
          studentProfile = buildProfileContext(profileSnap.data());
        }
      } catch (err) {
        console.warn("Failed to fetch student profile:", err.message);
      }
    }

    const dimensions = (vcopFocus && vcopFocus.length > 0 ? vcopFocus : ["V", "C", "O", "P"]).filter(d => ["V", "C", "O", "P"].includes(d));

    // ── STEP 1: Spelling & Grammar ──
    const step1Prompt = buildSpellingGrammarPrompt(studentId);
    console.log(`[STEP1-SPELLING] studentId=${studentId}, promptLength=${step1Prompt.length}`);

    const step1Message = await client.messages.create({
      model: MODEL_ID,
      max_tokens: 1024,
      system: step1Prompt,
      messages: [{ role: "user", content: `Check this student's writing for spelling and grammar errors:\n\n${text}` }],
    });

    let step1Content = handleTruncation(step1Message.content[0].text.trim(), step1Message.stop_reason, 1024, "STEP1");
    const step1Parsed = parseAIResponse(step1Content, "STEP1");
    const spellingGrammarAnnotations = (step1Parsed.annotations || []).filter(a => {
      if (!a.phrase || typeof a.phrase !== "string") return false;
      const studentText = text.trim();
      const found = studentText.includes(a.phrase) || studentText.toLowerCase().includes(a.phrase.toLowerCase());
      if (!found) {
        console.warn(`[STEP1] Filtered: "${a.phrase}" not in text`);
        return false;
      }
      // Verify suggestion differs from phrase
      if ((a.type === "spelling" || a.type === "grammar") && a.suggestion) {
        const cleanSugg = a.suggestion.includes("→") ? a.suggestion.split("→").pop().trim() : a.suggestion.trim();
        if (cleanSugg.toLowerCase() === a.phrase.toLowerCase() && cleanSugg === a.phrase) return false;
      }
      return true;
    });

    console.log(`[STEP1-SPELLING] stop_reason=${step1Message.stop_reason}, annotations=${spellingGrammarAnnotations.length}, output_tokens=${step1Message.usage?.output_tokens}`);

    // Extract error phrases for Step 2 (so VCOP knows which sentences have errors)
    const errorPhrases = spellingGrammarAnnotations
      .filter(a => a.type === "spelling" || a.type === "grammar")
      .map(a => a.phrase);

    // ── STEP 2: VCOP Analysis ──
    const effectiveAmt = Math.max(feedbackLevel || 1, feedbackAmount || 1);
    const step2MaxTokens = effectiveAmt >= 3 ? 4096 : effectiveAmt >= 2 ? 3072 : 2048;
    const step2Prompt = buildVcopPrompt(dimensions, studentId, feedbackLevel, feedbackAmount, topic, extraInstructions, studentProfile, errorPhrases, plan);
    console.log(`[STEP2-VCOP] dimensions=${dimensions.join(",")}, level=${feedbackLevel}, amount=${feedbackAmount}, promptLength=${step2Prompt.length}, maxTokens=${step2MaxTokens}`);

    const step2Message = await client.messages.create({
      model: MODEL_ID,
      max_tokens: step2MaxTokens,
      system: step2Prompt,
      messages: [{ role: "user", content: `Analyse this student's writing for VCOP feedback:\n\n${text}` }],
    });

    let step2Content = handleTruncation(step2Message.content[0].text.trim(), step2Message.stop_reason, step2MaxTokens, "STEP2");
    let vcopAnnotations = [];
    try {
      const step2Parsed = parseAIResponse(step2Content, "STEP2");
      vcopAnnotations = (step2Parsed.annotations || []).filter(a => {
      // plan_check with "not_yet" status can have empty phrase
      if (a.type === "plan_check") {
        if (a.status === "not_yet") return true;
        if (!a.phrase || typeof a.phrase !== "string") return false;
        const studentText = text.trim();
        return studentText.includes(a.phrase) || studentText.toLowerCase().includes(a.phrase.toLowerCase());
      }
      if (!a.phrase || typeof a.phrase !== "string") return false;
      const studentText = text.trim();
      return studentText.includes(a.phrase) || studentText.toLowerCase().includes(a.phrase.toLowerCase());
    });

    // Log VCOP coverage
    const typeCounts = {};
    for (const a of vcopAnnotations) {
      const key = a.dimension ? `${a.type}:${a.dimension}` : a.type;
      typeCounts[key] = (typeCounts[key] || 0) + 1;
    }
    console.log(`[STEP2-VCOP] stop_reason=${step2Message.stop_reason}, annotations=${vcopAnnotations.length}, output_tokens=${step2Message.usage?.output_tokens}, breakdown:`, JSON.stringify(typeCounts));
    } catch (step2Err) {
      // STEP2 解析失敗時，仍返回 Step 1 結果，不讓學生看到錯誤
      console.error(`[STEP2-VCOP] Failed, returning Step 1 only: ${step2Err.message}`);
    }

    // ── MERGE Step 1 + Step 2 ──
    const annotations = [...spellingGrammarAnnotations, ...vcopAnnotations];
    console.log(`[ANALYZE] Total annotations: ${annotations.length} (spelling/grammar: ${spellingGrammarAnnotations.length}, vcop: ${vcopAnnotations.length})`);

    // Save to Firestore
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
        await db.collection("submissions").doc(existingSubmissionId).update({
          iterations: FieldValue.arrayUnion(iterationEntry),
        });
        submissionId = existingSubmissionId;
      } else {
        const submissionData = {
          sessionId,
          studentId,
          sessionTopic: topic || null,
          feedbackMode: feedbackMode || "encouragement",
          teacherComment: null,
          createdAt: FieldValue.serverTimestamp(),
          iterations: [iterationEntry],
        };
        if (plan && typeof plan === "object") {
          submissionData.plan = plan;
        }
        const docRef = await db.collection("submissions").add(submissionData);
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
