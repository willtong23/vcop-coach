import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// 學生解釋自己的用詞選擇，AI 引導討論是否合適
const SYSTEM_PROMPT = `You are a friendly writing coach for primary school students (ages 9–11).

The student has been told their word choice could be improved, but they believe they chose the word deliberately. Your job is to have a SHORT conversation to understand their reasoning and help them think about whether it's effective.

RULES:
- Be warm and genuinely curious about their reasoning
- If their choice IS actually strong and deliberate, praise them and explain WHY it works
- If their choice could still be improved, acknowledge their thinking first, then gently suggest how it could be even stronger
- Keep each response to 2-3 sentences max
- Use simple language appropriate for ages 9-11
- NEVER be dismissive — every student reasoning deserves consideration
- Ask follow-up questions to deepen their thinking about word choice
- After 2-3 exchanges, wrap up with a clear conclusion: either "your choice works well because..." or "you had a good idea, and here's how to make it even stronger..."
- Return ONLY JSON: {"reply": "your response here"}`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { sentence, correctedWord, suggestedWord, fixMessage, conversation } = req.body;

  if (!sentence || !conversation || !Array.isArray(conversation) || conversation.length === 0) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // 組合 messages：context 合併到第一條學生訊息，確保 user/assistant 交替
  const contextPrefix = `CONTEXT:
- Student's sentence: "${sentence}"
- The coach suggested changing "${correctedWord || "a phrase"}" to "${suggestedWord || "something else"}"
- Coach's suggestion: "${fixMessage || ""}"

Student's explanation: `;

  const messages = conversation.map((msg, i) => ({
    role: msg.role === "student" ? "user" : "assistant",
    content: msg.role === "student"
      ? (i === 0 ? contextPrefix + msg.text : msg.text)
      : JSON.stringify({ reply: msg.text }),
  }));

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      temperature: 0.5,
      system: SYSTEM_PROMPT,
      messages,
    });

    const raw = message.content[0].text.trim();
    let content = raw;
    if (content.startsWith("```")) {
      content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1) {
      content = content.slice(firstBrace, lastBrace + 1);
    }

    let reply;
    try {
      const parsed = JSON.parse(content);
      reply = parsed.reply;
    } catch {
      reply = raw;
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error(`[COACH-EXPLAIN] Error: ${err.message}`);
    return res.status(500).json({ error: "Could not get a response. Please try again." });
  }
}
