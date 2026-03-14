import { useState, useCallback } from "react";
import { collection, addDoc, updateDoc, doc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";


// 22 connectives 分三組，多字片語排前面（優先匹配）
const CONNECTIVES = {
  easy: ["and", "but", "so", "or", "because", "then"],
  challenge: ["when", "if", "while", "until", "after", "before", "since", "although"],
  expert: ["however", "therefore", "nevertheless", "furthermore", "moreover", "despite", "even though", "as a result"],
};
const ALL_CONNECTIVES = [...CONNECTIVES.expert, ...CONNECTIVES.challenge, ...CONNECTIVES.easy];

// Opener 介詞列表
const PREPOSITIONS = ["in", "on", "at", "under", "behind", "above", "below", "through", "during", "after", "before", "across", "beside", "between", "near"];

// 偵測句子中的 connective（回傳第一個匹配）
function detectConnective(sentence) {
  const lower = sentence.toLowerCase();
  for (const c of ALL_CONNECTIVES) {
    const regex = new RegExp(`\\b${c}\\b`, "i");
    if (regex.test(lower)) return c;
  }
  return null;
}

// 偵測 opener 類型
function detectOpener(sentence) {
  const trimmed = sentence.trim();
  if (!trimmed) return null;
  const firstWord = trimmed.split(/[\s,]+/)[0].toLowerCase();

  if (firstWord.endsWith("ly") && firstWord.length > 3) return { type: "-ly (Adverb)", label: "A" };
  if (firstWord.endsWith("ing") && firstWord.length > 4) return { type: "-Ing", label: "I" };
  if (firstWord.endsWith("ed") && firstWord.length > 3) return { type: "-Ed", label: "E" };
  if (trimmed.endsWith("?")) return { type: "Question", label: "Q" };
  if (PREPOSITIONS.includes(firstWord)) return { type: "Preposition", label: "P" };
  return null;
}

function getConnectiveGroup(connective) {
  if (CONNECTIVES.easy.includes(connective)) return { label: "Easy", color: "#10B981" };
  if (CONNECTIVES.challenge.includes(connective)) return { label: "Challenge", color: "#3B82F6" };
  if (CONNECTIVES.expert.includes(connective)) return { label: "Expert", color: "#8B5CF6" };
  return { label: "", color: "#64748b" };
}

// 句間 connective — 開新句 + 後面加逗號
const SENTENCE_LINKING = new Set([
  "however", "therefore", "nevertheless", "furthermore", "moreover",
  "despite", "as a result", "on the other hand", "meanwhile",
]);

function getConnectiveTip(connective) {
  const c = connective.toLowerCase();
  if (SENTENCE_LINKING.has(c)) {
    const cap = c.charAt(0).toUpperCase() + c.slice(1);
    return `Add '${cap}' to your sentence. You can rewrite the whole sentence! Tip: '${cap}' starts a new sentence and needs a comma after it. E.g. 'I was tired. ${cap}, I kept running.'`;
  }
  const cap = c.charAt(0).toUpperCase() + c.slice(1);
  return `Add '${connective}' to your sentence. You can rewrite the whole sentence! Tip: '${connective}' usually goes at the start or in the middle. E.g. '${cap} I was tired, I kept running.'`;
}

// Connective 用途描述（慶祝訊息用）
function getConnectiveDesc(connective) {
  const c = connective.toLowerCase();
  if (["because", "since", "as"].includes(c)) return "to explain WHY";
  if (["but", "however", "although", "nevertheless", "despite"].includes(c)) return "to show CONTRAST";
  if (["when", "while", "until", "after", "before", "then", "during"].includes(c)) return "to show TIME";
  if (["if"].includes(c)) return "to show a CONDITION";
  if (["so", "therefore", "consequently", "as a result"].includes(c)) return "to show a RESULT";
  if (["and", "furthermore", "moreover"].includes(c)) return "to ADD more information";
  if (["or"].includes(c)) return "to give a CHOICE";
  if (["even though"].includes(c)) return "to show SURPRISE";
  return "to connect your ideas";
}

const OPENER_SUGGESTIONS = [
  { type: "-ly (Adverb)", example: "Silently, she crept forward.", letter: "A" },
  { type: "-Ing", example: "Running towards the door, he tripped.", letter: "I" },
  { type: "Preposition", example: "Under the old bridge, a troll waited.", letter: "P" },
  { type: "-Ed", example: "Exhausted from the journey, they rested.", letter: "E" },
  { type: "Question", example: "Have you ever wondered what lives in the sea?", letter: "Q" },
];

export default function SentenceBuilder({ sessionId, studentId, sessionTopic, vcopFocus, extraInstructions, onFeedbackReady }) {
  const [currentSentence, setCurrentSentence] = useState("");
  const [completedSentences, setCompletedSentences] = useState([]);
  // "write" → "spellcheck" → "fixSpelling" → "addConnective" → "addOpener" → "celebrate"
  const [phase, setPhase] = useState("write");
  const [selectedConnective, setSelectedConnective] = useState(null);
  const [connectiveRewrite, setConnectiveRewrite] = useState(""); // 學生自由改寫含 connective 的句子
  const [connectiveHint, setConnectiveHint] = useState(""); // 提示訊息
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [usedOpenerTypes, setUsedOpenerTypes] = useState(new Set());
  // Firestore doc ID — 第一句完成時建立，之後每句 update
  const [submissionDocId, setSubmissionDocId] = useState(null);

  // Opener rewrite state
  const [selectedOpenerType, setSelectedOpenerType] = useState(null); // e.g. { type, letter, example }
  const [openerRewrite, setOpenerRewrite] = useState("");
  const [openerHint, setOpenerHint] = useState(""); // 鼓勵提示

  // Per-sentence spell check state
  const [checking, setChecking] = useState(false);
  const [spellErrors, setSpellErrors] = useState([]); // annotations from API
  const [spellCheckAttempts, setSpellCheckAttempts] = useState(0); // 最多 2 次拼寫檢查

  // Final paragraph AI feedback state
  const [analyzing, setAnalyzing] = useState(false);

  // Toast celebration system — 3 秒後自動消失
  const [toast, setToast] = useState(null); // { emoji, message }

  const showToast = useCallback((emoji, message) => {
    setToast({ emoji, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // 每句完成後即時存入 Firestore（fire-and-forget）
  const saveSentenceToFirestore = async (newSentence, allSentences) => {
    const paragraph = allSentences.map((s) => s.final).join(". ").replace(/\.\./g, ".") + ".";
    try {
      if (!submissionDocId) {
        // 第一句 → 建立 doc
        const docRef = await addDoc(collection(db, "submissions"), {
          sessionId, studentId,
          sessionTopic: sessionTopic || "",
          type: "sentenceBuilding",
          sentences: allSentences,
          paragraph,
          createdAt: serverTimestamp(),
        });
        setSubmissionDocId(docRef.id);
      } else {
        // 後續句子 → 更新 doc
        await updateDoc(doc(db, "submissions", submissionDocId), {
          sentences: allSentences,
          paragraph,
        });
      }
    } catch (err) {
      console.error("Failed to save sentence:", err);
    }
  };

  // Step 1: API spell/grammar check on a single sentence
  // strict=true 時只檢查拼寫（connective 延伸用）
  const runSpellCheck = async (text, { strict = false } = {}) => {
    setChecking(true);
    setSpellErrors([]);
    try {
      const body = strict
        ? { text, studentId, spellCheckOnlyStrict: true }
        : { text, studentId, spellCheckOnly: true };
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        const errors = (data.annotations || []).filter(
          (a) => a.type === "spelling" || a.type === "grammar"
        );
        return errors;
      }
    } catch (err) {
      console.error("Spell check failed:", err);
    } finally {
      setChecking(false);
    }
    return [];
  };

  // 學生按 Submit sentence → 先做拼寫檢查（第一次）
  const handleSubmitSentence = async () => {
    const trimmed = currentSentence.trim();
    if (!trimmed) return;

    setSpellCheckAttempts(1);
    const errors = await runSpellCheck(trimmed);
    if (errors.length > 0) {
      setSpellErrors(errors);
      setPhase("fixSpelling");
    } else {
      showToast("✅", "Perfect spelling!");
      proceedToConnectiveOpener(trimmed);
    }
  };

  // 學生修改後再次提交 — 第二次無論結果如何都通過
  const handleResubmitAfterFix = async () => {
    const trimmed = currentSentence.trim();
    if (!trimmed) return;

    const nextAttempt = spellCheckAttempts + 1;
    setSpellCheckAttempts(nextAttempt);

    // 第二次提交 → 無論結果如何都通過，不再循環
    if (nextAttempt >= 2) {
      setSpellErrors([]);
      showToast("✅", "Good effort! Let's keep going!");
      proceedToConnectiveOpener(trimmed);
      return;
    }

    const errors = await runSpellCheck(trimmed);
    if (errors.length > 0) {
      setSpellErrors(errors);
    } else {
      setSpellErrors([]);
      showToast("✅", "Spelling fixed! Well done!");
      proceedToConnectiveOpener(trimmed);
    }
  };

  // 完成一句 → 加入 completedSentences + 即時存 Firestore
  const completeSentence = (sentence) => {
    const updated = [...completedSentences, sentence];
    setCompletedSentences(updated);
    if (sentence.openerDetected) {
      const newUsed = new Set(usedOpenerTypes);
      newUsed.add(sentence.openerDetected);
      setUsedOpenerTypes(newUsed);
    }
    saveSentenceToFirestore(sentence, updated);
  };

  // 拼寫通過後，進入 connective/opener 流程
  const proceedToConnectiveOpener = (trimmed) => {
    setSpellErrors([]);
    const connective = detectConnective(trimmed);
    const opener = detectOpener(trimmed);

    if (connective && opener) {
      completeSentence({
        original: trimmed, final: trimmed, connectiveUsed: connective, openerDetected: opener.type,
      });
      setCurrentSentence("");
      setPhase("celebrate");
    } else if (connective) {
      showToast("🔗", `You used '${connective}' ${getConnectiveDesc(connective)}!`);
      setPhase("addOpener");
    } else {
      setPhase("addConnective");
    }
  };

  const handlePickConnective = (connective) => {
    setSelectedConnective(connective);
    setConnectiveRewrite(currentSentence.trim());
    setConnectiveHint("");
  };

  // 學生自由改寫句子後按 Done → 檢查 connective 存在 → 拼寫檢查
  const handleFinishConnective = async () => {
    const trimmed = connectiveRewrite.trim();
    if (!trimmed) return;

    // 檢查句子是否包含選擇的 connective
    const regex = new RegExp(`\\b${selectedConnective}\\b`, "i");
    if (!regex.test(trimmed)) {
      setConnectiveHint(`Remember to use '${selectedConnective}' in your sentence.`);
      return;
    }
    setConnectiveHint("");

    // 拼寫檢查（strict 模式，只查拼寫）
    const errors = await runSpellCheck(trimmed, { strict: true });
    if (errors.length > 0) {
      setCurrentSentence(trimmed);
      setSelectedConnective(null);
      setConnectiveRewrite("");
      setSpellErrors(errors);
      setPhase("fixSpelling");
      return;
    }

    const opener = detectOpener(trimmed);
    if (opener) {
      completeSentence({
        original: currentSentence.trim(), final: trimmed, connectiveUsed: selectedConnective, openerDetected: opener.type,
      });
      setCurrentSentence("");
      setSelectedConnective(null);
      setConnectiveRewrite("");
      setPhase("celebrate");
    } else {
      showToast("🔗", `You used '${selectedConnective}' ${getConnectiveDesc(selectedConnective)}!`);
      setCurrentSentence(trimmed);
      setSelectedConnective(null);
      setConnectiveRewrite("");
      setPhase("addOpener");
    }
  };

  const handleSkipOpener = () => {
    const opener = detectOpener(currentSentence);
    completeSentence({
      original: currentSentence.trim(), final: currentSentence.trim(),
      connectiveUsed: detectConnective(currentSentence), openerDetected: opener?.type || null,
    });
    setCurrentSentence("");
    setSelectedOpenerType(null);
    setOpenerRewrite("");
    setOpenerHint("");
    setPhase("write");
  };

  // 檢查重寫句是否符合選擇的 opener 類型
  const validateOpenerRewrite = (text, openerType) => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const firstWord = trimmed.split(/[\s,]+/)[0].toLowerCase();

    switch (openerType) {
      case "-ly (Adverb)":
        return firstWord.endsWith("ly") && firstWord.length > 3;
      case "-Ing":
        return firstWord.endsWith("ing") && firstWord.length > 4;
      case "-Ed":
        return firstWord.endsWith("ed") && firstWord.length > 3;
      case "Preposition":
        return PREPOSITIONS.includes(firstWord);
      case "Question":
        return trimmed.endsWith("?");
      default:
        return false;
    }
  };

  // Opener 類型對應的鼓勵提示
  const getOpenerHintMsg = (openerType) => {
    switch (openerType) {
      case "-ly (Adverb)":
        return "Almost! Remember, a -ly opener starts with a word like 'Excitedly' or 'Nervously'. Try again!";
      case "-Ing":
        return "Almost! An -ing opener starts with a word like 'Running' or 'Trembling'. Try again!";
      case "-Ed":
        return "Almost! An -ed opener starts with a word like 'Exhausted' or 'Convinced'. Try again!";
      case "Preposition":
        return "Almost! A preposition opener starts with a place word like 'Under', 'Behind', or 'Through'. Try again!";
      case "Question":
        return "Almost! A question opener ends with a question mark (?). Try again!";
      default:
        return "Almost! Try again!";
    }
  };

  // 學生提交 opener 重寫
  const handleSubmitOpenerRewrite = async () => {
    const trimmed = openerRewrite.trim();
    if (!trimmed || !selectedOpenerType) return;

    // 先檢查是否符合 opener 類型
    if (!validateOpenerRewrite(trimmed, selectedOpenerType.type)) {
      setOpenerHint(getOpenerHintMsg(selectedOpenerType.type));
      return;
    }

    setOpenerHint("");

    // 通過 → 拼寫檢查
    const errors = await runSpellCheck(trimmed);
    if (errors.length > 0) {
      setSpellErrors(errors);
      // 暫存原句，把重寫句當作 currentSentence 進 fixSpelling
      // fix 完回到 opener 流程太複雜，直接讓學生在 fix 畫面改好後完成
      setCurrentSentence(trimmed);
      setSelectedOpenerType(null);
      setOpenerRewrite("");
      setPhase("fixSpelling");
      return;
    }

    // 拼寫也過了 → 慶祝！用重寫句取代原句
    completeSentence({
      original: currentSentence.trim(),
      final: trimmed,
      connectiveUsed: detectConnective(trimmed) || detectConnective(currentSentence),
      openerDetected: selectedOpenerType.type,
    });
    setCurrentSentence("");
    setSelectedOpenerType(null);
    setOpenerRewrite("");
    setOpenerHint("");
    setPhase("celebrate");
  };

  const handleNextSentence = () => {
    setCurrentSentence("");
    setSpellCheckAttempts(0);
    setPhase("write");
  };

  const handleGetFeedback = async () => {
    if (completedSentences.length === 0 || saving) return;
    const paragraph = completedSentences.map((s) => s.final).join(". ").replace(/\.\./g, ".") + ".";
    setSaved(true);

    // Full AI feedback → 交給父層的 revision 介面
    setAnalyzing(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: paragraph, sessionId, studentId,
          vcopFocus: vcopFocus || ["V", "C", "O", "P", "spelling", "grammar"],
          topic: sessionTopic,
          extraInstructions: extraInstructions || null,
          feedbackLevel: 1, feedbackAmount: 1,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        // 把 v1 iteration 存入已有的 submission doc（與 Big Writing 格式一致）
        if (submissionDocId) {
          await updateDoc(doc(db, "submissions", submissionDocId), {
            iterations: [{
              version: 1,
              text: paragraph,
              annotations: data.annotations || [],
              createdAt: new Date().toISOString(),
            }],
          });
        }
        // 傳給父層，切換到 Big Writing 的 revision 介面
        if (onFeedbackReady) {
          onFeedbackReady(paragraph, data.annotations || [], submissionDocId);
        }
      }
    } catch (err) {
      console.error("AI feedback failed:", err);
    } finally {
      setAnalyzing(false);
    }
  };

  const unusedOpeners = OPENER_SUGGESTIONS.filter((s) => !usedOpenerTypes.has(s.type));

  return (
    <div className="sb-container">
      {/* Toast celebration — auto-dismiss after 3s */}
      {toast && (
        <div className="sb-toast" key={toast.message}>
          <span className="sb-toast-emoji">{toast.emoji}</span>
          <span className="sb-toast-msg">{toast.message}</span>
        </div>
      )}

      {/* 已完成的句子 — 段落形式 + 成就統計 */}
      {completedSentences.length > 0 && (() => {
        const totalConn = completedSentences.filter(s => s.connectiveUsed).length;
        const totalOpen = completedSentences.filter(s => s.openerDetected).length;
        return (
          <div className="sb-paragraph">
            {/* 累計成就統計列 */}
            <div className="sb-achievement-bar">
              <span className="sb-achievement-item">🎉 {completedSentences.length} sentence{completedSentences.length !== 1 ? "s" : ""}</span>
              {totalConn > 0 && <span className="sb-achievement-item sb-achievement-conn">🔗 {totalConn} connective{totalConn !== 1 ? "s" : ""}</span>}
              {totalOpen > 0 && <span className="sb-achievement-item sb-achievement-open">✨ {totalOpen} opener{totalOpen !== 1 ? "s" : ""}</span>}
            </div>
            <div className="sb-paragraph-text">
              {completedSentences.map((s, i) => (
                <span key={i} className={`sb-completed-sentence ${i === completedSentences.length - 1 && phase === "celebrate" ? "sb-sentence-new" : ""}`}>
                  {s.final}{i < completedSentences.length - 1 ? ". " : "."}
                  {s.connectiveUsed && (
                    <span className="sb-badge sb-badge-connective" title={`Connective: ${s.connectiveUsed}`}>
                      🔗 {s.connectiveUsed}
                    </span>
                  )}
                  {s.openerDetected && (
                    <span className="sb-badge sb-badge-opener" title={`Opener: ${s.openerDetected}`}>
                      ✨ {s.openerDetected}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* === WRITE phase === */}
      {phase === "write" && !saved && (
        <div className="sb-write-phase">
          <label className="sb-label">
            {completedSentences.length === 0
              ? "Write your first sentence:"
              : "Write your next sentence:"}
          </label>
          <textarea
            className="writing-input sb-input"
            placeholder="Type a sentence..."
            value={currentSentence}
            onChange={(e) => setCurrentSentence(e.target.value)}
            rows={3}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          <button
            className="analyze-button sb-submit-btn"
            onClick={handleSubmitSentence}
            disabled={!currentSentence.trim() || checking}
          >
            {checking ? (
              <span className="button-loading"><span className="spinner" />Checking...</span>
            ) : "Submit sentence"}
          </button>
        </div>
      )}

      {/* === FIX SPELLING phase === */}
      {phase === "fixSpelling" && (
        <div className="sb-fix-phase">
          <div className="sb-spell-errors">
            <h4 className="sb-spell-title">Fix these before moving on:</h4>
            {spellErrors.map((err, i) => (
              <div key={i} className={`sb-spell-error sb-spell-${err.type}`}>
                <span className="sb-spell-phrase">
                  {err.type === "spelling" ? "🔴" : "🟠"} <strong>{err.phrase}</strong>
                </span>
                <span className="sb-spell-arrow"> → </span>
                <span className="sb-spell-suggestion">{err.suggestion}</span>
              </div>
            ))}
          </div>
          <textarea
            className="writing-input sb-input"
            value={currentSentence}
            onChange={(e) => setCurrentSentence(e.target.value)}
            rows={3}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoFocus
          />
          <button
            className="analyze-button sb-submit-btn"
            onClick={handleResubmitAfterFix}
            disabled={!currentSentence.trim() || checking}
          >
            {checking ? (
              <span className="button-loading"><span className="spinner" />Checking again...</span>
            ) : "Check again"}
          </button>
        </div>
      )}

      {/* === ADD CONNECTIVE phase === */}
      {phase === "addConnective" && (
        <div className="sb-connective-phase">
          <div className="sb-current-sentence">
            <span className="sb-sentence-text">{currentSentence}</span>
          </div>
          <p className="sb-prompt">Can you add a connective to your sentence?</p>

          {!selectedConnective ? (
            <div className="sb-connective-groups">
              {Object.entries(CONNECTIVES).map(([group, words]) => (
                <div key={group} className="sb-connective-group">
                  <h4 className={`sb-group-label sb-group-${group}`}>
                    {group === "easy" ? "Easy" : group === "challenge" ? "Challenge" : "Expert"}
                  </h4>
                  <div className="sb-connective-buttons">
                    {words.map((w) => (
                      <button key={w} className={`sb-connective-btn sb-connective-${group}`} onClick={() => handlePickConnective(w)}>
                        {w}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="sb-continuation">
              <div className="sb-connective-tip">
                {getConnectiveTip(selectedConnective)}
              </div>

              {connectiveHint && (
                <div className="sb-opener-hint">{connectiveHint}</div>
              )}

              <textarea
                className="writing-input sb-input"
                value={connectiveRewrite}
                onChange={(e) => setConnectiveRewrite(e.target.value)}
                rows={3}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoFocus
              />
              <div className="sb-action-row">
                <button
                  className="sb-back-btn"
                  onClick={() => { setSelectedConnective(null); setConnectiveRewrite(""); setConnectiveHint(""); }}
                >
                  Pick different connective
                </button>
                <button
                  className="analyze-button sb-submit-btn"
                  onClick={handleFinishConnective}
                  disabled={!connectiveRewrite.trim() || checking}
                >
                  {checking ? (
                    <span className="button-loading"><span className="spinner" />Checking...</span>
                  ) : "Done"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* === ADD OPENER phase === */}
      {phase === "addOpener" && (
        <div className="sb-opener-phase">
          <div className="sb-current-sentence">
            <span className="sb-sentence-text">{currentSentence}</span>
            {detectConnective(currentSentence) && (
              <span className="sb-inline-badge sb-badge-connective">
                Connective used: {detectConnective(currentSentence)}
              </span>
            )}
          </div>

          {!selectedOpenerType ? (
            <>
              <p className="sb-prompt">
                Nice connective! Can you rewrite your sentence with a special opener?
              </p>

              {unusedOpeners.length > 0 && (
                <div className="sb-opener-suggestions">
                  <h4 className="sb-opener-title">Pick an opener type to try:</h4>
                  {unusedOpeners.slice(0, 3).map((s) => (
                    <button
                      key={s.type}
                      className="sb-opener-card sb-opener-clickable"
                      onClick={() => {
                        setSelectedOpenerType(s);
                        setOpenerRewrite("");
                        setOpenerHint("");
                      }}
                    >
                      <span className="sb-opener-type">{s.letter} — {s.type}</span>
                      <span className="sb-opener-example">e.g. "{s.example}"</span>
                    </button>
                  ))}
                </div>
              )}

              <button className="sb-skip-btn" onClick={handleSkipOpener}>
                Skip — save sentence as is
              </button>
            </>
          ) : (
            <div className="sb-opener-rewrite">
              <p className="sb-prompt">
                Rewrite your sentence starting with
                {selectedOpenerType.type === "Question" ? " a question:" :
                 selectedOpenerType.type === "Preposition" ? " a place word (Under, Behind, Through...):" :
                 ` a ${selectedOpenerType.type.replace(/[()]/g, "")} word:`}
              </p>
              <div className="sb-opener-example-bar">
                e.g. "{selectedOpenerType.example}"
              </div>

              {openerHint && (
                <div className="sb-opener-hint">{openerHint}</div>
              )}

              <textarea
                className="writing-input sb-input"
                placeholder={`Rewrite: ${currentSentence.trim()}`}
                value={openerRewrite}
                onChange={(e) => setOpenerRewrite(e.target.value)}
                rows={3}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoFocus
              />
              <div className="sb-action-row">
                <button
                  className="sb-back-btn"
                  onClick={() => { setSelectedOpenerType(null); setOpenerRewrite(""); setOpenerHint(""); }}
                >
                  Pick different opener
                </button>
                <button
                  className="analyze-button sb-submit-btn"
                  onClick={handleSubmitOpenerRewrite}
                  disabled={!openerRewrite.trim() || checking}
                >
                  {checking ? (
                    <span className="button-loading"><span className="spinner" />Checking...</span>
                  ) : "Submit"}
                </button>
              </div>
              <button className="sb-skip-btn" onClick={handleSkipOpener} style={{ marginTop: 8 }}>
                Skip — save original sentence
              </button>
            </div>
          )}
        </div>
      )}

      {/* === CELEBRATE phase === */}
      {phase === "celebrate" && completedSentences.length > 0 && (() => {
        const last = completedSentences[completedSentences.length - 1];
        const hasBoth = last.connectiveUsed && last.openerDetected;
        const firstWord = last.final.trim().split(/[\s,]+/)[0];
        return (
          <div className="sb-celebrate-phase">
            <div className="sb-celebrate-emoji">{hasBoth ? "🏆" : "🎉"}</div>
            <h3 className="sb-celebrate-text">
              {hasBoth
                ? "Amazing sentence!"
                : last.openerDetected
                  ? "Great opener!"
                  : "Great sentence!"}
            </h3>

            {hasBoth && (
              <p className="sb-celebrate-msg sb-celebrate-both">
                Connective + Opener — you're writing like a pro!
              </p>
            )}

            {last.connectiveUsed && (
              <div className="sb-celebrate-detail-card sb-celebrate-connective">
                <span className="sb-celebrate-detail-emoji">🔗</span>
                <span>You used <strong>'{last.connectiveUsed}'</strong> {getConnectiveDesc(last.connectiveUsed)}!</span>
                <span className="sb-badge sb-badge-connective">{getConnectiveGroup(last.connectiveUsed).label}</span>
              </div>
            )}

            {last.openerDetected && (
              <div className="sb-celebrate-detail-card sb-celebrate-opener">
                <span className="sb-celebrate-detail-emoji">✨</span>
                <span>Starting with <strong>'{firstWord}'</strong> makes your sentence really stand out!</span>
                <span className="sb-badge sb-badge-opener">{last.openerDetected}</span>
              </div>
            )}

            <button className="analyze-button sb-submit-btn" onClick={handleNextSentence}>
              Write another sentence
            </button>
          </div>
        );
      })()}

      {/* Get AI feedback button — sentences already auto-saved */}
      {completedSentences.length > 0 && !saved && phase !== "fixSpelling" && (
        <div className="sb-save-section">
          <button className="sb-save-btn" onClick={handleGetFeedback} disabled={analyzing}>
            {analyzing ? "Analysing..." : "Get AI feedback on my paragraph"}
          </button>
          <p className="sb-autosave-note">Your sentences are saved automatically.</p>
        </div>
      )}

      {saved && !analyzing && (
        <div className="sb-saved-message">
          Your teacher can see your writing on the dashboard.
        </div>
      )}

      {/* AI analyzing overlay */}
      {analyzing && (
        <div className="analyzing-overlay">
          <div className="analyzing-pencil">✏️</div>
          <div className="analyzing-text">Checking your paragraph...</div>
          <div className="analyzing-dots">
            <span className="analyzing-dot" />
            <span className="analyzing-dot" />
            <span className="analyzing-dot" />
          </div>
        </div>
      )}

    </div>
  );
}
