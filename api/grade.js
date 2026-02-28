import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

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

function buildGradingPrompt(actualYear) {
  const yearContext = actualYear
    ? `The student is currently in ${actualYear.label} (Year ${actualYear.year}).`
    : "The student's actual year level is unknown.";

  return `You are an experienced UK primary/secondary English teacher assessing a student's writing level against the English National Curriculum standards.

${yearContext}

UK NATIONAL CURRICULUM WRITING EXPECTATIONS BY YEAR:
- Y1-2: Simple sentences, basic phonics spelling, capital letters and full stops, "and" as main connective
- Y3: Paragraphs emerging, varied connectives (but, so, because), some adjectives, mostly correct basic punctuation
- Y4: Basic sentence structure correct, consistent full stops and capitals, simple connectives (and, but, because, so), beginning to use varied sentence openers
- Y5: Organised paragraphs, varied sentence openers (time, -ing, adverb), expanding vocabulary with some ambitious words, using commas in lists and after fronted adverbials
- Y6: Tone control, complex sentences (relative clauses, subordinate clauses), precise and varied vocabulary, semicolons/colons/dashes, cohesive paragraphs
- Y7-8: Sophisticated vocabulary, deliberate stylistic choices, controlled varied sentence structures for effect, confident use of all punctuation, clear authorial voice
- Y9+: Nuanced tone and voice, advanced rhetorical techniques, masterful control of language for purpose and audience

IMPORTANT: Grade the writing at its ACTUAL level, NOT the student's year group. A Y4 student can write at Y7 level. A Y6 student can write at Y3 level. Be honest and accurate.

Respond with ONLY valid JSON, no other text:
{
  "level": "Y5",
  "reason": "One sentence explaining why this level, referencing specific evidence from the writing"
}

The "level" should be like "Y3", "Y4", "Y5", "Y6", "Y7-8", or "Y9+" etc.
The "reason" should be ONE short sentence (under 25 words), citing specific evidence from the writing.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text, studentId } = req.body || {};

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "No text provided." });
  }

  try {
    const actualYear = getActualYear(studentId);
    const systemPrompt = buildGradingPrompt(actualYear);

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Grade this student's writing:\n\n${text}`,
        },
      ],
    });

    let content = message.content[0].text.trim();
    if (content.startsWith("```")) {
      content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(content);

    return res.status(200).json({
      level: parsed.level || "Unknown",
      reason: parsed.reason || "",
      actualYear: actualYear?.label || null,
    });
  } catch (err) {
    console.error("Grading API error:", err?.status, err?.message);
    return res.status(500).json({ error: err?.message || "Failed to grade writing." });
  }
}
