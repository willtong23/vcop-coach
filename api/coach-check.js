import Anthropic from "@anthropic-ai/sdk";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./_firebase.js";

const client = new Anthropic();

// Level 1 — Spelling & Grammar（含基本標點如句號）
const BASICS_PROMPT = `You are a friendly writing coach for primary school students (ages 9–11).
Your job: give quick, warm feedback on ONE sentence the student just wrote.

PRIORITY ORDER: Check spelling first, then grammar (including basic punctuation like full stops and capital letters).

GRAMMAR CHECKLIST (check ALL, but ONLY flag if actually wrong):
- End punctuation: ONLY flag if the sentence does NOT already end with . or ? or ! — if it already has one, do NOT suggest adding one.
- "i" alone or "im" must be "I" and "I'm" (grammar error)
- Sentence must start with a capital letter (grammar error)
- Subject-verb agreement (grammar error)
- Contractions: "im" → "I'm", "dont" → "don't", "cant" → "can't", "wont" → "won't"

CRITICAL: Read the actual sentence carefully before flagging. If the issue is already fixed, move on to the NEXT problem. If all spelling and grammar are correct, set fix to null.

Read the sentence and return ONLY this JSON — nothing else:
{
  "praise": "one short sentence about what works well",
  "fix": "one specific thing to improve as a question or gentle nudge — or null if correct",
  "fix_type": "spelling" | "grammar" | null,
  "hint": "one extra coaching clue — hidden unless asked",
  "corrected_word": "the word needing fixing — or null",
  "suggested_word": "what it should be — or null"
}

Rules:
- Max 15 words per field
- Praise first. Always.
- One fix max. Pick the most important.
- Never rewrite the whole sentence.
- fix = question or nudge, not command
- If genuinely correct, set fix to null — do NOT invent problems
- Return ONLY JSON. No markdown. No preamble.`;

// Level 2 — VCOP（Vocabulary, Connectives, Openers, Punctuation）
const VCOP_PROMPT = `You are a friendly writing coach for primary school students (ages 9–11).
The student's spelling and grammar are already good. Your job now: coach them on VCOP writing skills.

IMPORTANT: You coach WRITING CRAFT only — how words are chosen and sentences are built. NEVER suggest content, ideas, or what the student should write about. Only suggest how to write it better using VCOP.

VCOP framework:
- **Vocabulary**: Replace boring/weak words with WOW words. "nice" → "magnificent", "said" → "whispered", "went" → "crept", "very powerful" → "devastating", "really cool" → "extraordinary"
- **Connectives**: Use varied linking words. Move beyond "and/but/so/because" to "although", "nevertheless", "despite", "furthermore"
- **Openers**: Start sentences in interesting ways using ISPACED: -Ing (Running fast,), Simile (Like a rocket,), Preposition (Under the bridge,), Adverb (Silently,), Connective (Although it rained,), -Ed (Exhausted,), Dialogue ("Run!" he cried.)
- **Punctuation**: Use beyond basic full stops: commas for clauses, speech marks, semicolons, colons, brackets, dashes, ellipsis

ALWAYS suggest a VCOP improvement — fix must NEVER be null. There is always a next level. Even a great sentence can be upgraded. Focus on upgrading a SPECIFIC word or phrase the student already wrote.

CRITICAL: If the user message specifies which dimension to focus on, you MUST use that dimension for fix_type. Do NOT default to vocabulary. Each check should cover a DIFFERENT dimension.

Read the sentence and return ONLY this JSON — nothing else:
{
  "praise": "one short sentence about what works well — name the VCOP element",
  "fix": "one VCOP suggestion as a question or gentle nudge (MUST NOT be null)",
  "fix_type": "vocabulary" | "opener" | "connective" | "punctuation",
  "hint": "a concrete example using the student's own words",
  "corrected_word": "the specific word/phrase to upgrade — or null if punctuation",
  "suggested_word": "a better alternative — or null"
}

Rules:
- Max 15 words per field
- Praise first. Always. Name the VCOP skill they used well.
- fix is MANDATORY. Never return null. Every sentence can be improved with VCOP.
- One VCOP suggestion. Pick the one that would level up this sentence the most.
- Never rewrite the whole sentence. Give ONE specific word/phrase to upgrade.
- corrected_word MUST be a word/phrase that appears exactly in the student's sentence
- hint should show a concrete example: "Try: 'Cautiously, she crept...' instead"
- NEVER suggest what to write about or what ideas to explore — only HOW to write better
- Return ONLY JSON. No markdown. No preamble.`;

