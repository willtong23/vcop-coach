// Content safety filter for student text input
// Checks for personal info, prompt injection, and unsafe content

export function checkContentSafety(text, source) {
  const issues = [];

  // 1. 長度檢查（二次防護）
  if (text && text.length > 10000) {
    issues.push("input_too_long");
  }

  // 2. 個人資訊偵測（基本版）
  const personalInfoPatterns = [
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,  // credit card
    /\b[A-Z]\d{6,8}\b/i,                              // passport/ID
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,                  // phone number
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/i  // email
  ];
  for (const pattern of personalInfoPatterns) {
    if (pattern.test(text)) {
      issues.push("personal_info_detected");
      break;
    }
  }

  // 3. Prompt injection 偵測（基本版）
  const injectionPatterns = [
    /ignore (?:all |your |previous |above )?(?:instructions|rules|prompts)/i,
    /you are now/i,
    /system ?prompt/i,
    /\bDAN\b/,
    /do anything now/i,
    /pretend you/i,
    /act as (?:an? )?(?:unrestricted|unfiltered)/i,
    /bypass (?:your |all )?(?:filters|restrictions|rules)/i
  ];
  for (const pattern of injectionPatterns) {
    if (pattern.test(text)) {
      issues.push("potential_injection");
      break;
    }
  }

  // 4. 不當內容基本偵測（教育場景）
  const unsafePatterns = [
    /\b(?:kill|murder|suicide|self[- ]?harm)\b/i,
    /\b(?:porn|xxx|nude)\b/i
  ];
  for (const pattern of unsafePatterns) {
    if (pattern.test(text)) {
      issues.push("unsafe_content");
      break;
    }
  }

  if (issues.length > 0) {
    console.warn(`[content-safety][${source}] Flagged: ${issues.join(", ")}. Input preview: ${text.slice(0, 100)}`);
  }

  return {
    safe: issues.length === 0,
    issues,
    // injection 和 unsafe 應該 block；其他只 warn
    shouldBlock: issues.includes("potential_injection") || issues.includes("unsafe_content")
  };
}
