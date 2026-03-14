import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import SpeechInput from "./SpeechInput";

// 只在 hint 已揭示時高亮需要修正的位置
// 有 corrected_word → 高亮該字詞；沒有 → 高亮整個 sentence
function buildCoachHighlights(text, checks) {
  if (!text || !checks || checks.length === 0) return text + "\n";

  // 只看最新一筆：有 fix + hint 已揭示
  const latest = checks[0];
  if (!latest?.feedback?.fix || !latest.hintRevealed) return text + "\n";

  // 決定要高亮的目標：corrected_word 或整個 sentence
  const target = latest.feedback.corrected_word || latest.sentence;
  if (!target) return text + "\n";

  // 在 text 中找出現位置（case-insensitive）
  const locations = [];
  const lowerText = text.toLowerCase();
  const lowerTarget = target.toLowerCase();
  let searchFrom = 0;
  while (searchFrom < lowerText.length) {
    const idx = lowerText.indexOf(lowerTarget, searchFrom);
    if (idx === -1) break;
    locations.push({ idx, end: idx + target.length });
    searchFrom = idx + 1;
  }

  if (locations.length === 0) return text + "\n";

  const parts = [];
  let pos = 0;
  for (const loc of locations) {
    if (loc.idx > pos) parts.push(text.slice(pos, loc.idx));
    parts.push(
      <mark key={loc.idx} className="lc-mark-fix">{text.slice(loc.idx, loc.end)}</mark>
    );
    pos = loc.end;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  parts.push("\n");
  return parts;
}

const BASICS_TYPES = new Set(["spelling", "grammar"]);
const VCOP_TYPES = new Set(["vocabulary", "opener", "connective", "punctuation"]);
const STYLE_TYPES = new Set(["show-dont-tell", "sentence-variety", "figurative", "rhetoric", "atmosphere", "voice"]);

// 三級 focus 標籤
const FOCUS_LABELS = {
  basics: "✏️ Level 1 — Spelling & Grammar",
  vcop: "📚 Level 2 — VCOP",
  style: "🎨 Level 3 — Style & Structure",
};

/**
 * LiveCoachMode — 學生自由寫作 + 按句即時回饋
 * 三級自動升級：Basics → VCOP → Style & Structure
 */
export default function LiveCoachMode({ studentId, sessionId, sessionTopic, onAutoSave, initialData }) {
  const [text, setText] = useState("");
  const [checks, setChecks] = useState([]); // { sentence, feedback, focus, hintRevealed, timestamp }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // 不再阻擋重複 — API 有歷史 context 會自動給不同建議
  const initializedRef = useRef(false);

  // Restore from draft on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (initialData?.coachText) setText(initialData.coachText);
    if (initialData?.coachChecks?.length) setChecks(initialData.coachChecks);
  }, [initialData]);

  // Auto-save trigger: call parent whenever text or checks change
  useEffect(() => {
    if (!onAutoSave) return;
    onAutoSave({ coachText: text, coachChecks: checks.slice(0, 50) });
  }, [text, checks, onAutoSave]);

  // 三級升級邏輯
  // Basics clean → VCOP；VCOP 四個維度都覆蓋過 → Style
  const ALL_VCOP_DIMS = ["vocabulary", "connective", "opener", "punctuation"];

  const currentFocus = useMemo(() => {
    if (checks.length < 2) return "basics";
    const recent = checks.slice(0, 2);
    // 最近 2 次都沒有 basics 問題 → 進入 VCOP
    const allBasicsClean = recent.every(
      (c) => !c.feedback.fix || !BASICS_TYPES.has(c.feedback.fix_type)
    );
    if (!allBasicsClean) return "basics";
    // 檢查 VCOP 四個維度是否都有被建議過
    const coveredDims = new Set(
      checks
        .filter((c) => c.focus === "vcop" && c.feedback.fix_type)
        .map((c) => c.feedback.fix_type)
    );
    const allDimsCovered = ALL_VCOP_DIMS.every((d) => coveredDims.has(d));
    if (!allDimsCovered) return "vcop";
    return "style";
  }, [checks]);

  const getLatestSentence = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const sentences = trimmed.match(/[^.!?]*[.!?]+/g);
    if (sentences && sentences.length > 0) {
      // 過濾掉只有空白+標點的空匹配
      const valid = sentences.filter((s) => s.trim().replace(/[.!?]/g, "").trim());
      if (valid.length > 0) return valid[valid.length - 1].trim();
    }
    const lines = trimmed.split("\n");
    return lines[lines.length - 1].trim();
  }, [text]);

  const handleCoachMe = async () => {
    const sentence = getLatestSentence();
    if (!sentence || sentence.length < 3) {
      setError("Write a sentence first, then click Coach me!");
      return;
    }
    setLoading(true);
    setError(null);
    setExplainState(null);

    try {
      // 計算已覆蓋的維度，讓 API 優先建議未覆蓋的
      const getCoveredDims = (focusLevel, typeSet) => [...new Set(
        checks
          .filter((c) => c.focus === focusLevel && c.feedback.fix_type && typeSet.has(c.feedback.fix_type))
          .map((c) => c.feedback.fix_type)
      )];
      const coveredDims = currentFocus === "vcop"
        ? getCoveredDims("vcop", VCOP_TYPES)
        : currentFocus === "style"
          ? getCoveredDims("style", STYLE_TYPES)
          : undefined;

      const res = await fetch("/api/coach-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentence,
          studentId,
          focus: currentFocus,
          coveredDims,
          // 傳最近 3 次歷史，讓 AI 不重複建議同一位置
          recentHistory: checks.slice(0, 3).map((c) => ({
            sentence: c.sentence,
            fix: c.feedback.fix,
            fix_type: c.feedback.fix_type,
            corrected_word: c.feedback.corrected_word,
            suggested_word: c.feedback.suggested_word,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Something went wrong");
      }
      const data = await res.json();
      setChecks((prev) => [
        {
          sentence,
          feedback: data.feedback,
          focus: currentFocus,
          hintRevealed: false,
          timestamp: new Date().toISOString(),
          textSnapshot: text,
        },
        ...prev,
      ]);
    } catch (err) {
      setError(err.message || "Could not get feedback. Try again!");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleCoachMe();
    }
  };

  const revealHint = (idx) => {
    setChecks((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, hintRevealed: true } : c))
    );
  };

  const handleSpeechTranscript = (transcript) => {
    setText((prev) => (prev ? prev + " " + transcript : transcript));
  };

  // Explain my choice — 學生解釋用詞理由的迷你對話
  const [explainState, setExplainState] = useState(null); // { checkIdx, conversation: [{role, text}], loading }
  const [explainInput, setExplainInput] = useState("");

  const startExplain = (checkIdx) => {
    const check = checks[checkIdx];
    const word = check.feedback.corrected_word || "that phrase";
    setExplainState({
      checkIdx,
      conversation: [{ role: "student", text: `I chose "${word}" on purpose because...` }],
      loading: false,
      started: false,
    });
    setExplainInput("");
  };

  const sendExplain = async (inputText) => {
    if (!inputText?.trim() || !explainState) return;
    const check = checks[explainState.checkIdx];
    const newConv = [...explainState.conversation];
    // 替換初始 placeholder 或新增
    if (!explainState.started) {
      newConv[0] = { role: "student", text: inputText.trim() };
    } else {
      newConv.push({ role: "student", text: inputText.trim() });
    }
    setExplainState((prev) => ({ ...prev, conversation: newConv, loading: true, started: true }));
    setExplainInput("");

    try {
      const res = await fetch("/api/coach-explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentence: check.sentence,
          correctedWord: check.feedback.corrected_word,
          suggestedWord: check.feedback.suggested_word,
          fixMessage: check.feedback.fix,
          conversation: newConv,
        }),
      });
      if (!res.ok) {
        setExplainState((prev) => ({ ...prev, loading: false }));
        return;
      }
      const data = await res.json();
      if (data.reply) {
        setExplainState((prev) => ({
          ...prev,
          conversation: [...prev.conversation, { role: "coach", text: data.reply }],
          loading: false,
        }));
      } else {
        setExplainState((prev) => ({ ...prev, loading: false }));
      }
    } catch (err) {
      console.error("[EXPLAIN] Error:", err);
      setExplainState((prev) => ({ ...prev, loading: false }));
    }
  };

  const backdropRef = useRef(null);
  const textareaRef = useRef(null);

  // 同步 backdrop 滾動位置
  const handleScroll = useCallback(() => {
    if (backdropRef.current && textareaRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const highlightedContent = useMemo(
    () => buildCoachHighlights(text, checks),
    [text, checks]
  );

  const latestSentence = getLatestSentence();
  const latestCheck = checks.length > 0 ? checks[0] : null;

  // 回饋類型 icon + label
  const typeInfo = (type) => {
    // Basics
    if (type === "spelling") return { icon: "🔴", label: "Spelling" };
    if (type === "grammar") return { icon: "🟠", label: "Grammar" };
    // VCOP
    if (type === "vocabulary") return { icon: "📚", label: "Vocabulary" };
    if (type === "connective") return { icon: "🔗", label: "Connective" };
    if (type === "opener") return { icon: "✨", label: "Opener" };
    if (type === "punctuation") return { icon: "🎯", label: "Punctuation" };
    // Style
    if (type === "show-dont-tell") return { icon: "👁️", label: "Show don't tell" };
    if (type === "sentence-variety") return { icon: "🎵", label: "Sentence variety" };
    if (type === "figurative") return { icon: "🌟", label: "Figurative language" };
    if (type === "rhetoric") return { icon: "🎤", label: "Rhetoric" };
    if (type === "atmosphere") return { icon: "🌙", label: "Atmosphere" };
    if (type === "voice") return { icon: "🗣️", label: "Voice & tone" };
    return null;
  };

  return (
    <div className="live-coach-container">
      {/* 寫作區：全寬 textarea + backdrop 高亮 */}
      <div className="live-coach-writing-area">
        <div className="lc-backdrop" ref={backdropRef} aria-hidden="true">
          <div className="lc-backdrop-content">{highlightedContent}</div>
        </div>
        <textarea
          ref={textareaRef}
          className="live-coach-textarea"
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null); }}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          placeholder="Start writing here... When you finish a sentence, click 'Coach me' for feedback!"
          disabled={loading}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
        <SpeechInput onTranscript={handleSpeechTranscript} disabled={loading} />
      </div>

      {/* Hint：緊接在 textarea 下方，Coach me 上方 */}
      {latestCheck && latestCheck.feedback.hint && !latestCheck.hintRevealed && (
        <button className="live-coach-hint-btn" onClick={() => revealHint(0)}>
          💡 Hints
        </button>
      )}
      {latestCheck && latestCheck.hintRevealed && latestCheck.feedback.hint && (
        <div className="live-coach-card live-coach-card-hint">
          <span className="live-coach-card-icon">💡</span>
          <span>{latestCheck.feedback.hint}</span>
          {latestCheck.feedback.suggested_word && (
            <span className="live-coach-card-word">
              <span className="live-coach-word-right">{latestCheck.feedback.suggested_word}</span>
            </span>
          )}
          {latestCheck.feedback.corrected_word && !explainState && (
            <button className="live-coach-explain-inline" onClick={() => startExplain(0)}>
              I chose this on purpose
            </button>
          )}
        </div>
      )}

      {/* 操作列：level badge + Coach me 按鈕 */}
      <div className="live-coach-bottom-bar">
        {checks.length > 0 && (
          <div className={`live-coach-focus-badge ${currentFocus}`}>
            {FOCUS_LABELS[currentFocus]}
          </div>
        )}
        <div style={{ flex: 1 }} />
        <button
          className="live-coach-btn"
          onClick={handleCoachMe}
          disabled={loading || !latestSentence || latestSentence.length < 3}
        >
          {loading ? (
            <span className="button-loading"><span className="spinner" />Checking...</span>
          ) : (
            "Coach me ✨"
          )}
        </button>
      </div>

      {error && <div className="live-coach-error">{error}</div>}

      {/* 回饋區 */}
      {checks.length === 0 && !loading && (
        <div className="live-coach-empty">
          <p>Write a sentence, then click <strong>Coach me</strong> to get instant feedback! (or press Cmd+Enter)</p>
        </div>
      )}

      {loading && (
        <div className="live-coach-loading-card">
          <span className="live-coach-loading-icon">🤔</span>
          <span>Reading your sentence...</span>
        </div>
      )}

      {latestCheck && (
        <div className="live-coach-card-group live-coach-card-enter">
          {/* 讚美 + 建議 橫排 */}
          <div className="live-coach-feedback-row">
            {/* Praise */}
            <div className="live-coach-card live-coach-card-praise">
              <span className="live-coach-card-icon">⭐</span>
              <span>{latestCheck.feedback.praise}</span>
              {latestCheck.feedback.fix_type && typeInfo(latestCheck.feedback.fix_type) && (
                <span className="live-coach-vcop-pill">{typeInfo(latestCheck.feedback.fix_type).label}</span>
              )}
            </div>

            {/* Fix — 加上 VCOP 維度 pill */}
            {latestCheck.feedback.fix && (
              <div className={`live-coach-card ${latestCheck.focus === "basics" ? "live-coach-card-fix" : "live-coach-card-vcop"}`}>
                <span className="live-coach-card-icon">
                  {latestCheck.feedback.fix_type && typeInfo(latestCheck.feedback.fix_type)
                    ? typeInfo(latestCheck.feedback.fix_type).icon
                    : "🔍"}
                </span>
                <span>{latestCheck.feedback.fix}</span>
                {latestCheck.feedback.corrected_word && (
                  <span className="live-coach-card-word">
                    <span className="live-coach-word-wrong">{latestCheck.feedback.corrected_word}</span>
                  </span>
                )}
                {latestCheck.feedback.fix_type && typeInfo(latestCheck.feedback.fix_type) && (
                  <span className="live-coach-vcop-pill">{typeInfo(latestCheck.feedback.fix_type).label}</span>
                )}
              </div>
            )}
          </div>

          {/* Explain my choice 對話 */}
          {explainState && explainState.checkIdx === 0 && (
            <div className="live-coach-explain-chat">
              {explainState.conversation.map((msg, i) => (
                <div key={i} className={`live-coach-explain-msg ${msg.role}`}>
                  {msg.text}
                </div>
              ))}
              {explainState.loading && (
                <div className="live-coach-explain-msg coach" style={{ opacity: 0.6 }}>
                  Thinking...
                </div>
              )}
              {explainState.conversation.length < 6 && (
                <div className="live-coach-explain-input-row">
                  <input
                    className="live-coach-explain-input"
                    value={explainInput}
                    onChange={(e) => setExplainInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") sendExplain(explainInput); }}
                    placeholder={explainState.started ? "Reply..." : "Why did you choose this word?"}
                    disabled={explainState.loading}
                  />
                  <button
                    className="live-coach-explain-send"
                    onClick={() => sendExplain(explainInput)}
                    disabled={explainState.loading || !explainInput.trim()}
                  >
                    Send
                  </button>
                </div>
              )}
              <button className="live-coach-explain-close" onClick={() => setExplainState(null)}>
                Close chat
              </button>
            </div>
          )}
        </div>
      )}

      {/* History — 摺疊式 */}
      {checks.length > 1 && (
        <details className="live-coach-history">
          <summary className="live-coach-history-label">Previous checks ({checks.length - 1})</summary>
          {checks.slice(1, 4).map((c, idx) => (
            <details key={idx} className="live-coach-history-item">
              <summary className="live-coach-history-summary">
                <span className="live-coach-history-sentence">
                  "{c.sentence.length > 50 ? c.sentence.slice(0, 50) + "..." : c.sentence}"
                </span>
                {c.focus !== "basics" && c.feedback.fix_type && typeInfo(c.feedback.fix_type)
                  ? <span className="live-coach-history-badge vcop">{typeInfo(c.feedback.fix_type).icon}</span>
                  : c.feedback.fix
                    ? <span className="live-coach-history-badge fix">🔍</span>
                    : <span className="live-coach-history-badge good">⭐</span>}
              </summary>
              <div className="live-coach-history-content">
                <div className="live-coach-mini-card praise">⭐ {c.feedback.praise}</div>
                {c.feedback.fix && <div className="live-coach-mini-card fix">
                  {c.focus !== "basics" && c.feedback.fix_type && typeInfo(c.feedback.fix_type)
                    ? typeInfo(c.feedback.fix_type).icon
                    : "🔍"} {c.feedback.fix}
                </div>}
              </div>
            </details>
          ))}
        </details>
      )}
    </div>
  );
}
