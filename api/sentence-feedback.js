import Anthropic from "@anthropic-ai/sdk";
import { MODEL_ID } from "./_config.js";
import { checkContentSafety } from "./_content-safety.js";
import {
  getSystemPromptForScore,
  getScaffoldingLevel,
  HINT_GENERATION_PROMPT,
} from "./_scaffolding-prompts.js";

const client = new Anthropic();

// ============================================================
// Build the user message for sentence feedback
// ============================================================
function buildSentenceFeedbackMessage(params) {
  const {
    sentence,
    essaySoFar,
    currentSection,
    sectionPrompt,
    genre,
    vcopFocus,
    yearGroup,
    showHint,
    sentenceIndex,
    openersSoFar,
    previousFeedback,
  } = params;

  const essayContext = essaySoFar && essaySoFar.length > 0
    ? `\nStory so far:\n${essaySoFar.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
    : "";

  const openerContext = openersSoFar && openersSoFar.length > 0
    ? `\nSentence openers used so far: ${openersSoFar.join(", ")}`
    : "";

  const prevFeedback = previousFeedback
    ? `\nYour previous feedback on this sentence: "${previousFeedback}"`
    : "";

  const hintInstruction = showHint
    ? `\n\nIMPORTANT: The student has asked for help. Include "hintWords" in your response — exactly 3 words or short phrases that could improve this sentence. Each hint should be a single word or very short phrase (2-3 words max).`
    : "";

  const focusDims = vcopFocus && vcopFocus.length > 0
    ? `\nVCOP dimensions to focus on: ${vcopFocus.join(", ")}`
    : "";

  return `Section: ${currentSection} (${sectionPrompt || ""})
Genre: ${genre || "narrative"}
Year group: ${yearGroup || "Y5"}
Sentence #${(sentenceIndex || 0) + 1} in this section
${focusDims}
${essayContext}
${openerContext}
${prevFeedback}

The student wrote this sentence:
"${sentence}"

Give ONE piece of feedback. Start with encouragement, then ONE specific suggestion if needed.
Check for spelling errors and grammar errors too.
${hintInstruction}

Respond with ONLY valid JSON:
{
  "feedback": "Your ONE comment — encouraging first, then suggestion",
  "vcopCategory": "vocabulary" or "connectives" or "openers" or "punctuation" or "spelling" or "grammar" or "structure" or null,
  "spellingCorrection": null or { "wrong": "misspeled", "right": "misspelled" },
  "grammarCorrection": null or { "wrong": "i was", "right": "I was" },
  "encouragement": "Brief progress note",
  "hintWords": null or [{ "word": "magnificent", "context": "to describe the castle" }, ...]
}`;
}

// ============================================================
// JSON parsing (reuse pattern from analyze.js)
// ============================================================
function parseAIResponse(content) {
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
      else if (content[i] === "}") {
        depth--;
        if (depth === 0) { lastBrace = i; break; }
      }
    }
    if (lastBrace !== -1) {
      content = content.slice(firstBrace, lastBrace + 1);
    }
  }

  try {
    return JSON.parse(content);
  } catch (parseErr) {
    // Try fixing common JSON issues
    const fixed = content
      .replace(/,\s*([\]}])/g, "$1")
      .replace(/,\s*$/, "");
    try {
      return JSON.parse(fixed);
    } catch {
      throw new Error("Could not parse AI response. Please try again.");
    }
  }
}

// ============================================================
// MAIN HANDLER
// ============================================================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    sentence,
    essaySoFar,
    currentSection,
    sectionPrompt,
    genre,
    scaffoldingScore,
    vcopFocus,
    yearGroup,
    showHint,
    sentenceIndex,
    openersSoFar,
    previousFeedback,
  } = req.body || {};

  // Input validation
  if (!sentence || typeof sentence !== "string" || sentence.trim().length === 0) {
    return res.status(400).json({ error: "Please write a sentence first." });
  }

  if (sentence.length > 500) {
    return res.status(400).json({ error: "Sentence is too long. Please keep it shorter." });
  }

  // Content safety
  const safety = checkContentSafety(sentence, "sentence-feedback");
  if (safety.shouldBlock) {
    return res.status(400).json({ error: "Your message couldn't be processed. Please try rephrasing." });
  }

  try {
    const score = scaffoldingScore || 1.0;
    const systemPrompt = getSystemPromptForScore(score);
    const level = getScaffoldingLevel(score);

    // Add hint prompt if needed
    const fullSystemPrompt = showHint
      ? `${systemPrompt}\n\n${HINT_GENERATION_PROMPT}`
      : systemPrompt;

    const userMessage = buildSentenceFeedbackMessage({
      sentence,
      essaySoFar,
      currentSection,
      sectionPrompt,
      genre,
      vcopFocus,
      yearGroup,
      showHint,
      sentenceIndex,
      openersSoFar,
      previousFeedback,
    });

    console.log(`[SENTENCE-FEEDBACK] section=${currentSection}, level=${level}, score=${score}, showHint=${!!showHint}, sentenceLen=${sentence.length}`);

    const message = await client.messages.create({
      model: MODEL_ID,
      max_tokens: 800,
      system: fullSystemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const content = message.content[0].text.trim();
    const parsed = parseAIResponse(content);

    console.log(`[SENTENCE-FEEDBACK] stop_reason=${message.stop_reason}, output_tokens=${message.usage?.output_tokens}`);

    return res.status(200).json({
      feedback: parsed.feedback || "Well done for writing that sentence!",
      vcopCategory: parsed.vcopCategory || null,
      spellingCorrection: parsed.spellingCorrection || null,
      grammarCorrection: parsed.grammarCorrection || null,
      encouragement: parsed.encouragement || "Keep going!",
      hintWords: showHint ? (parsed.hintWords || null) : null,
    });
  } catch (err) {
    console.error("Sentence feedback error:", err?.status, err?.message);

    if (err?.status === 401) {
      return res.status(500).json({ error: "API key is missing or invalid." });
    }
    return res.status(500).json({
      error: err?.message || "Something went wrong. Please try again.",
    });
  }
}