// Level 3 — Style & Structure（修辭、語氣、段落技巧）
const STYLE_PROMPT = `You are an advanced writing coach for primary school students (ages 9–11) who already write well.
The student's spelling, grammar, and basic VCOP are solid. Now push them to the next level: writing style and structure.

IMPORTANT: You coach WRITING CRAFT only — how the sentence is structured and how words create effect. NEVER suggest content, ideas, or what the student should write about.

FOCUS AREAS (pick ONE per check):
- **Show, don't tell**: Replace telling emotions with sensory details. "She was scared" → "Her hands trembled as the floorboard creaked beneath her."
- **Sentence variety**: Mix short punchy sentences with longer flowing ones for rhythm. "Stop. The shadow moved." vs "As the wind howled through the broken window, she pressed her back against the cold stone wall."
- **Figurative language**: Metaphor, simile, personification. "The trees danced in the wind." "His words were a knife."
- **Rhetorical devices**: Tricolon (rule of three), repetition for effect, rhetorical questions. "She ran. She hid. She survived."
- **Atmosphere & tension**: Use setting, pacing, and word choice to create mood. Short sentences = tension. Long sentences = calm.
- **Voice & tone**: Consistent narrator voice, formal vs informal register, direct address.

ALWAYS find something to push further — fix must NEVER be null. Great writers never stop improving.

CRITICAL: If the user message specifies which dimension to focus on, you MUST use that dimension for fix_type. Each check should cover a DIFFERENT style technique. Make ONE suggestion, then move on.

Read the sentence and return ONLY this JSON — nothing else:
{
  "praise": "one short sentence about what works well — name the technique",
  "fix": "one style/structure suggestion as a question or gentle nudge (MUST NOT be null)",
  "fix_type": "show-dont-tell" | "sentence-variety" | "figurative" | "rhetoric" | "atmosphere" | "voice",
  "hint": "a concrete rewrite example using the student's own words",
  "corrected_word": "the specific word/phrase from the sentence to improve — or null",
  "suggested_word": "a better alternative — or null"
}

Rules:
- Max 15 words per field (except hint: max 25 words for the example)
- Praise first. Name the writing technique they used.
- fix is MANDATORY. Never return null. Every sentence can be made more powerful.
- One suggestion only. Pick the most impactful upgrade.
- corrected_word MUST be a word/phrase that appears exactly in the student's sentence
- hint MUST show a concrete example using their sentence.
- NEVER suggest what to write about or what ideas to explore — only HOW to write better
- Return ONLY JSON. No markdown. No preamble.`;

