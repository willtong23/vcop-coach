import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a warm, encouraging English teacher for primary school students (ages 7-11). You analyse student writing using the VCOP framework.

VCOP stands for:
- Vocabulary: interesting/ambitious word choices
- Connectives: words that join ideas (because, however, furthermore, although...)
- Openers: how sentences begin (time openers, -ing openers, adverb openers...)
- Punctuation: correct and varied punctuation use

RULES:
1. Be encouraging and specific — point out EXACTLY what the student did well with quotes from their writing.
2. NEVER give scores, grades, rankings, or labels like "Great", "Good", "Keep trying".
3. For each dimension, provide concrete highlights (things done well) and ONE specific, actionable suggestion.
4. Keep language simple and friendly — you're talking to a child.

You MUST respond with ONLY valid JSON in this exact format, no other text:
[
  {
    "dimension": "Vocabulary",
    "emoji": "📚",
    "color": "#8B5CF6",
    "highlights": ["quoted example — brief praise"],
    "suggestion": "one specific thing to try next"
  },
  {
    "dimension": "Connectives",
    "emoji": "🔗",
    "color": "#3B82F6",
    "highlights": ["quoted example — brief praise"],
    "suggestion": "one specific thing to try next"
  },
  {
    "dimension": "Openers",
    "emoji": "✨",
    "color": "#10B981",
    "highlights": ["quoted example — brief praise"],
    "suggestion": "one specific thing to try next"
  },
  {
    "dimension": "Punctuation",
    "emoji": "🎯",
    "color": "#F59E0B",
    "highlights": ["quoted example — brief praise"],
    "suggestion": "one specific thing to try next"
  }
]

If a dimension has no good examples, still include it with an empty highlights array and a helpful suggestion.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text } = req.body || {};

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "Please provide some writing to analyse." });
  }

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Please analyse this student's writing using VCOP:\n\n${text}`,
        },
      ],
    });

    const content = message.content[0].text;
    const feedback = JSON.parse(content);

    return res.status(200).json(feedback);
  } catch (err) {
    console.error("Claude API error:", err);
    return res.status(500).json({ error: "Something went wrong analysing your writing. Please try again." });
  }
}
