import Anthropic from "@anthropic-ai/sdk";
import { MODEL_ID } from "./_config.js";
import { checkContentSafety } from "./_content-safety.js";
import { SECTION_CHECK_SYSTEM_PROMPT } from "./_scaffolding-prompts.js";

const client = new Anthropic();

// ============================================================
// JSON parsing helper
// ============================================================
function parseAIResponse(content) {
  if (content.startsWith("```")) {
    content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
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
  } catch {
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
    sectionSentences,
    sectionName,
    essaySoFar,
    genre,
    yearGroup,
    vcopFocus,
  } = req.body || {};

  // Input validation
  if (!sectionSentences || !Array.isArray(sectionSentences) || sectionSentences.length === 0) {
    return res.status(400).json({ error: "No sentences provided for section check." });
  }

  if (!sectionName || typeof sectionName !== "string") {
    return res.status(400).json({ error: "Section name is required." });
  }

  // Content safety check on all sentences
  const allText = sectionSentences.join(" ");
  const safety = checkContentSafety(allText, "section-check");
  if (safety.shouldBlock) {
    return res.status(400).json({ error: "Your message couldn't be processed. Please try rephrasing." });
  }

  try {
    const essayContext = essaySoFar && essaySoFar.length > 0
      ? `\nFull story so far:\n${essaySoFar.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
      : "";

    const focusDims = vcopFocus && vcopFocus.length > 0
      ? `\nVCOP focus: ${vcopFocus.join(", ")}`
      : "";

    const userMessage = `Section: ${sectionName}
Genre: ${genre || "narrative"}
Year group: ${yearGroup || "Y5"}
${focusDims}
${essayContext}

This section's sentences:
${sectionSentences.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Review this section and respond with ONLY valid JSON.`;

    console.log(`[SECTION-CHECK] section=${sectionName}, sentences=${sectionSentences.length}, yearGroup=${yearGroup}`);

    const message = await client.messages.create({
      model: MODEL_ID,
      max_tokens: 512,
      system: SECTION_CHECK_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const content = message.content[0].text.trim();
    const parsed = parseAIResponse(content);

    console.log(`[SECTION-CHECK] stop_reason=${message.stop_reason}, action=${parsed.suggestedAction}`);

    return res.status(200).json({
      sectionFeedback: parsed.sectionFeedback || "Good work on this section!",
      suggestedAction: parsed.suggestedAction === "revise" ? "revise" : "accept",
      focusSentence: typeof parsed.focusSentence === "number" ? parsed.focusSentence : null,
    });
  } catch (err) {
    console.error("Section check error:", err?.status, err?.message);

    if (err?.status === 401) {
      return res.status(500).json({ error: "API key is missing or invalid." });
    }
    return res.status(500).json({
      error: err?.message || "Something went wrong. Please try again.",
    });
  }
}