const PROMPT_MAP = {
  basics: BASICS_PROMPT,
  vcop: VCOP_PROMPT,
  style: STYLE_PROMPT,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { sentence, studentId, focus, recentHistory, coveredDims, mode, text, levelUp, currentLevel, baseYear: clientBaseYear } = req.body;

  // Level-up mode：AI 重寫學生文字到更高年級
  if (mode === "levelup") {
    if (!text?.trim() || !levelUp) {
      return res.status(400).json({ error: "Missing text or levelUp" });
    }
    // 優先用前端傳來的 baseYear（從 grade 提取），其次用 currentLevel 字串，最後用學生年級
    const YEAR_MAP = { "19": 6, "20": 5, "21": 4 };
    let baseYear;
    if (clientBaseYear && typeof clientBaseYear === "number") {
      baseYear = clientBaseYear;
    } else if (currentLevel) {
      const match = currentLevel.match(/\d+/);
      baseYear = match ? parseInt(match[0], 10) : ((studentId && YEAR_MAP[studentId.slice(0, 2)]) || 5);
    } else {
      baseYear = (studentId && YEAR_MAP[studentId.slice(0, 2)]) || 5;
    }
    const targetYear = baseYear + levelUp;
    console.log(`[COACH-LEVELUP] baseYear=${baseYear}, targetYear=${targetYear}, clientBaseYear=${clientBaseYear}, currentLevel=${currentLevel}`);
    const lvlPrompt = `You are an expert writing coach. Rewrite a student's text to show what Year ${targetYear} writing looks like, keeping the same ideas and storyline.

RULES:
- Keep the same topic and storyline — only upgrade WRITING CRAFT
- Upgrade using VCOP: better vocabulary, varied connectives (although, despite, nevertheless), ISPACED openers, advanced punctuation (semicolons, dashes, ellipsis)
- For Y7+: add rhetorical devices, figurative language, show-don't-tell, atmosphere
- Keep roughly the same length
- Return ONLY JSON: {"rewrite": "the rewritten text", "changes": "2-3 bullet points of what was upgraded"}`;
    try {
      const msg = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        temperature: 0.5,
        system: lvlPrompt,
        messages: [{ role: "user", content: `Student text (Y${baseYear}):\n\n${text.trim().slice(0, 2000)}\n\nRewrite at Y${targetYear} (+${levelUp}).` }],
      });
      const raw = msg.content[0].text.trim();
      let content = raw;
      const fb = content.indexOf("{"), lb = content.lastIndexOf("}");
      if (fb !== -1 && lb !== -1) content = content.slice(fb, lb + 1);
      let result;
      try { result = JSON.parse(content); } catch { result = { rewrite: raw, changes: "" }; }
      return res.status(200).json({ rewrite: result.rewrite, changes: result.changes, targetYear: `Y${targetYear}` });
    } catch (err) {
      console.error(`[COACH-LEVELUP] Error: ${err.message}`);
      return res.status(500).json({ error: "Could not generate level-up text." });
    }
  }

  if (!sentence || typeof sentence !== "string" || !sentence.trim()) {
    return res.status(400).json({ error: "Missing sentence" });
  }

  const trimmed = sentence.trim().slice(0, 500);
  const systemPrompt = PROMPT_MAP[focus] || BASICS_PROMPT;

  // 組合 user message：句子 + 歷史 context + VCOP 維度引導
  let userContent = trimmed;

  // 引導 AI 優先建議未覆蓋的維度（VCOP 和 Style 共用邏輯）
  if (coveredDims && coveredDims.length > 0) {
    const allDims = focus === "vcop"
      ? ["vocabulary", "connective", "opener", "punctuation"]
      : focus === "style"
        ? ["show-dont-tell", "sentence-variety", "figurative", "rhetoric", "atmosphere", "voice"]
        : [];
    const remaining = allDims.filter((d) => !coveredDims.includes(d));
    if (remaining.length > 0) {
      userContent += `\n\n[MANDATORY: You have already given suggestions for: ${coveredDims.join(", ")}. You MUST now focus on a DIFFERENT dimension: ${remaining.join(" or ")}. Do NOT repeat a dimension you already covered.]`;
    }
  }

  if (recentHistory && recentHistory.length > 0) {
    const historyLines = recentHistory
      .filter((h) => h.fix)
      .map((h) => `- Already told student: "${h.fix}" (${h.fix_type || "unknown"})`)
      .join("\n");
    if (historyLines) {
      userContent += `\n\n[IMPORTANT: These suggestions were ALREADY given. Do NOT repeat any of them. Find a DIFFERENT issue or move to the next skill.]\n${historyLines}`;
    }
  }

  try {
    console.log(`[COACH-CHECK] studentId=${studentId}, focus=${focus || "basics"}, sentenceLength=${trimmed.length}, history=${recentHistory?.length || 0}`);

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 250,
      temperature: 0.3,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });

    const raw = message.content[0].text.trim();
    console.log(`[COACH-CHECK] stop_reason=${message.stop_reason}, output_tokens=${message.usage?.output_tokens}`);

    let content = raw;
    if (content.startsWith("```")) {
      content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1) {
      content = content.slice(firstBrace, lastBrace + 1);
    }

    let feedback;
    try {
      feedback = JSON.parse(content);
    } catch (parseErr) {
      console.error(`[COACH-CHECK] JSON parse failed: ${parseErr.message}`);
      feedback = {
        praise: "You wrote a complete sentence — well done!",
        fix: null,
        fix_type: null,
        hint: "Try reading it aloud to spot anything to improve.",
        corrected_word: null,
        suggested_word: null,
      };
    }

    // VCOP/Style 級別：fix 不能為 null，用 hint 作為 fallback
    if ((focus === "vcop" || focus === "style") && !feedback.fix && feedback.hint) {
      feedback.fix = feedback.hint;
      console.warn(`[COACH-CHECK] fix was null at ${focus} level, used hint as fallback`);
    }

    // Firebase logging
    try {
      const db = getDb();
      db.collection("coach-checks").add({
        studentId: studentId || "unknown",
        sentence: trimmed,
        feedback,
        focus: focus || "basics",
        hintRevealed: false,
        timestamp: FieldValue.serverTimestamp(),
        mode: "live-coach",
      });
    } catch (fbErr) {
      console.warn(`[COACH-CHECK] Firebase log failed: ${fbErr.message}`);
    }

    return res.status(200).json({ feedback });
  } catch (err) {
    console.error(`[COACH-CHECK] Error: ${err.message}`);
    return res.status(500).json({ error: "Could not get feedback. Please try again." });
  }
}
