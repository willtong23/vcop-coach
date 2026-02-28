import Anthropic from "@anthropic-ai/sdk";
import { VCOP_GRADING_KNOWLEDGE } from "./vcop-knowledge.js";

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

  return `You are an experienced UK primary/secondary English teacher assessing a student's writing level using the Oxford Writing Criterion Scale (OWCS) from the Big Writing methodology.

${yearContext}

${VCOP_GRADING_KNOWLEDGE}

IMPORTANT: Grade the writing at its ACTUAL level, NOT the student's year group. A Y4 student can write at Standard 6. A Y6 student can write at Standard 2. Be honest and accurate. Base your assessment on what is CONSISTENTLY demonstrated throughout the writing.

Respond with ONLY valid JSON, no other text:
{
  "level": "Standard 4",
  "reason": "One sentence explaining why, referencing specific VCOP evidence from the writing"
}

The "level" should use the Oxford scale: "Standard 1", "Standard 2", ..., "Standard 7".
The "reason" should be ONE short sentence (under 30 words), citing specific evidence from the writing (e.g. which connectives, openers, punctuation, vocabulary choices).`;
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
