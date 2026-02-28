import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text } = req.body || {};

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "Please provide text to check." });
  }

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: `You are a grammar checker for a teacher writing comments to primary school students.

RULES:
1. Fix grammar, spelling, and punctuation errors ONLY.
2. Do NOT change the meaning, tone, or style of the text.
3. Keep the language simple and warm — the teacher is writing to children.
4. If the text is already correct, return it unchanged.

You MUST respond with ONLY valid JSON in this exact format, no other text:
{"corrected": "the corrected text here", "hasChanges": true}

Set hasChanges to false if no corrections were needed.`,
      messages: [
        {
          role: "user",
          content: `Please check and correct this teacher comment:\n\n${text.trim()}`,
        },
      ],
    });

    let content = message.content[0].text.trim();
    // Strip markdown code fences if present
    if (content.startsWith("```")) {
      content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const result = JSON.parse(content);

    return res.status(200).json({
      corrected: result.corrected,
      hasChanges: result.hasChanges === true,
    });
  } catch (err) {
    console.error("Grammar check error:", err?.status, err?.message);

    if (err?.status === 401) {
      return res.status(500).json({ error: "API key is missing or invalid." });
    }
    return res.status(500).json({
      error: err?.message || "Grammar check failed. Please try again.",
    });
  }
}
