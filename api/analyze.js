import Anthropic from "@anthropic-ai/sdk";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./_firebase.js";
import { VCOP_KNOWLEDGE } from "./vcop-knowledge.js";

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

function buildSystemPrompt(vcopFocus, topic, extraInstructions, feedbackMode, iterationNumber, previousText, previousAnnotations, studentId, feedbackLevel, studentProfile, feedbackAmount) {
  const dimensions = (vcopFocus && vcopFocus.length > 0 ? vcopFocus : ["V", "C", "O", "P"]);

  const dimensionDescriptions = {
    V: `Vocabulary (WOW Words) — replace "dead" or dull words with ambitious, contextually appropriate alternatives.
   Level 1-2 (Basic): went→ran/skipped, said→asked/replied, big→huge/large, nice→pretty/fun, quickly→fast/soon
   Level 3-4 (WOW): went→trudged/prowled/sprinted, said→whispered/cried/bellowed, big→enormous/gigantic, nice→beautiful/glorious, bad→fierce/terrifying
   Level 5+ (Sophisticated): went→meandered/lumbered/swaggered, said→enunciated/retorted/murmured, big→formidable/colossal, bad→malevolent/sinister/foreboding, nice→sumptuous/quintessential
   Look for: sensory language (sounds, sights, textures, smells, tastes), figurative language (similes, metaphors, personification), precise verbs that "show not tell"
   When suggesting, ask: What does it look/sound/feel like? Match WOW words to the student's target year level.`,
    C: `Connectives (Captain Connectives) — structural mortar that controls flow, rhythm, and logical relationships.
   Level 1: and, but, so, then
   Level 2: because, when, if, or
   Level 3: after, while, as well as, also, besides, before, until
   Level 4: although, however, even though, nevertheless, meanwhile, furthermore
   Level 5+: despite, contrary to, in addition to, owing to, consequently, whereas
   KEY: If student chains "and...and...and", prompt upgrade. Teach position variety: subordinate clauses can OPEN a sentence.`,
    O: `Openers — use the ISPACED framework. If 2+ consecutive sentences start the same way, intervene.
   I = -Ing opener: "Running towards the sea..." / "Trembling with fear..."
   S = Simile opener: "Like a bottle-nose dolphin..." / "As quiet as a mouse..."
   P = Preposition opener: "Under the bridge..." / "At midnight..." / "During the storm..."
   A = Adverb (-ly) opener: "Silently, she waited..." / "Carefully, he crept..."
   C = Connective opener: "Despite it being warm..." / "However..." / "Although..."
   E = -Ed opener: "Exhausted from the journey..." / "Excited by the news..."
   D = Dialogue opener: "'Wake up!' cried mum."
   COMMA RULE: -ly, -ing, prepositional, and -ed openers MUST be followed by a comma.
   Count how many DIFFERENT ISPACED types the student uses. If fewer than 3, suggest a new type.`,
    P: `Punctuation (Doctor Punctuation) — a tool for VOICE, PACING, and DRAMATIC EFFECT.
   Level 1 (Base): Full stops (.) and capitals — basic boundaries. Do NOT praise these.
   Level 2 (Middle): Commas in lists, exclamation marks, question marks, apostrophes for contraction, speech marks. Praise accurate speech marks and commas after openers.
   Level 3+ (Peak): Semicolons (;) linking related clauses, colons (:) for revelations or lists, brackets for asides, dashes (—) for emphasis, ellipsis (...) for suspense. Praise and encourage these.
   TEACHING: Eliminate comma splices/run-on sentences. Check speech mark accuracy. Prompt advanced students to use colons for revelation or semicolons for flow.`,
  };

  const focusList = dimensions
    .map((d) => `- ${dimensionDescriptions[d]}`)
    .join("\n");

  const level = feedbackLevel || 1;
  const amount = feedbackAmount || 1;
  const dimCount = dimensions.length;
  const actualYear = getActualYear(studentId);
  const baseYear = actualYear ? actualYear.year : 5; // default Y5 if unknown
  const isRevision = iterationNumber > 1 && previousText;

  // For revision (v2+), evaluate each original issue with 3 statuses: improved / attempted / not_yet
  if (isRevision) {
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
- Example: You suggested "diverse topics" but student wrote "different topics" → this IS an improvement over the original "all sorts of subjects" → mark as revision_good.
- Include a "suggestion" field with encouraging feedback. If the student's fix differs from your original suggestion, praise their choice AND optionally offer a further upgrade.
- Format: "Good improvement! [praise their specific change]. [optional: Want to push even further? Try '[better option]' for an even stronger upgrade.]"

🔄 ATTEMPTED (type "revision_attempted"):
- The student clearly tried to change this part, but the change did NOT improve it or introduced a new problem.
- Example: Student tried to fix a spelling error but misspelled the new word too.
- Example: Student replaced a word but the replacement doesn't fit the context.
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
    { "phrase": "student's new text", "originalPhrase": "original text", "type": "revision_good", "suggestion": "Great improvement! 'different topics' is clearer than 'all sorts of subjects'." },
    { "phrase": "student's attempted text", "originalPhrase": "original text", "type": "revision_attempted", "suggestion": "Good try! You changed this, but 'becose' still needs fixing — try 'because'.", "originalType": "spelling" },
    { "phrase": "student's attempted text", "originalPhrase": "original text", "type": "revision_attempted", "suggestion": "Nice effort changing this! The word 'big' works, but try an even stronger WOW word like 'enormous'.", "originalType": "suggestion", "dimension": "V" },
    { "phrase": "unchanged misspelled word", "suggestion": "correct spelling", "type": "spelling" },
    { "phrase": "unchanged grammar error", "suggestion": "corrected grammar", "type": "grammar" },
    { "phrase": "unchanged text", "suggestion": "Try this...", "type": "suggestion", "dimension": "V" },
    { "phrase": "good text", "type": "praise", "dimension": "C", "suggestion": "This is good because..." }
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

  // Amount controls per-dimension counts — driven by level AND amount sliders
  const effectiveAmount = Math.max(level, amount); // higher of level or amount
  const praisePerDim = effectiveAmount === 1 ? 1 : effectiveAmount === 2 ? "1-2" : "2-3";
  const suggPerDim = effectiveAmount === 1 ? 1 : effectiveAmount === 2 ? "1-2" : "2-3";
  const minPraise = effectiveAmount === 1 ? 1 : effectiveAmount === 2 ? 1 : 2;
  const maxPraise = effectiveAmount === 1 ? 1 : effectiveAmount === 2 ? 2 : 3;
  const minSugg = effectiveAmount === 1 ? 1 : effectiveAmount === 2 ? 1 : 2;
  const maxSugg = effectiveAmount === 1 ? 1 : effectiveAmount === 2 ? 2 : 3;
  const minAnnotations = dimCount * (minPraise + minSugg) + 2;
  const maxAnnotations = dimCount * (maxPraise + maxSugg) + 6;

  let prompt = `You are a warm, encouraging English teacher for primary school students (ages 7-11). You analyse student writing using the Big Writing & VCOP framework and return inline annotations.

${VCOP_KNOWLEDGE}

TODAY'S FOCUS DIMENSIONS:
${focusList}

${yearExpectations ? `STUDENT LEVEL CONTEXT:\n${yearExpectations}\n` : ""}
${topic ? `WRITING TOPIC: ${topic}\nUse this topic context when evaluating the writing.\n` : ""}
${extraInstructions ? `ADDITIONAL TEACHER INSTRUCTIONS: ${extraInstructions}\n` : ""}
${studentProfile ? `
STUDENT PROFILE (use this to personalise your feedback):
${studentProfile}

PROFILE-BASED FEEDBACK RULES:
- Reference the student's VCOP levels to calibrate your feedback difficulty.
- If student has weaknesses listed, prioritise suggestions in those areas.
- If student has strengths, acknowledge them when relevant (e.g. "You're great at -ly openers!").
- Reference recentWowWords: "You used 'trembling' last time — try another sensory word!"
- Check ispacedNeverUsed to suggest new opener types they haven't tried.
- Reference teacherNotes (if any) as teaching guidance from the teacher.
- Reference growthNotes for encouragement: "You started using semicolons recently — keep it up!"
- Frame everything positively, never negatively.
- Only reference profile data in "suggestion" or "praise" annotations, not in spelling/grammar.
- If no profile data is relevant to a particular annotation, just give normal feedback.
` : ""}
${dimensions.includes("O") ? `OPENERS DIMENSION — ISPACED ANALYSIS:
Analyse sentence openers using the ISPACED framework (7 types):
I = -Ing opener: "Running through the forest, he..." / "Gazing at the stars, she..."
S = Simile opener: "Like a shot from a cannon..." / "As quiet as a mouse..."
P = Preposition opener: "Under the bridge, ..." / "At midnight, ..." / "During the storm, ..."
A = Adverb (-ly) opener: "Silently, the cat crept..." / "Nervously, she opened..."
C = Connective opener: "Although it was raining..." / "Despite the cold..."
E = -Ed opener: "Exhausted from the journey, he..." / "Convinced she was right, ..."
D = Dialogue opener: "'Wake up!' cried mum." / "'Run!' he screamed."

OPENER FEEDBACK RULES:
- PRAISE (type "praise", dimension "O"): When the student uses an ISPACED opener type, praise it and NAME the ISPACED letter. Example: praise phrase "Silently, the cat crept" with suggestion "This is an A (Adverb) opener from ISPACED — it tells the reader HOW the action happened right from the start."
- SUGGESTION (type "suggestion", dimension "O"): If most sentences start the same way (e.g. all starting with "I" or "The"), pick one sentence and suggest rewriting it with a specific ISPACED type. Give the FULL rewritten example using the student's own words. Example: phrase "The cat crept across the room", suggestion "Try an A (Adverb) opener: 'Silently, the cat crept across the room.'"
- Count how many DIFFERENT ISPACED types the student uses. If fewer than 3 types, suggest trying a new type they haven't used yet and name which ISPACED letter it is.
- COMMA RULE: -ly, -ing, prepositional, and -ed openers need a COMMA after them. If a student uses one but forgets the comma, flag it as a grammar annotation.
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
   - "suggestion" = MUST contain ALL THREE parts:
     (a) QUOTE: Reference the student's exact text
     (b) TECHNIQUE: Name the specific VCOP technique (e.g. "WOW word upgrade", "A (Adverb) opener", "Level 4 connective", "colon for revelation")
     (c) CONCRETE EXAMPLE: Provide a FULL rewritten version using the student's own words
     BAD: "Try more punctuation." ← too vague, no technique named, no example
     BAD: "Use better vocabulary." ← too vague, no specific text referenced
     GOOD: "Your second paragraph is one very long sentence — it's a run-on. Try breaking it up: put a full stop after 'each lesson' and start a new sentence with 'We also'."
     GOOD: "The word 'nice' here is a dead word. Try a WOW word: 'My favourite subject is fascinating because...' — 'fascinating' is a Level 3-4 WOW word that tells the reader exactly how you feel."
     GOOD: "You started 3 sentences with 'I'. Try an A (Adverb) opener: 'Excitedly, I rushed to my favourite lesson' — the -ly word tells the reader HOW you felt."
   - "dimension" = one of ${dimensions.join("/")}

4. "praise" — things done well. MUST include an explanation of WHY it's good.
   - "phrase" = exact text from writing (the specific words that are good)
   - "suggestion" = REQUIRED. MUST contain ALL THREE parts:
     (a) QUOTE: The phrase you're praising (already in "phrase" field)
     (b) TECHNIQUE NAME: Name the specific VCOP technique or skill demonstrated
     (c) EXPLANATION: Explain WHY this technique makes the writing better
     BAD: "Keep practising punctuation!" ← no technique named, no explanation
     BAD: "Good vocabulary!" ← no technique, no explanation of why
     BAD: "Nice work here." ← completely empty praise
     GOOD: "You used brackets in '(or on a computer)' to add extra information — this is a Level 3 punctuation technique called parenthesis! It lets you slip in an aside without breaking the sentence flow."
     GOOD: "'Rushed' is a strong WOW word (Level 1-2 vocabulary upgrade from 'went') — it tells the reader you moved fast and with energy."
     GOOD: "You used 'because' to explain your reason — this is a Level 2 connective that links your ideas with a cause-and-effect relationship."
     GOOD: "'Excitedly, I...' is an A (Adverb) opener from ISPACED — starting with an -ly word tells the reader HOW you felt before revealing the action."
   - "dimension" = one of ${dimensions.join("/")}

RULES:
1. Be encouraging and specific — point out EXACTLY what the student did well with quotes from their writing.
2. NEVER give scores, grades, rankings, or labels like "Great", "Good", "Keep trying".
3. The "phrase" field MUST contain the EXACT text from the student's writing (case-sensitive, character-for-character match). Copy-paste from the student's text. If the phrase you write does not appear exactly in the student's text, the annotation will be thrown away.
4. Keep language simple and friendly — you're talking to a child.
5. ONLY analyse the dimensions listed above. Do NOT include other VCOP dimensions.
6. Maximum 3 "spelling" annotations AND maximum 3 "grammar" annotations. Pick the most critical errors in each category.
6b. SOCRATIC RULE: You are a facilitator, NOT an editor. NEVER rewrite the student's text in its entirety. For suggestions, provide a brief example showing HOW to improve a specific phrase, then ask a guiding question to make the student think. Example: "Try an A (Adverb) opener here: 'Cautiously, Sally peered...' — what adverb would describe how she looked?" The cognitive load must stay on the student.
7. FEEDBACK LEVEL (CRITICAL — this changes your entire approach):
   - Level 1: Judge by the student's actual year group. Focus on "Basic" items from each VCOP dimension. Praise basic skills done well. Suggestions should be simple, achievable next steps. Per dimension: 1 praise + 1 suggestion.
   - Level 2: Judge 1-2 years ABOVE actual year. Focus on "Intermediate" items from each VCOP dimension. Push for varied sentence structures, discourse markers, more precise vocabulary, sensory language. Per dimension: 1-2 praises + 1-2 suggestions.
   - Level 3: Judge 3+ years ABOVE actual year. Focus on "Advanced" items from each VCOP dimension. Demand rhetorical techniques, sophisticated vocabulary, complex multi-clause sentences, advanced punctuation for effect. Suggestions should be detailed and challenging. Per dimension: 2-3 praises + 2-3 suggestions. This is the MOST DETAILED level — give thorough, in-depth feedback.
   Current feedback level is ${level}/3, targeting Y${targetYear} standard. Your suggestions MUST reflect this target — ${level === 1 ? "keep them simple and age-appropriate, focus on Basic-level VCOP skills" : level === 2 ? "push beyond basics, focus on Intermediate-level VCOP skills" : "demand Advanced-level VCOP skills, give the MOST thorough and detailed feedback possible"}.
8. Return ${minAnnotations}-${maxAnnotations} annotations total. Feedback amount is ${effectiveAmount}/3 (per dimension: ${praisePerDim} praise + ${suggPerDim} suggestion).
9. Show ALL feedback at once. The student will see everything in one go.
10. CRITICAL — NEVER mark a correctly spelled word as a spelling error. Only mark words that are ACTUALLY misspelled or have ACTUAL grammar errors. If a word is spelled correctly, do NOT create a spelling annotation for it. Double-check every spelling annotation before including it.
11. ⚠️ MANDATORY — NON-NEGOTIABLE DIMENSION COVERAGE ⚠️
   For EVERY active VCOP dimension (${dimensions.map(d => `${VCOP_EMOJIS[d]}${d}`).join(", ")}), you MUST return AT LEAST one "praise" annotation AND AT LEAST one "suggestion" annotation. NEVER leave any active dimension empty. This is non-negotiable.
   AMOUNT GUIDE: Per dimension: ${praisePerDim} praise(s) + ${suggPerDim} suggestion(s).${effectiveAmount === 1 ? " Keep it focused — exactly 1 praise and 1 suggestion per dimension." : effectiveAmount === 2 ? " Give 1-2 of each per dimension for moderate detail." : " Give 2-3 of each per dimension for thorough, detailed feedback. Level 3 = MOST detailed — do NOT give fewer annotations than lower levels."}

12. ⚠️ FEEDBACK QUALITY RULES — EVERY annotation must pass this test:
   (a) Every "praise" MUST name a specific technique (e.g. "Level 2 connective", "A (Adverb) opener", "WOW word", "parenthesis") and explain WHY it improves the writing. Vague praise like "Keep practising!" or "Good job!" will be REJECTED.
   (b) Every "suggestion" MUST identify a specific problem, name the technique to fix it, and provide a concrete rewritten example using the student's own words. Vague suggestions like "Try more punctuation" or "Use better vocabulary" will be REJECTED.

${dimensions.includes("P") ? `13. PUNCTUATION ANALYSIS CHECKLIST — work through these IN ORDER before writing P annotations:
   (a) Full stops & capitals: Are sentence boundaries correct? Any run-on sentences or comma splices? (If yes → grammar annotation, NOT praise)
   (b) Run-on sentences: Find the longest sentence. Does it need breaking up? Where exactly should it be split? (If yes → suggestion with exact split point)
   (c) Commas: Used in lists? After ISPACED openers (-ly, -ing, -ed, prepositional)? In embedded clauses? (If good → praise naming "comma after opener" or "comma in list")
   (d) Question marks & exclamation marks: Used correctly? (If yes → praise)
   (e) Advanced punctuation: Any speech marks, apostrophes for possession, dashes, brackets/parenthesis, colons, semicolons, ellipsis? (If yes → praise naming the specific technique and its Punctuation Pyramid level. If no → suggestion to try one, with a concrete example from their text)
   PUNCTUATION PRAISE STANDARDS:
   - Full stops at sentence ends are BASIC and EXPECTED — do NOT praise them.
   - If the student's punctuation has NO noteworthy examples beyond basic full stops, do NOT invent weak praise. Instead, provide TWO suggestion annotations for P — one simple (e.g. adding commas) and one more advanced (e.g. trying a colon or dash).
` : ""}${dimensions.includes("V") ? `${dimensions.includes("P") ? "14" : "13"}. VOCABULARY ANALYSIS CHECKLIST — work through these before writing V annotations:
   (a) Dead words: Scan for overused words (nice, good, bad, said, went, big, happy, sad, like). Each one found → potential suggestion to upgrade with a WOW word from the appropriate tier.
   (b) Repeated words: Any word used 3+ times? (If yes → suggestion to vary with synonyms)
   (c) WOW words already used: Any ambitious vocabulary choices? (If yes → praise naming the word, its WOW tier level, and what it does better than the "dead" alternative)
   (d) Sensory language: Any descriptions using sight, sound, smell, taste, touch? (If yes → praise. If no → suggestion to add sensory detail to a specific sentence)
` : ""}${dimensions.includes("C") ? `${dimensions.includes("P") && dimensions.includes("V") ? "15" : dimensions.includes("P") || dimensions.includes("V") ? "14" : "13"}. CONNECTIVES ANALYSIS CHECKLIST — work through these before writing C annotations:
   (a) Count different connectives used and identify their levels (Level 1: and/but/so, Level 2: because/when/if, Level 3: while/until, Level 4: although/however/nevertheless, Level 5+: despite/consequently)
   (b) "And" chains: Any sentences chaining "and...and...and"? (If yes → suggestion to upgrade one to a higher-level connective, with rewritten example)
   (c) Highest-level connective used: Praise it, naming its exact level.
   (d) Missing connective levels: If student only uses Level 1-2, suggest trying a specific Level 3-4 connective with a rewritten example.
` : ""}${dimensions.includes("O") ? `${[dimensions.includes("P"), dimensions.includes("V"), dimensions.includes("C")].filter(Boolean).length + 13}. OPENERS ANALYSIS CHECKLIST — work through these before writing O annotations:
   (a) List the first word of every sentence. How many DIFFERENT ISPACED types are used? (Count: I=___, S=___, P=___, A=___, C=___, E=___, D=___)
   (b) Consecutive same openers: Do 2+ sentences in a row start the same way (e.g. "I...", "I...", "I...")? (If yes → suggestion to rewrite one with a specific ISPACED type)
   (c) ISPACED openers found: Praise each one, naming the ISPACED letter.
   (d) Comma after opener: Check every -ly, -ing, -ed, and prepositional opener — is there a comma? (If missing → grammar annotation)
   (e) If fewer than 3 ISPACED types used → suggestion to try a new type with a concrete rewritten example.
` : ""}

⚠️ MANDATORY PRE-OUTPUT CHECKLIST — DO NOT SKIP:
${dimensions.map(d => `- ${VCOP_EMOJIS[d]}${d}: has ${minPraise}-${maxPraise} praise(s)? __ has ${minSugg}-${maxSugg} suggestion(s)? __`).join("\n")}
STOP. Count annotations for each dimension. You need ${praisePerDim} praise(s) and ${suggPerDim} suggestion(s) PER dimension. Total VCOP annotations should be ${dimCount * (minPraise + minSugg)}-${dimCount * (maxPraise + maxSugg)}, plus spelling/grammar. Grand total: ${minAnnotations}-${maxAnnotations}.
${effectiveAmount >= 2 ? `⚠️ AMOUNT IS ${effectiveAmount}/3 — you MUST give MORE than 1 per dimension. Giving only 1 praise + 1 suggestion per dimension is NOT ENOUGH at this amount level. Find MULTIPLE things to praise and MULTIPLE things to suggest for each dimension.` : ""}

You MUST respond with ONLY valid JSON in this exact format, no other text:
{
  "annotations": [
    { "phrase": "becuase", "suggestion": "because", "type": "spelling" },
    { "phrase": "i", "suggestion": "I", "type": "grammar" },
${dimensions.map(d => {
  const examples = [];
  for (let i = 0; i < maxSugg; i++) {
    examples.push(`    { "phrase": "exact text from student", "suggestion": "Name the technique + explain + give rewritten example", "type": "suggestion", "dimension": "${d}" }`);
  }
  for (let i = 0; i < maxPraise; i++) {
    examples.push(`    { "phrase": "exact text from student", "suggestion": "Name the technique + explain WHY it's good", "type": "praise", "dimension": "${d}" }`);
  }
  return examples.join(",\n");
}).join(",\n")}
  ]
}`;

  return prompt;
}

function buildProfileContext(profile) {
  if (!profile) return "";

  // Trim teacherNotes to last 3
  if (profile.teacherNotes?.length > 3) {
    profile.teacherNotes = profile.teacherNotes.slice(-3);
  }

  return JSON.stringify(profile, null, 2);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text, sessionId, studentId, vcopFocus, topic, extraInstructions, feedbackMode, feedbackLevel, feedbackAmount, submissionId: existingSubmissionId, iterationNumber, previousText, previousAnnotations } = req.body || {};

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "Please provide some writing to analyse." });
  }

  try {
    const currentIteration = iterationNumber || 1;

    // Fetch student profile for personalised feedback context
    let studentProfile = "";
    if (studentId && currentIteration === 1) {
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

    const systemPrompt = buildSystemPrompt(vcopFocus, topic, extraInstructions, feedbackMode, currentIteration, previousText, previousAnnotations, studentId, feedbackLevel, studentProfile, feedbackAmount);

    console.log(`[ANALYZE] studentId=${studentId}, feedbackLevel=${feedbackLevel}, feedbackAmount=${feedbackAmount}, iteration=${currentIteration}, promptLength=${systemPrompt.length}`);

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: (feedbackLevel || 1) >= 3 ? 4096 : 2048,
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
    // Extract only the JSON object — AI sometimes appends commentary after the closing }
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
    const parsed = JSON.parse(content);
    const rawAnnotations = parsed.annotations || [];

    // Log annotation counts by type and dimension
    const typeCounts = {};
    for (const a of rawAnnotations) {
      const key = a.dimension ? `${a.type}:${a.dimension}` : a.type;
      typeCounts[key] = (typeCounts[key] || 0) + 1;
    }
    console.log(`[ANALYZE] Raw annotations: ${rawAnnotations.length}, breakdown:`, JSON.stringify(typeCounts));
    console.log(`[ANALYZE] stop_reason=${message.stop_reason}, output_tokens=${message.usage?.output_tokens}`);

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
