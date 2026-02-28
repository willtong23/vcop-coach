import Anthropic from "@anthropic-ai/sdk";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./_firebase.js";

const client = new Anthropic();

const EMPTY_PROFILE = {
  lastUpdated: null,
  totalSubmissions: 0,
  vcop: {
    vocabulary: { level: 1, strengths: [], weaknesses: [], recentWowWords: [] },
    connectives: { level: 1, highestUsed: "", pattern: "" },
    openers: { ispacedUsed: [], ispacedNeverUsed: ["I", "S", "P", "A", "C", "E", "D"], pattern: "" },
    punctuation: { level: 1, mastered: [], emerging: [], notYet: [] },
  },
  spellingPatterns: [],
  grammarPatterns: [],
  personalInstructions: "",
  teacherNotes: [],
  growthNotes: [],
};

function buildProfileUpdatePrompt(currentProfile, annotations, sessionTopic) {
  return `You are an educational data analyst. Your job is to update a student's learning profile based on their latest writing submission feedback.

CURRENT STUDENT PROFILE:
${JSON.stringify(currentProfile, null, 2)}

THIS SESSION'S ANNOTATIONS (from AI feedback on the student's writing):
${JSON.stringify(annotations, null, 2)}

SESSION TOPIC: ${sessionTopic || "Not specified"}

YOUR TASK:
Analyze the annotations and update the student profile. Return the updated profile as JSON.

RULES:
1. VCOP LEVELS (1-5 scale):
   - Level 1: Basic (simple connectives, no openers, basic punctuation)
   - Level 2: Developing (some variety, Level 2 connectives, 1-2 ISPACED types)
   - Level 3: Secure (good variety, Level 3-4 connectives, 3+ ISPACED types, commas/exclamation marks)
   - Level 4: Advanced (sophisticated choices, Level 4+ connectives, 5+ ISPACED types, semicolons/colons)
   - Level 5: Exceptional (masterful, Level 5 connectives, all ISPACED types, full punctuation range)
   - Only adjust levels by ±1 per submission based on evidence. Don't jump levels.

2. STRENGTHS/WEAKNESSES: Update based on praise (strengths) and suggestion (weaknesses) annotations. Keep lists to 3-5 items max — replace old items if new evidence is stronger.

3. recentWowWords: Extract any vocabulary praised in this submission. Keep last 5 max.

4. ISPACED tracking: Update ispacedUsed/ispacedNeverUsed based on opener annotations. Move types from "never used" to "used" when evidence appears.

5. Spelling/Grammar patterns: Note recurring patterns (e.g., "often forgets capital I", "tends to use American spelling"). Keep to 3 items max.

6. growthNotes: Add a brief milestone note ONLY if something genuinely new happened (e.g., "First semicolon used", "First -Ed opener attempted", "Moved from Level 2 to Level 3 connectives"). Don't add notes for routine performance. Keep last 5 max.

7. DO NOT modify teacherNotes or personalInstructions — those are teacher-managed.

Return ONLY valid JSON matching this exact schema (no extra text):
{
  "vcop": {
    "vocabulary": { "level": number, "strengths": [], "weaknesses": [], "recentWowWords": [] },
    "connectives": { "level": number, "highestUsed": string, "pattern": string },
    "openers": { "ispacedUsed": [], "ispacedNeverUsed": [], "pattern": string },
    "punctuation": { "level": number, "mastered": [], "emerging": [], "notYet": [] }
  },
  "spellingPatterns": [],
  "grammarPatterns": [],
  "growthNotes": []
}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { studentId, annotations, sessionTopic } = req.body || {};

  if (!studentId) {
    return res.status(400).json({ error: "studentId is required" });
  }

  if (!annotations || !Array.isArray(annotations) || annotations.length === 0) {
    return res.status(400).json({ error: "annotations array is required" });
  }

  try {
    const db = getDb();
    const profileRef = db.collection("studentProfiles").doc(studentId);
    const profileSnap = await profileRef.get();

    let currentProfile;
    if (profileSnap.exists) {
      currentProfile = profileSnap.data();
    } else {
      currentProfile = { ...EMPTY_PROFILE };
    }

    const prompt = buildProfileUpdatePrompt(currentProfile, annotations, sessionTopic);

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    let content = message.content[0].text.trim();
    // Strip markdown code fences if present
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

    const updatedFields = JSON.parse(content);

    // Merge updated fields into profile, preserving teacher-managed fields
    const updatedProfile = {
      lastUpdated: FieldValue.serverTimestamp(),
      totalSubmissions: (currentProfile.totalSubmissions || 0) + 1,
      vcop: updatedFields.vcop || currentProfile.vcop || EMPTY_PROFILE.vcop,
      spellingPatterns: updatedFields.spellingPatterns || currentProfile.spellingPatterns || [],
      grammarPatterns: updatedFields.grammarPatterns || currentProfile.grammarPatterns || [],
      personalInstructions: currentProfile.personalInstructions || "",
      teacherNotes: currentProfile.teacherNotes || [],
      growthNotes: updatedFields.growthNotes || currentProfile.growthNotes || [],
    };

    await profileRef.set(updatedProfile, { merge: true });

    console.log(`[UPDATE-PROFILE] studentId=${studentId}, totalSubmissions=${updatedProfile.totalSubmissions}`);

    return res.status(200).json({ success: true, totalSubmissions: updatedProfile.totalSubmissions });
  } catch (err) {
    console.error("[UPDATE-PROFILE] Error:", err?.message);
    return res.status(500).json({ error: err?.message || "Failed to update profile" });
  }
}
