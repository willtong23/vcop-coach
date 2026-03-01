import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { collection, query, where, limit, onSnapshot, doc, getDocs, updateDoc, addDoc, arrayUnion, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import SpeechInput from "../components/SpeechInput";
import AnnotatedText, { FeedbackLegend, VcopFilterBar } from "../components/AnnotatedText";
import HighlightedEditor from "../components/HighlightedEditor";
import { getChangedWordIndices } from "../utils/wordDiff";

const VCOP_DIM_LABELS = { V: "vocabulary upgrade", C: "connective improvement", O: "better opener", P: "punctuation fix" };

const ISPACED_OPTIONS = [
  { value: "", label: "Choose one..." },
  { value: "-ly", label: "-ly (Adverb) — Silently, Carefully" },
  { value: "-ing", label: "-Ing — Running, Trembling" },
  { value: "question", label: "Question — Have you ever...?" },
  { value: "prepositional", label: "Preposition — Under the, At midnight" },
  { value: "-ed", label: "-Ed — Exhausted, Convinced" },
  { value: "short punchy", label: "Short punchy — Stop. Listen." },
];

function getMilestone(count) {
  if (count >= 7) return { emoji: "🏆", text: "Writing superstar!" };
  if (count >= 5) return { emoji: "⭐", text: "Amazing progress!" };
  if (count >= 3) return { emoji: "🔥", text: "You're on a roll!" };
  if (count >= 1) return { emoji: "👍", text: "Great start!" };
  return null;
}

export default function StudentWritePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [teacherComment, setTeacherComment] = useState(null);
  const [submissionId, setSubmissionId] = useState(null);
  const [pastSubmissions, setPastSubmissions] = useState([]);
  const [expandedPastId, setExpandedPastId] = useState(null);
  const [showPastWork, setShowPastWork] = useState(false);

  const [iterations, setIterations] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState(0);
  const [isRevising, setIsRevising] = useState(false);
  const [editText, setEditText] = useState("");

  // Planning mode state
  const [mode, setMode] = useState("planning"); // "planning" | "writing"
  const [brainstormText, setBrainstormText] = useState("");
  const [planWowWords, setPlanWowWords] = useState(["", ""]);
  const [planOpenerType, setPlanOpenerType] = useState("");
  const [planConnective, setPlanConnective] = useState("");
  const [showPlanPanel, setShowPlanPanel] = useState(false); // collapsed by default

  const [pastSelectedVersions, setPastSelectedVersions] = useState({});
  const [broadcasts, setBroadcasts] = useState([]);

  const [feedbackMood, setFeedbackMood] = useState(null);
  const [feedbackHelped, setFeedbackHelped] = useState([]);
  const [feedbackDifficult, setFeedbackDifficult] = useState([]);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [feedbackAlreadyDone, setFeedbackAlreadyDone] = useState(false);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);

  // Feedback sliders (1-3, default 1)
  const [feedbackLevel, setFeedbackLevel] = useState(1);
  const [feedbackAmount, setFeedbackAmount] = useState(1);

  // 10 toggles, ALL default OFF — student sees clean text first
  const [hiddenDimensions, setHiddenDimensions] = useState(new Set([
    "V_praise", "V_suggestion", "C_praise", "C_suggestion",
    "O_praise", "O_suggestion", "P_praise", "P_suggestion",
    "spelling", "grammar",
  ]));
  const [showLegend, setShowLegend] = useState(false);

  // Side-by-side scroll sync
  const leftScrollRef = useRef(null);
  const rightScrollRef = useRef(null);
  const scrollingRef = useRef(null); // tracks which side is driving scroll

  const handleSyncScroll = useCallback((source) => {
    if (scrollingRef.current && scrollingRef.current !== source) return;
    scrollingRef.current = source;
    const left = leftScrollRef.current;
    const right = rightScrollRef.current;
    if (!left || !right) return;

    if (source === "left") {
      const ratio = left.scrollTop / (left.scrollHeight - left.clientHeight || 1);
      right.scrollTop = ratio * (right.scrollHeight - right.clientHeight || 1);
    } else {
      const ratio = right.scrollTop / (right.scrollHeight - right.clientHeight || 1);
      left.scrollTop = ratio * (left.scrollHeight - left.clientHeight || 1);
    }

    requestAnimationFrame(() => { scrollingRef.current = null; });
  }, []);

  const toggleDimension = (dim) => {
    setHiddenDimensions((prev) => {
      const next = new Set(prev);
      if (next.has(dim)) { next.delete(dim); } else { next.add(dim); }
      return next;
    });
  };

  // Compute cumulative progress stats (all revisions vs first draft)
  const progressStats = useMemo(() => {
    if (iterations.length < 2) return null;

    // Count improvements the student actually sees (all revision_good annotations)
    const latestAnns = iterations[iterations.length - 1].annotations || [];
    const latestGood = latestAnns.filter((a) => a.type === "revision_good");
    const latestAttempted = latestAnns.filter((a) => a.type === "revision_attempted");

    const totalFixed = latestGood.length;
    const totalAttempted = latestAttempted.length;

    // This round: compare latest vs previous iteration
    const v1Annotations = iterations[0].annotations || [];
    const prevAnns = iterations.length >= 3 ? iterations[iterations.length - 2].annotations || [] : v1Annotations;
    const prevGoodCount = prevAnns.filter((a) => a.type === "revision_good").length;
    const thisRoundFixed = Math.max(0, latestGood.length - prevGoodCount);

    // Breakdown by category
    const fixedByDim = {};
    let spellingFixes = 0;
    let grammarFixes = 0;
    for (const good of latestGood) {
      const origType = good.originalType;
      if (origType === "spelling") {
        spellingFixes++;
      } else if (origType === "grammar") {
        grammarFixes++;
      } else if (good.dimension) {
        fixedByDim[good.dimension] = (fixedByDim[good.dimension] || 0) + 1;
      }
    }

    const breakdown = [];
    for (const [dim, count] of Object.entries(fixedByDim)) {
      breakdown.push(`+${count} ${VCOP_DIM_LABELS[dim] || dim}${count > 1 ? "s" : ""}`);
    }
    if (spellingFixes > 0) {
      breakdown.push(`+${spellingFixes} spelling fix${spellingFixes > 1 ? "es" : ""}`);
    }
    if (grammarFixes > 0) {
      breakdown.push(`+${grammarFixes} grammar fix${grammarFixes > 1 ? "es" : ""}`);
    }

    const milestone = getMilestone(totalFixed);

    return {
      totalFixed,
      totalAttempted,
      thisRoundFixed,
      breakdown,
      milestone,
      version: iterations.length,
    };
  }, [iterations]);

  // Fetch active session
  useEffect(() => {
    const q = query(collection(db, "sessions"), where("active", "==", true), limit(1));
    getDocs(q)
      .then((snap) => {
        if (!snap.empty) {
          const sessionDoc = snap.docs[0];
          setSession({ id: sessionDoc.id, ...sessionDoc.data() });
        } else {
          setSession(null);
        }
      })
      .catch((err) => console.error("Session fetch error:", err))
      .finally(() => setSessionLoading(false));
  }, []);

  useEffect(() => {
    if (!submissionId) return;
    const unsub = onSnapshot(doc(db, "submissions", submissionId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.teacherComment) setTeacherComment(data.teacherComment);
      }
    });
    return unsub;
  }, [submissionId]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "submissions"), where("studentId", "==", user.studentId));
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => s.id !== submissionId)
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setPastSubmissions(items);
    });
    return unsub;
  }, [user, submissionId]);

  useEffect(() => {
    if (!session || !user) return;
    const q = query(
      collection(db, "broadcasts"),
      where("sessionId", "==", session.id),
      where("targetStudentIds", "array-contains", user.studentId)
    );
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((b) => !(b.dismissedBy || []).includes(user.studentId))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setBroadcasts(items);
    });
    return unsub;
  }, [session, user]);

  useEffect(() => {
    if (!session || !user) return;
    const q = query(collection(db, "feedback"), where("studentId", "==", user.studentId), where("sessionId", "==", session.id), limit(1));
    getDocs(q)
      .then((snap) => { if (!snap.empty) setFeedbackAlreadyDone(true); })
      .catch((err) => console.error("Feedback check error:", err));
  }, [session, user]);

  const handleSubmitFeedback = async () => {
    if (!feedbackMood || !session || !user) return;
    try {
      await addDoc(collection(db, "feedback"), {
        studentId: user.studentId, sessionId: session.id,
        mood: feedbackMood, helpedMost: feedbackHelped, difficult: feedbackDifficult,
        comment: feedbackComment.trim(), createdAt: serverTimestamp(),
      });
      setFeedbackSubmitted(true);
    } catch (err) { console.error("Failed to submit feedback:", err); }
  };

  const toggleFeedbackChoice = (list, setList, value) => {
    setList((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]);
  };

  const handleDismissBroadcast = async (broadcastId) => {
    try {
      await updateDoc(doc(db, "broadcasts", broadcastId), { dismissedBy: arrayUnion(user.studentId) });
    } catch (err) { console.error("Failed to dismiss broadcast:", err); }
  };

  const handleLogout = () => { logout(); navigate("/"); };

  // Log missing VCOP dimensions (no fallback — prompt should handle it)
  const logDimensionCoverage = (annotations) => {
    const vcopDims = (session?.vcopFocus || ["V", "C", "O", "P"]).filter(d => ["V", "C", "O", "P"].includes(d));
    const dimLabels = { V: "Vocabulary", C: "Connectives", O: "Openers", P: "Punctuation" };

    for (const dim of vcopDims) {
      const hasPraise = annotations.some(a => a.type === "praise" && a.dimension === dim);
      const hasSuggestion = annotations.some(a => a.type === "suggestion" && a.dimension === dim);

      if (!hasPraise) {
        console.error(`[VCOP COVERAGE GAP] Missing PRAISE for dimension ${dim} (${dimLabels[dim]}). AI failed to provide praise for this dimension.`);
      }
      if (!hasSuggestion) {
        console.error(`[VCOP COVERAGE GAP] Missing SUGGESTION for dimension ${dim} (${dimLabels[dim]}). AI failed to provide suggestion for this dimension.`);
      }
    }
  };

  const handleSubmit = async () => {
    if (!text.trim() || !session) return;
    setLoading(true);
    setError(null);
    setIterations([]);
    setIsRevising(false);
    setTeacherComment(null);

    try {
      const plan = buildPlanData();
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text, sessionId: session.id, studentId: user.studentId,
          vcopFocus: session.vcopFocus, topic: session.topic,
          extraInstructions: session.extraInstructions, feedbackLevel, feedbackAmount,
          plan,
        }),
      });
      console.log(`[SUBMIT] feedbackLevel=${feedbackLevel}, feedbackAmount=${feedbackAmount}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Something went wrong");
      }
      const data = await res.json();
      console.log(`[SUBMIT] Got ${data.annotations?.length} annotations`);
      setSubmissionId(data.submissionId);
      logDimensionCoverage(data.annotations);
      setIterations([{ version: 1, text: text.trim(), annotations: data.annotations, changedWords: null }]);
      setSelectedVersion(0);

      // Fire-and-forget profile update
      fetch("/api/update-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: user.studentId,
          annotations: data.annotations,
          sessionTopic: session.topic || "",
        }),
      }).catch((err) => console.warn("[PROFILE UPDATE] Failed:", err.message));
    } catch (err) {
      setError(err.message || "Could not analyse your writing. Please try again!");
    } finally { setLoading(false); }
  };

  const handleReviseClick = () => {
    const lastIteration = iterations[iterations.length - 1];
    setEditText(lastIteration.text);
    setIsRevising(true);
  };

  const handleSubmitRevision = async () => {
    const prevIteration = iterations[iterations.length - 1];
    const changedWords = getChangedWordIndices(prevIteration.text, editText);
    const newVersion = iterations.length + 1;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: editText, sessionId: session.id, studentId: user.studentId,
          vcopFocus: session.vcopFocus, topic: session.topic,
          extraInstructions: session.extraInstructions, feedbackLevel, feedbackAmount,
          submissionId, iterationNumber: newVersion,
          previousText: iterations[0].text, previousAnnotations: iterations[0].annotations,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Something went wrong");
      }
      const data = await res.json();
      const newIteration = { version: newVersion, text: editText.trim(), annotations: data.annotations, changedWords };
      setIterations((prev) => [...prev, newIteration]);
      setSelectedVersion(iterations.length);
      setIsRevising(false);

      // Fire-and-forget profile update
      fetch("/api/update-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: user.studentId,
          annotations: data.annotations,
          sessionTopic: session.topic || "",
        }),
      }).catch((err) => console.warn("[PROFILE UPDATE] Failed:", err.message));
    } catch (err) {
      setError(err.message || "Could not analyse your revision. Please try again!");
    } finally { setLoading(false); }
  };

  const handleSpeechTranscript = (transcript) => {
    setText((prev) => (prev ? prev + " " + transcript : transcript));
  };

  const handleBrainstormTranscript = (transcript) => {
    setBrainstormText((prev) => (prev ? prev + " " + transcript : transcript));
  };

  // Build plan object for API/Firestore
  const buildPlanData = () => {
    const hasAnyPlan = brainstormText.trim() ||
      planWowWords.some(w => w.trim()) || planOpenerType || planConnective.trim();
    if (!hasAnyPlan) return null;
    return {
      brainstorm: brainstormText.trim(),
      wowWords: planWowWords.map(w => w.trim()).filter(Boolean),
      openerType: planOpenerType,
      connective: planConnective.trim(),
    };
  };

  if (sessionLoading) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Silvermine Bay School VCOP Coach ✏️</h1>
          <p className="subtitle">Loading...</p>
        </header>
      </div>
    );
  }

  const currentIteration = iterations[selectedVersion] || null;
  const hasSubmitted = iterations.length > 0;
  const planData = buildPlanData();
  const hasPlan = planData !== null;

  return (
    <div className={`app ${hasSubmitted ? "app-compact" : ""} ${isRevising ? "app-revising" : ""}`}>
      <header className={`app-header ${hasSubmitted ? "app-header-compact" : ""}`}>
        <div className="page-header">
          <h1>Silvermine Bay School VCOP Coach ✏️</h1>
          <button className="logout-button" onClick={handleLogout}>Log out</button>
        </div>
      </header>

      <main className="app-main">
        {!session ? (
          <div className="no-session">
            <p>No active session right now. Ask your teacher to start one!</p>
          </div>
        ) : (
          <>
            {/* Broadcast banners (only if any) */}
            {broadcasts.map((b) => (
              <div key={b.id} className="broadcast-banner">
                <div className="broadcast-banner-content">
                  <p>{b.message}</p>
                  <div className="broadcast-time">
                    {b.createdAt?.toDate
                      ? b.createdAt.toDate().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
                      : ""}
                  </div>
                </div>
                <button className="broadcast-dismiss" onClick={() => handleDismissBroadcast(b.id)} title="Dismiss">✕</button>
              </div>
            ))}

            {/* Mode tabs — only before submission */}
            {iterations.length === 0 && (
              <div className="mode-tabs">
                <button
                  className={`mode-tab ${mode === "planning" ? "active" : ""}`}
                  onClick={() => setMode("planning")}
                >
                  Planning
                </button>
                <button
                  className={`mode-tab ${mode === "writing" ? "active" : ""}`}
                  onClick={() => setMode("writing")}
                >
                  Writing
                </button>
              </div>
            )}

            {/* ===== PLANNING MODE ===== */}
            {iterations.length === 0 && mode === "planning" && (
              <div className="planning-section">
                <div className="brainstorm-area">
                  <label className="planning-label">Tell me about your writing. Who is in it? Where does it happen? What goes wrong?</label>
                  <textarea
                    className="writing-input brainstorm-input"
                    placeholder="Brainstorm your ideas here... or tap the microphone to speak!"
                    value={brainstormText}
                    onChange={(e) => setBrainstormText(e.target.value)}
                    rows={6}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                  />
                  <SpeechInput onTranscript={handleBrainstormTranscript} disabled={false} large />
                </div>

                <div className="vcop-challenge">
                  <label className="planning-label">VCOP Challenge</label>
                  <div className="vcop-challenge-row">
                    <label className="vcop-challenge-label">WOW words I want to try:</label>
                    <div className="vcop-challenge-inputs">
                      <input
                        type="text"
                        className="vcop-challenge-input"
                        placeholder="e.g. magnificent"
                        value={planWowWords[0]}
                        onChange={(e) => setPlanWowWords([e.target.value, planWowWords[1]])}
                        spellCheck={false}
                        autoCorrect="off"
                        autoCapitalize="off"
                      />
                      <input
                        type="text"
                        className="vcop-challenge-input"
                        placeholder="e.g. trembling"
                        value={planWowWords[1]}
                        onChange={(e) => setPlanWowWords([planWowWords[0], e.target.value])}
                        spellCheck={false}
                        autoCorrect="off"
                        autoCapitalize="off"
                      />
                    </div>
                  </div>
                  <div className="vcop-challenge-row">
                    <label className="vcop-challenge-label">Opener type I'll try:</label>
                    <select
                      className="vcop-challenge-select"
                      value={planOpenerType}
                      onChange={(e) => setPlanOpenerType(e.target.value)}
                    >
                      {ISPACED_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="vcop-challenge-row">
                    <label className="vcop-challenge-label">A connective I haven't used before:</label>
                    <input
                      type="text"
                      className="vcop-challenge-input"
                      placeholder="e.g. although"
                      value={planConnective}
                      onChange={(e) => setPlanConnective(e.target.value)}
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                    />
                  </div>
                </div>

                <button className="analyze-button plan-ready-btn" onClick={() => setMode("writing")}>
                  Ready to write →
                </button>
              </div>
            )}

            {/* ===== WRITING MODE — before submission ===== */}
            {iterations.length === 0 && mode === "writing" && (
              <div className="writing-mode-layout">
                {/* Collapsible plan summary above writing */}
                {hasPlan && (
                  <div className={`plan-summary-bar ${showPlanPanel ? "plan-summary-open" : ""}`}>
                    <button className="plan-summary-toggle" onClick={() => setShowPlanPanel(!showPlanPanel)}>
                      <span className="plan-summary-line">
                        📋 My Plan: {[
                          planWowWords.filter(w => w.trim()).join(", "),
                          planOpenerType ? `${planOpenerType} opener` : "",
                          planConnective.trim(),
                        ].filter(Boolean).join(" · ") || "brainstorm notes"}
                      </span>
                      <span className="plan-summary-arrow">{showPlanPanel ? "▲" : "▼"}</span>
                    </button>
                    {showPlanPanel && (
                      <div className="plan-summary-detail">
                        {brainstormText.trim() && (
                          <div className="plan-summary-item">
                            <span className="plan-summary-label">Brainstorm:</span>
                            <span className="plan-summary-text">{brainstormText}</span>
                          </div>
                        )}
                        {planWowWords.some(w => w.trim()) && (
                          <div className="plan-summary-item">
                            <span className="plan-summary-label">WOW words:</span>
                            <span className="plan-summary-text">{planWowWords.filter(w => w.trim()).join(", ")}</span>
                          </div>
                        )}
                        {planOpenerType && (
                          <div className="plan-summary-item">
                            <span className="plan-summary-label">Opener:</span>
                            <span className="plan-summary-text">{planOpenerType}</span>
                          </div>
                        )}
                        {planConnective.trim() && (
                          <div className="plan-summary-item">
                            <span className="plan-summary-label">Connective:</span>
                            <span className="plan-summary-text">{planConnective}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="writing-area">
                  <textarea
                    className="writing-input"
                    placeholder="Start writing here... or tap the microphone to speak!"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    disabled={loading}
                    rows={8}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                  />
                  <SpeechInput onTranscript={handleSpeechTranscript} disabled={loading} />
                </div>
                <div className="feedback-sliders">
                  <div className="feedback-slider-row">
                    <span className="feedback-slider-label">Level</span>
                    <span className="feedback-slider-end">1</span>
                    <input type="range" min="1" max="3" value={feedbackLevel}
                      onChange={(e) => setFeedbackLevel(Number(e.target.value))}
                      className="feedback-depth-input" />
                    <span className="feedback-slider-end">3</span>
                  </div>
                  <div className="feedback-slider-row">
                    <span className="feedback-slider-label">Amount</span>
                    <span className="feedback-slider-end">1</span>
                    <input type="range" min="1" max="3" value={feedbackAmount}
                      onChange={(e) => setFeedbackAmount(Number(e.target.value))}
                      className="feedback-depth-input" />
                    <span className="feedback-slider-end">3</span>
                  </div>
                </div>
                <button className="analyze-button" onClick={handleSubmit} disabled={loading || !text.trim()}>
                  {loading ? (
                    <span className="button-loading"><span className="spinner" />Analysing...</span>
                  ) : "Submit My Writing ✨"}
                </button>
              </div>
            )}

            {loading && (
              <div className="analyzing-overlay">
                <div className="analyzing-pencil">✏️</div>
                <div className="analyzing-text">Reading your writing...</div>
                <div className="analyzing-dots">
                  <span className="analyzing-dot" />
                  <span className="analyzing-dot" />
                  <span className="analyzing-dot" />
                </div>
              </div>
            )}

            {error && (
              <div className="error-message"><p>{error}</p></div>
            )}

            {/* === PROGRESS SUMMARY PANEL (after any revision) === */}
            {progressStats && (
              <div className="progress-summary">
                {progressStats.milestone && (
                  <div className="milestone-badge">
                    <span className="milestone-emoji">{progressStats.milestone.emoji}</span>
                    <span className="milestone-text">{progressStats.milestone.text}</span>
                  </div>
                )}

                <h2 className="progress-summary-title">
                  {progressStats.totalFixed > 0
                    ? `You've made ${progressStats.totalFixed} improvement${progressStats.totalFixed !== 1 ? "s" : ""}! 🎉`
                    : "Keep going! Try clicking on the suggestions to see what to change."}
                </h2>

                {progressStats.thisRoundFixed > 0 && (
                  <div className="progress-this-round">
                    {progressStats.thisRoundFixed >= 3
                      ? `✅ Wow! You improved ${progressStats.thisRoundFixed} things this round!`
                      : "✅ Nice! You improved something this round!"}
                  </div>
                )}

                {progressStats.totalFixed > 0 && (
                  <div className="improvement-progress">
                    <div className="improvement-progress-track">
                      <div
                        className="improvement-progress-fill"
                        style={{ width: `${Math.min(100, progressStats.totalFixed * 14)}%` }}
                      />
                    </div>
                  </div>
                )}

                {progressStats.breakdown.length > 0 && (
                  <div className="progress-breakdown">
                    <span className="progress-breakdown-label">Since your first draft:</span>
                    {progressStats.breakdown.map((item, i) => (
                      <span key={i} className="progress-breakdown-chip">{item}</span>
                    ))}
                  </div>
                )}

              </div>
            )}

            {/* Iterations display */}
            {iterations.length > 0 && (
              <div className="revision-section">
                {/* Version tabs */}
                {iterations.length > 1 && (
                  <div className="version-tabs">
                    {iterations.map((iter, idx) => (
                      <button
                        key={idx}
                        className={`version-tab ${selectedVersion === idx ? "active" : ""}`}
                        onClick={() => setSelectedVersion(idx)}
                      >
                        {idx === 0 ? "First draft" : `v${iter.version}`}
                      </button>
                    ))}
                  </div>
                )}

                {/* Compact toggles + collapsible legend */}
                {currentIteration && (
                  <div className="post-submit-controls">
                    <VcopFilterBar
                      hiddenDimensions={hiddenDimensions}
                      onToggle={toggleDimension}
                    />
                    <button
                      className="legend-toggle-btn"
                      onClick={() => setShowLegend((v) => !v)}
                    >
                      {showLegend ? "Hide legend" : "Legend"}
                    </button>
                  </div>
                )}
                {showLegend && currentIteration && (
                  <FeedbackLegend isRevision={currentIteration.version > 1} />
                )}

                {/* Side-by-side when revising, full-width otherwise */}
                {currentIteration && !isRevising && (
                  <>
                    <AnnotatedText
                      text={currentIteration.text}
                      annotations={currentIteration.annotations}
                      changedWords={currentIteration.changedWords}
                      hiddenDimensions={hiddenDimensions}
                    />
                    {!loading && (
                      <div className="revision-actions">
                        <button className="revise-button" onClick={handleReviseClick}>
                          Revise my writing ✏️
                        </button>
                        <button
                          className="show-teacher-button"
                          onClick={() => {
                            setSelectedVersion(iterations.length - 1);
                            alert("Your teacher can see your writing on their dashboard! 🎉");
                          }}
                        >
                          Show my teacher 👀
                        </button>
                      </div>
                    )}
                  </>
                )}

                {currentIteration && isRevising && (
                  <>
                    <div className="side-by-side">
                      <div className="side-by-side-left">
                        <div className="side-by-side-header">AI Feedback</div>
                        <div className="side-by-side-scroll" ref={leftScrollRef} onScroll={() => handleSyncScroll("left")}>
                          <AnnotatedText
                            text={currentIteration.text}
                            annotations={currentIteration.annotations}
                            changedWords={currentIteration.changedWords}
                            hiddenDimensions={hiddenDimensions}
                          />
                        </div>
                      </div>
                      <div className="side-by-side-right">
                        <div className="side-by-side-header">Your revision</div>
                        <HighlightedEditor
                          value={editText}
                          onChange={setEditText}
                          annotations={currentIteration.annotations}
                          hiddenDimensions={hiddenDimensions}
                          scrollRef={rightScrollRef}
                          onSyncScroll={() => handleSyncScroll("right")}
                        />
                      </div>
                    </div>
                    <button
                      className="submit-revision-btn"
                      onClick={handleSubmitRevision}
                      disabled={loading || !editText.trim() || editText.trim() === iterations[iterations.length - 1].text.trim()}
                    >
                      {loading ? (
                        <span className="button-loading"><span className="spinner" />Analysing...</span>
                      ) : "Submit Revision ✨"}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Plan summary after submission (collapsible reference) */}
            {hasSubmitted && hasPlan && (
              <div className={`plan-summary-bar plan-summary-post ${showPlanPanel ? "plan-summary-open" : ""}`}>
                <button className="plan-summary-toggle" onClick={() => setShowPlanPanel(!showPlanPanel)}>
                  <span className="plan-summary-line">
                    📋 My Plan: {[
                      planWowWords.filter(w => w.trim()).join(", "),
                      planOpenerType ? `${planOpenerType} opener` : "",
                      planConnective.trim(),
                    ].filter(Boolean).join(" · ") || "brainstorm notes"}
                  </span>
                  <span className="plan-summary-arrow">{showPlanPanel ? "▲" : "▼"}</span>
                </button>
                {showPlanPanel && (
                  <div className="plan-summary-detail">
                    {brainstormText.trim() && (
                      <div className="plan-summary-item">
                        <span className="plan-summary-label">Brainstorm:</span>
                        <span className="plan-summary-text">{brainstormText}</span>
                      </div>
                    )}
                    {planWowWords.some(w => w.trim()) && (
                      <div className="plan-summary-item">
                        <span className="plan-summary-label">WOW words:</span>
                        <span className="plan-summary-text">{planWowWords.filter(w => w.trim()).join(", ")}</span>
                      </div>
                    )}
                    {planOpenerType && (
                      <div className="plan-summary-item">
                        <span className="plan-summary-label">Opener:</span>
                        <span className="plan-summary-text">{planOpenerType}</span>
                      </div>
                    )}
                    {planConnective.trim() && (
                      <div className="plan-summary-item">
                        <span className="plan-summary-label">Connective:</span>
                        <span className="plan-summary-text">{planConnective}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {teacherComment && (
              <div className="teacher-comment">
                <h3>Your teacher says:</h3>
                <p>{teacherComment}</p>
              </div>
            )}
          </>
        )}

        {/* Student Feedback Survey — always available, hidden by default */}
        {session && !feedbackAlreadyDone && !feedbackSubmitted && !showFeedbackForm && (
          <div className="feedback-toggle-wrapper">
            <button className="feedback-toggle-btn" onClick={() => setShowFeedbackForm(true)}>
              Give feedback 📝
            </button>
          </div>
        )}
        {(feedbackAlreadyDone || feedbackSubmitted) && (
          <div className="student-feedback-section">
            <div className="feedback-submitted">Thanks for your feedback! 🙏</div>
          </div>
        )}
        {session && showFeedbackForm && !feedbackAlreadyDone && !feedbackSubmitted && (
          <div className="student-feedback-section">
            <h3>How was today's session?</h3>
            <div className="mood-selector">
              {[
                { value: 1, emoji: "😫" }, { value: 2, emoji: "😕" },
                { value: 3, emoji: "😐" }, { value: 4, emoji: "🙂" }, { value: 5, emoji: "🤩" },
              ].map((m) => (
                <button key={m.value} className={`mood-btn ${feedbackMood === m.value ? "active" : ""}`} onClick={() => setFeedbackMood(m.value)}>
                  {m.emoji}
                </button>
              ))}
            </div>
            <label className="feedback-question">What helped you most?</label>
            <div className="multi-choice-group">
              {["AI feedback", "Seeing my old writing", "Speech input"].map((opt) => (
                <button key={opt} className={`choice-chip ${feedbackHelped.includes(opt) ? "active" : ""}`} onClick={() => toggleFeedbackChoice(feedbackHelped, setFeedbackHelped, opt)}>
                  {opt}
                </button>
              ))}
            </div>
            <label className="feedback-question">What was difficult?</label>
            <div className="multi-choice-group">
              {["Understanding the feedback", "Knowing how to improve", "The app was confusing", "Nothing, it was easy"].map((opt) => (
                <button key={opt} className={`choice-chip ${feedbackDifficult.includes(opt) ? "active" : ""}`} onClick={() => toggleFeedbackChoice(feedbackDifficult, setFeedbackDifficult, opt)}>
                  {opt}
                </button>
              ))}
            </div>
            <textarea className="writing-input" placeholder="Anything else you want to say? (optional)" value={feedbackComment} onChange={(e) => setFeedbackComment(e.target.value)} rows={2} spellCheck={false} autoCorrect="off" autoCapitalize="off" />
            <button className="analyze-button" onClick={handleSubmitFeedback} disabled={!feedbackMood} style={{ marginTop: 12, marginBottom: 0 }}>
              Submit Feedback
            </button>
          </div>
        )}

        {/* Past Work Section */}
        <div className="past-work-section">
          <button className="past-work-toggle" onClick={() => setShowPastWork(!showPastWork)}>
            <span>My Past Work</span>
            <span className="past-work-count">{pastSubmissions.length}</span>
            <span className="submission-toggle">{showPastWork ? "▲" : "▼"}</span>
          </button>
          {showPastWork && (
            <div className="past-work-list">
              {pastSubmissions.length === 0 ? (
                <p className="no-submissions-text">No past work yet</p>
              ) : (
                pastSubmissions.map((sub) => {
                  const hasIterations = sub.iterations && sub.iterations.length > 0;
                  const pastVersion = pastSelectedVersions[sub.id] || 0;
                  return (
                    <div key={sub.id} className="past-submission-card">
                      <div className="past-submission-header" onClick={() => setExpandedPastId(expandedPastId === sub.id ? null : sub.id)}>
                        <span className="past-submission-topic">
                          {sub.sessionTopic || "Writing"}
                          {hasIterations && <span className="iteration-badge">{sub.iterations.length}</span>}
                        </span>
                        <span className="submission-time">{sub.createdAt?.toDate?.() ? sub.createdAt.toDate().toLocaleDateString() : ""}</span>
                        <span className="submission-toggle">{expandedPastId === sub.id ? "▲" : "▼"}</span>
                      </div>
                      {expandedPastId === sub.id && (
                        <div className="past-submission-detail">
                          {hasIterations ? (
                            <>
                              {sub.iterations.length > 1 && (
                                <div className="version-tabs">
                                  {sub.iterations.map((iter, idx) => (
                                    <button key={idx} className={`version-tab ${pastVersion === idx ? "active" : ""}`} onClick={() => setPastSelectedVersions((prev) => ({ ...prev, [sub.id]: idx }))}>
                                      v{iter.version}
                                    </button>
                                  ))}
                                </div>
                              )}
                              <AnnotatedText text={sub.iterations[pastVersion]?.text || ""} annotations={sub.iterations[pastVersion]?.annotations || []} changedWords={null} />
                            </>
                          ) : (
                            <div className="submission-full-text"><h3>Your writing</h3><p>{sub.text}</p></div>
                          )}
                          {sub.teacherComment && (
                            <div className="teacher-comment"><h3>Your teacher says:</h3><p>{sub.teacherComment}</p></div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
