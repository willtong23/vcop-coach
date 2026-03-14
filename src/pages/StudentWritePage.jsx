import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { collection, query, where, limit, onSnapshot, doc, getDocs, updateDoc, addDoc, arrayUnion, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import SpeechInput from "../components/SpeechInput";
import AnnotatedText, { FeedbackLegend, VcopFilterBar } from "../components/AnnotatedText";
import HighlightedEditor from "../components/HighlightedEditor";
import LiveCoachMode from "../components/LiveCoachMode";
import { getChangedWordIndices } from "../utils/wordDiff";
import useAutoSave from "../utils/useAutoSave";

const YEAR_GROUP_MAP = { "19": "Y6", "20": "Y5", "21": "Y4" };
function getStudentYear(studentId) {
  if (!studentId) return null;
  return YEAR_GROUP_MAP[studentId.slice(0, 2)] || null;
}

const VCOP_DIM_LABELS = { V: "vocabulary upgrade", C: "connective improvement", O: "better opener", P: "punctuation fix" };

const ALL_CONNECTIVES = [
  "and", "but", "so", "then",
  "because", "when", "if", "or",
  "after", "while", "as well as", "also", "besides", "before", "until",
  "although", "however", "even though", "nevertheless", "meanwhile", "furthermore", "therefore",
  "despite", "contrary to", "in addition to", "owing to", "consequently", "whereas",
];

const ALL_PUNCTUATION = [
  { label: ", comma", value: "comma" },
  { label: "! exclamation mark", value: "exclamation mark" },
  { label: "? question mark", value: "question mark" },
  { label: "' apostrophe", value: "apostrophe" },
  { label: '" " speech marks', value: "speech marks" },
  { label: "; semicolon", value: "semicolon" },
  { label: ": colon", value: "colon" },
  { label: "( ) brackets", value: "brackets" },
  { label: "— dash", value: "dash" },
  { label: "... ellipsis", value: "ellipsis" },
];

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
  // 拖放上傳檔案 — drag-and-drop state
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileLoaded, setFileLoaded] = useState(false);
  const dragCounter = useRef(0);
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
  const [mode, setMode] = useState("planning"); // "planning" | "writing" | "livecoach"
  const [brainstormText, setBrainstormText] = useState("");
  const [planWowWords, setPlanWowWords] = useState(["", ""]);
  const [planOpenerType, setPlanOpenerType] = useState("");
  const [planConnectives, setPlanConnectives] = useState([]);
  const [planPunctuation, setPlanPunctuation] = useState([]);
  const [showPlanPanel, setShowPlanPanel] = useState(false); // collapsed by default

  const [pastSelectedVersions, setPastSelectedVersions] = useState({});
  const [pastGrades, setPastGrades] = useState({}); // { submissionId: "Y4" | "Standard 3" ... }
  const [broadcasts, setBroadcasts] = useState([]);

  const [feedbackMood, setFeedbackMood] = useState(null);
  const [feedbackHelped, setFeedbackHelped] = useState([]);
  const [feedbackDifficult, setFeedbackDifficult] = useState([]);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);

  // Auto-save draft state
  const { saveDraft, saveNow, loadDraft, clearDraft, saveStatus } = useAutoSave(user?.studentId, session?.id);
  const [draftPrompt, setDraftPrompt] = useState(null); // holds loaded draft data
  const [draftLoading, setDraftLoading] = useState(true);
  // Live Coach auto-save data (passed up from LiveCoachMode)
  const [liveCoachData, setLiveCoachData] = useState(null);

  // Self-assessment before revealing AI feedback
  const [selfAssessment, setSelfAssessment] = useState({});
  const [showSelfAssess, setShowSelfAssess] = useState(false);
  const [pendingIterationData, setPendingIterationData] = useState(null);

  // Feedback sliders (1-3, default 1)
  const [feedbackLevel, setFeedbackLevel] = useState(1);
  const [feedbackAmount, setFeedbackAmount] = useState(1);

  // 10 toggles, ALL default OFF — student sees clean text first, clicks to reveal
  const [hiddenDimensions, setHiddenDimensions] = useState(new Set([
    "V_praise", "V_suggestion", "C_praise", "C_suggestion",
    "O_praise", "O_suggestion", "P_praise", "P_suggestion",
    "spelling", "grammar",
  ]));
  const [showLegend, setShowLegend] = useState(false);
  const [showChanges, setShowChanges] = useState(true);
  const [showGlobalProgress, setShowGlobalProgress] = useState(false);

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

  // 共用工具函數
  const CONN_LIST = useMemo(() => [
    "even though", "as a result", "on the other hand",
    "however", "therefore", "nevertheless", "furthermore", "moreover", "despite", "meanwhile",
    "although", "because", "while", "until", "after", "before", "since", "when", "if", "unless",
    "but", "so", "or", "and", "yet", "then",
  ], []);

  // 偵測標點變化 — 比較兩個版本的標點符號
  const detectPunctuationChanges = useCallback((oldText, newText) => {
    const PUNCT = /[.!?,;:'"—]/g;
    const extractPunct = (text) => {
      const results = [];
      // 取得每個標點和它前面的單字作為 context
      const words = text.split(/\s+/);
      let pos = 0;
      for (const word of words) {
        const puncts = word.match(PUNCT);
        const cleanWord = word.replace(PUNCT, "");
        if (puncts) {
          for (const p of puncts) {
            results.push({ punct: p, context: cleanWord || "(start)", pos });
          }
        }
        pos++;
      }
      return results;
    };

    const oldPuncts = extractPunct(oldText);
    const newPuncts = extractPunct(newText);
    const changes = [];

    // 找替換的標點（同位置不同標點）
    const oldByCtx = {};
    for (const p of oldPuncts) {
      const key = `${p.context.toLowerCase()}_${p.pos}`;
      if (!oldByCtx[key]) oldByCtx[key] = [];
      oldByCtx[key].push(p.punct);
    }
    const newByCtx = {};
    for (const p of newPuncts) {
      const key = `${p.context.toLowerCase()}_${p.pos}`;
      if (!newByCtx[key]) newByCtx[key] = [];
      newByCtx[key].push(p.punct);
    }

    // 比較每個 context 的標點
    const allKeys = new Set([...Object.keys(oldByCtx), ...Object.keys(newByCtx)]);
    for (const key of allKeys) {
      const oldP = (oldByCtx[key] || []).join("");
      const newP = (newByCtx[key] || []).join("");
      if (oldP !== newP) {
        const ctx = key.split("_")[0];
        if (oldP && newP) {
          changes.push({ type: "changed", old: oldP, new: newP, context: ctx });
        } else if (!oldP && newP) {
          changes.push({ type: "added", new: newP, context: ctx });
        }
      }
    }
    return changes;
  }, []);

  // "What you changed" — 比較上一版 vs 最新版（只顯示這一輪改了什麼）
  const changesSummary = useMemo(() => {
    if (iterations.length < 2) return null;

    const prevIdx = iterations.length - 2;
    const prevAnns = iterations[prevIdx].annotations || [];
    const prevText = iterations[prevIdx].text || "";
    const latestAnns = iterations[iterations.length - 1].annotations || [];
    const latestText = iterations[iterations.length - 1].text || "";

    // revision 永遠與 v1 比對，所以 revision_good 的 originalPhrase 都是 v1 的
    // 這一輪新增的 revision_good = latest 有但 prev 沒有的
    const prevGoodPhrases = new Set(
      prevAnns.filter(a => a.type === "revision_good").map(a => a.originalPhrase)
    );
    const newGood = latestAnns.filter(
      a => a.type === "revision_good" && !prevGoodPhrases.has(a.originalPhrase)
    );

    // 從 v1 annotations 查找每個 revision_good 的原始類型
    const v1Anns = iterations[0].annotations || [];

    // 1. Spelling fixes this round
    const spellingItems = [];
    for (const good of newGood) {
      const v1Match = v1Anns.find(a => a.type === "spelling" && a.phrase === good.originalPhrase);
      if (v1Match) {
        spellingItems.push({ old: good.originalPhrase, new: good.phrase, done: true });
      }
    }
    // 未修的 spelling（仍在 latest 中）
    const v1Spelling = v1Anns.filter(a => a.type === "spelling");
    for (const sp of v1Spelling) {
      const alreadyFixed = latestAnns.some(a => a.type === "revision_good" && a.originalPhrase === sp.phrase);
      if (!alreadyFixed && latestText.includes(sp.phrase)) {
        spellingItems.push({ old: sp.phrase, new: sp.suggestion, done: false });
      }
    }

    // 2. Grammar fixes this round
    const grammarItems = [];
    for (const good of newGood) {
      const v1Match = v1Anns.find(a => a.type === "grammar" && a.phrase === good.originalPhrase);
      if (v1Match) {
        grammarItems.push({ old: good.originalPhrase, new: good.phrase, done: true });
      }
    }
    const v1Grammar = v1Anns.filter(a => a.type === "grammar");
    for (const gr of v1Grammar) {
      const alreadyFixed = latestAnns.some(a => a.type === "revision_good" && a.originalPhrase === gr.phrase);
      if (!alreadyFixed && latestText.includes(gr.phrase)) {
        grammarItems.push({ old: gr.phrase, new: gr.suggestion, done: false });
      }
    }

    // 3. Connectives added this round（比較 prev vs latest 文字）
    const findConnectives = (text) => {
      const lower = text.toLowerCase();
      return CONN_LIST.filter(c => new RegExp(`\\b${c}\\b`, "i").test(lower));
    };
    const prevConns = findConnectives(prevText);
    const latestConns = findConnectives(latestText);
    const newConnectives = latestConns.filter(c => !prevConns.includes(c));

    // 4. VCOP suggestion improvements this round（V/C/O/P 全部追蹤）
    const vcopItems = { V: [], C: [], O: [], P: [] };
    for (const good of newGood) {
      for (const dim of ["V", "C", "O", "P"]) {
        const v1Match = v1Anns.find(a => a.type === "suggestion" && a.dimension === dim && a.phrase === good.originalPhrase);
        if (v1Match) {
          vcopItems[dim].push({ old: good.originalPhrase, new: good.phrase, suggestion: v1Match.suggestion, done: true });
        }
      }
    }
    // 未修的 VCOP suggestions（仍在 latest 中）
    for (const dim of ["V", "C", "O", "P"]) {
      const v1Suggestions = v1Anns.filter(a => a.type === "suggestion" && a.dimension === dim);
      for (const vs of v1Suggestions) {
        const alreadyFixed = latestAnns.some(a => a.type === "revision_good" && a.originalPhrase === vs.phrase);
        if (!alreadyFixed && latestText.includes(vs.phrase)) {
          vcopItems[dim].push({ old: vs.phrase, new: null, suggestion: vs.suggestion, done: false });
        }
      }
    }

    // 5. Punctuation changes this round
    const punctChanges = detectPunctuationChanges(prevText, latestText);

    const hasContent = spellingItems.length > 0 || grammarItems.length > 0 ||
      newConnectives.length > 0 || Object.values(vcopItems).some(arr => arr.length > 0) || punctChanges.length > 0;
    if (!hasContent) return null;

    return { spellingItems, grammarItems, newConnectives, vcopItems, punctChanges };
  }, [iterations, CONN_LIST, detectPunctuationChanges]);

  // 全局改進總覽 — first draft vs 最新版的累計改動
  const globalProgress = useMemo(() => {
    if (iterations.length < 2) return null;

    const v1Anns = iterations[0].annotations || [];
    const v1Text = iterations[0].text || "";
    const latestAnns = iterations[iterations.length - 1].annotations || [];
    const latestText = iterations[iterations.length - 1].text || "";

    // 所有 revision_good 在最新版中（都是對 v1 的改進）
    const allGood = latestAnns.filter(a => a.type === "revision_good");

    // 找出每個 revision_good 是哪一輪完成的
    const getRound = (originalPhrase) => {
      for (let i = 1; i < iterations.length; i++) {
        const roundAnns = iterations[i].annotations || [];
        const prevAnns = iterations[i - 1].annotations || [];
        const inCurr = roundAnns.some(a => a.type === "revision_good" && a.originalPhrase === originalPhrase);
        const inPrev = prevAnns.some(a => a.type === "revision_good" && a.originalPhrase === originalPhrase);
        if (inCurr && !inPrev) return i;
      }
      return 1;
    };

    const allSpelling = [];
    const allGrammar = [];
    const allVcop = { V: [], C: [], O: [], P: [] };
    let totalCount = 0;

    for (const good of allGood) {
      const round = getRound(good.originalPhrase);
      const v1Match = v1Anns.find(a => a.phrase === good.originalPhrase);
      if (!v1Match) continue;

      if (v1Match.type === "spelling") {
        allSpelling.push({ old: good.originalPhrase, new: good.phrase, round });
        totalCount++;
      } else if (v1Match.type === "grammar") {
        allGrammar.push({ old: good.originalPhrase, new: good.phrase, round });
        totalCount++;
      } else if (v1Match.type === "suggestion" && v1Match.dimension) {
        allVcop[v1Match.dimension]?.push({ old: good.originalPhrase, new: good.phrase, suggestion: v1Match.suggestion, round });
        totalCount++;
      }
    }

    // Connectives：first draft vs latest
    const findConns = (text) => {
      const lower = text.toLowerCase();
      return CONN_LIST.filter(c => new RegExp(`\\b${c}\\b`, "i").test(lower));
    };
    const v1Conns = findConns(v1Text);
    const latestConns = findConns(latestText);
    const allConnectives = [];
    for (const c of latestConns) {
      if (!v1Conns.includes(c)) {
        // 找出哪一輪加入的
        let addedRound = 1;
        for (let i = 1; i < iterations.length; i++) {
          const prevC = findConns(iterations[i - 1].text || "");
          const currC = findConns(iterations[i].text || "");
          if (currC.includes(c) && !prevC.includes(c)) { addedRound = i; break; }
        }
        allConnectives.push({ word: c, round: addedRound });
        totalCount++;
      }
    }

    // Punctuation：first draft vs latest
    const punctChanges = detectPunctuationChanges(v1Text, latestText);
    totalCount += punctChanges.length;

    if (totalCount === 0) return null;
    return { allSpelling, allGrammar, allVcop, allConnectives, punctChanges, totalCount, totalRounds: iterations.length - 1 };
  }, [iterations, CONN_LIST, detectPunctuationChanges]);

  // Fetch active session（根據學生年級找對應的 session，fallback 到任何 active session）
  useEffect(() => {
    const studentYear = getStudentYear(user?.studentId);
    const findSession = async () => {
      try {
        // 先找該年級的 active session
        if (studentYear) {
          const yearQ = query(
            collection(db, "sessions"),
            where("active", "==", true),
            where("targetYear", "==", studentYear),
            limit(1)
          );
          const yearSnap = await getDocs(yearQ);
          if (!yearSnap.empty) {
            const d = yearSnap.docs[0];
            setSession({ id: d.id, ...d.data() });
            return;
          }
        }
        // Fallback：找任何 active session（相容沒有 targetYear 的舊 session）
        const fallbackQ = query(
          collection(db, "sessions"),
          where("active", "==", true),
          limit(1)
        );
        const fallbackSnap = await getDocs(fallbackQ);
        if (!fallbackSnap.empty) {
          const d = fallbackSnap.docs[0];
          setSession({ id: d.id, ...d.data() });
        } else {
          setSession(null);
        }
      } catch (err) {
        console.error("Session fetch error:", err);
        // Index 可能還沒建好，直接 fallback
        try {
          const fallbackQ = query(
            collection(db, "sessions"),
            where("active", "==", true),
            limit(1)
          );
          const fallbackSnap = await getDocs(fallbackQ);
          if (!fallbackSnap.empty) {
            const d = fallbackSnap.docs[0];
            setSession({ id: d.id, ...d.data() });
          }
        } catch (e) {
          console.error("Fallback session fetch also failed:", e);
        }
      } finally {
        setSessionLoading(false);
      }
    };
    findSession();
  }, [user]);

  // Load draft after session is ready
  useEffect(() => {
    if (!session || sessionLoading) { setDraftLoading(false); return; }
    let cancelled = false;
    (async () => {
      const draft = await loadDraft();
      if (cancelled) return;
      if (draft && (draft.text || draft.coachText || draft.brainstorm || draft.planData?.brainstorm)) {
        setDraftPrompt(draft);
      }
      setDraftLoading(false);
    })();
    return () => { cancelled = true; };
  }, [session, sessionLoading, loadDraft]);

  // Auto-save whenever writing state changes (debounced)
  useEffect(() => {
    if (!session || iterations.length > 0) return; // 已提交就不自動保存
    const data = {
      mode,
      text,
      feedbackLevel,
      feedbackAmount,
      planData: {
        brainstorm: brainstormText,
        wowWords: planWowWords,
        openerType: planOpenerType,
        connectives: planConnectives,
        punctuation: planPunctuation,
      },
    };
    // 加入 live coach 資料
    if (liveCoachData) {
      data.coachText = liveCoachData.coachText;
      data.coachChecks = liveCoachData.coachChecks;
    }
    saveDraft(data);
  }, [text, mode, brainstormText, planWowWords, planOpenerType, planConnectives, planPunctuation, feedbackLevel, feedbackAmount, liveCoachData, session, iterations.length, saveDraft]);

  // Restore draft handler
  const handleRestoreDraft = () => {
    if (!draftPrompt) return;
    if (draftPrompt.text) setText(draftPrompt.text);
    if (draftPrompt.mode) setMode(draftPrompt.mode);
    if (draftPrompt.feedbackLevel) setFeedbackLevel(draftPrompt.feedbackLevel);
    if (draftPrompt.feedbackAmount) setFeedbackAmount(draftPrompt.feedbackAmount);
    const pd = draftPrompt.planData;
    if (pd) {
      if (pd.brainstorm) setBrainstormText(pd.brainstorm);
      if (pd.wowWords) setPlanWowWords(pd.wowWords);
      if (pd.openerType) setPlanOpenerType(pd.openerType);
      if (pd.connectives) setPlanConnectives(pd.connectives);
      if (pd.punctuation) setPlanPunctuation(pd.punctuation);
    }
    if (draftPrompt.coachText || draftPrompt.coachChecks) {
      setLiveCoachData({ coachText: draftPrompt.coachText || "", coachChecks: draftPrompt.coachChecks || [] });
    }
    setDraftPrompt(null);
  };

  const handleDiscardDraft = () => {
    clearDraft();
    setDraftPrompt(null);
  };

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

  // 取得過去作品的 AI grade（顯示趨勢用）
  useEffect(() => {
    if (!showPastWork || pastSubmissions.length === 0) return;
    // 只取最近 5 篇，避免太多 API call
    const recent = pastSubmissions.slice(0, 5);
    for (const sub of recent) {
      if (pastGrades[sub.id]) continue; // 已有 grade
      const hasIterations = sub.iterations && sub.iterations.length > 0;
      if (!hasIterations) continue;
      // 取最後一個版本的文字來 grade
      const lastIter = sub.iterations[sub.iterations.length - 1];
      if (!lastIter?.text) continue;
      fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: lastIter.text, studentId: user.studentId }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.level) {
            setPastGrades(prev => ({ ...prev, [sub.id]: data.level }));
          }
        })
        .catch((err) => console.warn("[PAST GRADE] Failed:", err.message));
    }
  }, [showPastWork, pastSubmissions]);

  const handleSubmitFeedback = async () => {
    if (!feedbackMood || !session || !user) return;
    try {
      await addDoc(collection(db, "feedback"), {
        studentId: user.studentId, sessionId: session.id,
        mood: feedbackMood, helpedMost: feedbackHelped, difficult: feedbackDifficult,
        comment: feedbackComment.trim(), createdAt: serverTimestamp(),
      });
      setFeedbackSubmitted(true);
      setTimeout(() => {
        setFeedbackSubmitted(false);
        setShowFeedbackForm(false);
        setFeedbackMood(null);
        setFeedbackHelped([]);
        setFeedbackDifficult([]);
        setFeedbackComment("");
      }, 3000);
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
    if (!text.trim()) return;
    if (!session) {
      setError("No active session. Ask your teacher to start one!");
      return;
    }
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
      clearDraft(); // 提交成功，清除草稿
      logDimensionCoverage(data.annotations);

      // 儲存 pending data，先讓學生做自我評估再顯示 AI 回饋
      setPendingIterationData({
        version: 1,
        text: text.trim(),
        annotations: data.annotations,
        changedWords: null,
      });
      setSelfAssessment({});
      setShowSelfAssess(true);

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

      // Auto-enable next priority toggles based on what's needed
      // Priority order: Spelling -> Grammar -> V suggestion -> C suggestion -> O suggestion -> P suggestion
      const togglePriority = ["spelling", "grammar", "V_suggestion", "C_suggestion", "O_suggestion", "P_suggestion"];
      const toggleLabels = {
        "spelling": "spelling",
        "grammar": "grammar",
        "V_suggestion": "vocabulary",
        "C_suggestion": "connectives",
        "O_suggestion": "openers",
        "P_suggestion": "punctuation",
      };
      // Check which dimensions have relevant annotations
      const anns = data.annotations || [];
      const hasDimContent = (dimKey) => {
        if (dimKey === "spelling") return anns.some(a => a.type === "spelling" || a.type === "american_spelling");
        if (dimKey === "grammar") return anns.some(a => a.type === "grammar");
        if (dimKey.endsWith("_suggestion")) {
          const dim = dimKey.split("_")[0];
          return anns.some(a => a.type === "suggestion" && a.dimension === dim);
        }
        return false;
      };

      setHiddenDimensions((prev) => {
        const next = new Set(prev);
        let enabled = 0;
        let enabledLabel = null;
        for (const key of togglePriority) {
          if (enabled >= 2) break;
          if (next.has(key) && hasDimContent(key)) {
            next.delete(key);
            enabled++;
            if (!enabledLabel) enabledLabel = toggleLabels[key];
          }
        }
        if (enabledLabel) {
          setAutoEnableMsg(`Great! Now let's look at your ${enabledLabel}...`);
          setTimeout(() => setAutoEnableMsg(null), 4000);
        }
        return next;
      });

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

  // 拖放上傳檔案 — drag-and-drop handlers
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounter.current = 0;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    // 只接受 .txt 和 .md 檔案
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "txt" && ext !== "md") return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result;
      if (typeof content === "string") {
        setText(content);
        setFileLoaded(true);
        setTimeout(() => setFileLoaded(false), 2000);
      }
    };
    reader.readAsText(file);
  }, []);

  const handleBrainstormTranscript = (transcript) => {
    setBrainstormText((prev) => (prev ? prev + " " + transcript : transcript));
  };

  // Auto-enable guiding message state
  const [autoEnableMsg, setAutoEnableMsg] = useState(null);

  // 完成自我評估後顯示 AI 回饋 — auto-enable spelling & grammar
  const handleSelfAssessComplete = () => {
    if (pendingIterationData) {
      setIterations([pendingIterationData]);
      setSelectedVersion(0);
      setPendingIterationData(null);
      setShowSelfAssess(false);
      // Auto-enable spelling and grammar toggles (remove from hiddenDimensions)
      setHiddenDimensions((prev) => {
        const next = new Set(prev);
        next.delete("spelling");
        next.delete("grammar");
        return next;
      });
    }
  };

  // Build plan object for API/Firestore
  const buildPlanData = () => {
    const hasAnyPlan = brainstormText.trim() ||
      planWowWords.some(w => w.trim()) || planOpenerType || planConnectives.length > 0 || planPunctuation.length > 0;
    if (!hasAnyPlan) return null;
    return {
      brainstorm: brainstormText.trim(),
      wowWords: planWowWords.map(w => w.trim()).filter(Boolean),
      openerType: planOpenerType,
      connectives: planConnectives,
      punctuation: planPunctuation,
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

      {/* Save status indicator — fixed top-right */}
      {saveStatus !== "idle" && (
        <div className={`save-status save-status-${saveStatus}`}>
          {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved ✓" : "Save failed"}
        </div>
      )}

      <main className="app-main">
        {/* Draft resume prompt — shown before everything else */}
        {draftLoading && session && (
          <div className="draft-prompt">
            <p>Checking for saved work...</p>
          </div>
        )}

        {draftPrompt && !draftLoading && (
          <div className="draft-prompt">
            <p>You have unsaved work from before. Would you like to continue?</p>
            <div className="draft-prompt-buttons">
              <button className="draft-prompt-btn draft-prompt-continue" onClick={handleRestoreDraft}>Continue writing</button>
              <button className="draft-prompt-btn draft-prompt-fresh" onClick={handleDiscardDraft}>Start fresh</button>
            </div>
          </div>
        )}

        {!session ? (
          <div className="no-session">
            <p>No active session right now. Ask your teacher to start one!</p>
          </div>
        ) : draftPrompt ? null : (
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

            {/* Level & Amount selectors + Mode tabs — 有內容後自動隱藏 */}
            {iterations.length === 0 && !text && !brainstormText && !(liveCoachData?.coachText) && !(liveCoachData?.coachChecks?.length) && (
              <>
                <div className="feedback-selectors">
                  <div className="feedback-selector-group">
                    <span className="feedback-selector-label">Level</span>
                    <div className="feedback-selector-pills">
                      {[1, 2, 3].map((v) => (
                        <button
                          key={v}
                          className={`feedback-pill ${feedbackLevel === v ? "feedback-pill-active" : ""}`}
                          onClick={() => setFeedbackLevel(v)}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="feedback-selector-group">
                    <span className="feedback-selector-label">Amount</span>
                    <div className="feedback-selector-pills">
                      {[1, 2, 3].map((v) => (
                        <button
                          key={v}
                          className={`feedback-pill ${feedbackAmount === v ? "feedback-pill-active" : ""}`}
                          onClick={() => setFeedbackAmount(v)}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mode-tabs">
                  <button
                    className={`mode-tab ${mode === "planning" ? "active" : ""}`}
                    onClick={() => { saveNow({ mode: "planning", text, feedbackLevel, feedbackAmount, planData: { brainstorm: brainstormText, wowWords: planWowWords, openerType: planOpenerType, connectives: planConnectives, punctuation: planPunctuation } }); setMode("planning"); }}
                  >
                    Planning
                  </button>
                  <button
                    className={`mode-tab ${mode === "writing" ? "active" : ""}`}
                    onClick={() => { saveNow({ mode: "writing", text, feedbackLevel, feedbackAmount, planData: { brainstorm: brainstormText, wowWords: planWowWords, openerType: planOpenerType, connectives: planConnectives, punctuation: planPunctuation } }); setMode("writing"); }}
                  >
                    Writing
                  </button>
                  <button
                    className={`mode-tab ${mode === "livecoach" ? "active" : ""}`}
                    onClick={() => { saveNow({ mode: "livecoach", text, feedbackLevel, feedbackAmount, planData: { brainstorm: brainstormText, wowWords: planWowWords, openerType: planOpenerType, connectives: planConnectives, punctuation: planPunctuation } }); setMode("livecoach"); }}
                  >
                    Live Coach
                  </button>
                </div>
              </>
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
                    <label className="vcop-challenge-label">Connectives I want to use:</label>
                    <div className="planning-chips">
                      {ALL_CONNECTIVES.map((c) => (
                        <button
                          key={c}
                          className={`planning-chip ${planConnectives.includes(c) ? "planning-chip-selected" : ""}`}
                          onClick={() => setPlanConnectives((prev) =>
                            prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
                          )}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="vcop-challenge-row">
                    <label className="vcop-challenge-label">Punctuation I want to use:</label>
                    <div className="planning-chips">
                      {ALL_PUNCTUATION.map((p) => (
                        <button
                          key={p.value}
                          className={`planning-chip planning-chip-punct ${planPunctuation.includes(p.value) ? "planning-chip-selected" : ""}`}
                          onClick={() => setPlanPunctuation((prev) =>
                            prev.includes(p.value) ? prev.filter((x) => x !== p.value) : [...prev, p.value]
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
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
                          planConnectives.length > 0 ? planConnectives.join(", ") : "",
                          planPunctuation.length > 0 ? planPunctuation.join(", ") : "",
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
                        {planConnectives.length > 0 && (
                          <div className="plan-summary-item">
                            <span className="plan-summary-label">Connectives:</span>
                            <span className="plan-summary-text">{planConnectives.join(", ")}</span>
                          </div>
                        )}
                        {planPunctuation.length > 0 && (
                          <div className="plan-summary-item">
                            <span className="plan-summary-label">Punctuation:</span>
                            <span className="plan-summary-text">{planPunctuation.join(", ")}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 拖放上傳檔案 — drop zone wraps the writing area */}
                <div
                  className={`writing-area${isDragOver ? " drop-zone-active" : ""}`}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  {isDragOver && (
                    <div className="drop-zone-overlay">
                      Drop .txt or .md file here
                    </div>
                  )}
                  {fileLoaded && (
                    <div className="file-loaded-msg">File loaded!</div>
                  )}
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
                {!showSelfAssess && (
                  <button className="analyze-button" onClick={handleSubmit} disabled={loading || !text.trim()}>
                    {loading ? (
                      <span className="button-loading"><span className="spinner" />Analysing...</span>
                    ) : "Submit My Writing ✨"}
                  </button>
                )}
              </div>
            )}

            {/* ===== LIVE COACH MODE ===== */}
            {iterations.length === 0 && mode === "livecoach" && (
              <LiveCoachMode
                studentId={user.studentId}
                sessionId={session?.id}
                sessionTopic={session?.topic}
                onAutoSave={setLiveCoachData}
                initialData={liveCoachData}
              />
            )}

            {/* Plan summary after submission (collapsible reference) */}
            {hasSubmitted && hasPlan && (
              <div className={`plan-summary-bar plan-summary-post ${showPlanPanel ? "plan-summary-open" : ""}`}>
                <button className="plan-summary-toggle" onClick={() => setShowPlanPanel(!showPlanPanel)}>
                  <span className="plan-summary-line">
                    📋 My Plan: {[
                      planWowWords.filter(w => w.trim()).join(", "),
                      planOpenerType ? `${planOpenerType} opener` : "",
                      planConnectives.length > 0 ? planConnectives.join(", ") : "",
                      planPunctuation.length > 0 ? planPunctuation.join(", ") : "",
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
                    {planConnectives.length > 0 && (
                      <div className="plan-summary-item">
                        <span className="plan-summary-label">Connectives:</span>
                        <span className="plan-summary-text">{planConnectives.join(", ")}</span>
                      </div>
                    )}
                    {planPunctuation.length > 0 && (
                      <div className="plan-summary-item">
                        <span className="plan-summary-label">Punctuation:</span>
                        <span className="plan-summary-text">{planPunctuation.join(", ")}</span>
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

            {/* === SHARED FEEDBACK UI (both Big Writing and Sentence Builder) === */}
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

            {/* === SELF-ASSESSMENT before revealing AI feedback === */}
            {showSelfAssess && !loading && (() => {
              const selfAssessQuestions = feedbackLevel === 3
                ? [
                    { key: "vocabulary", label: "I used ambitious vocabulary" },
                    { key: "structure", label: "I varied my sentence structures" },
                    { key: "punctuation", label: "I used advanced punctuation (semicolons, colons, dashes)" },
                  ]
                : feedbackLevel === 2
                ? [
                    { key: "vocabulary", label: "I used varied vocabulary" },
                    { key: "connectives", label: "I used different connectives" },
                    { key: "openers", label: "I tried different sentence openers (ISPACED)" },
                  ]
                : [
                    { key: "spelling", label: "I tried my best spelling" },
                    { key: "vocabulary", label: "I used interesting words" },
                    { key: "openers", label: "I used different sentence starters" },
                  ];
              return (
                <div className="self-assess-panel">
                  <h2 className="self-assess-title">Before you see your feedback...</h2>
                  <p className="self-assess-subtitle">How do you feel about your writing?</p>
                  <div className="self-assess-questions">
                    {selfAssessQuestions.map((q) => (
                      <div key={q.key} className="self-assess-q">
                        <span className="self-assess-label">{q.label}</span>
                        <div className="self-assess-options">
                          {["😟", "😐", "😊"].map((emoji, i) => (
                            <button key={i} className={`self-assess-btn ${selfAssessment[q.key] === i ? "selected" : ""}`}
                              onClick={() => setSelfAssessment(prev => ({ ...prev, [q.key]: i }))}>
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    className="self-assess-reveal-btn"
                    onClick={handleSelfAssessComplete}
                    disabled={Object.keys(selfAssessment).length < selfAssessQuestions.length}
                  >
                    Show my feedback {Object.keys(selfAssessment).length < selfAssessQuestions.length ? "" : "\u2192"}
                  </button>
                </div>
              );
            })()}

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

            {/* "What you changed" 對比摘要 */}
            {changesSummary && (
              <div className="changes-summary">
                <button className="changes-summary-toggle" onClick={() => setShowChanges(v => !v)}>
                  <span>📝 What you changed</span>
                  <span className="changes-arrow">{showChanges ? "▲" : "▼"}</span>
                </button>
                {showChanges && (
                  <div className="changes-summary-body">
                    {changesSummary.spellingItems.length > 0 && (
                      <div className="changes-group">
                        <h4 className="changes-group-title">🔤 Spelling fixes</h4>
                        {changesSummary.spellingItems.map((item, i) => (
                          <div key={i} className={`changes-item ${item.done ? "changes-done" : "changes-pending"}`}>
                            <span className="changes-old">{item.old}</span>
                            <span className="changes-arrow-inline">→</span>
                            <span className="changes-new">{item.new}</span>
                            {item.done ? <span className="changes-check">✅</span> : <span className="changes-notyet">(not yet)</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {changesSummary.grammarItems.length > 0 && (
                      <div className="changes-group">
                        <h4 className="changes-group-title">🟠 Grammar fixes</h4>
                        {changesSummary.grammarItems.map((item, i) => (
                          <div key={i} className={`changes-item ${item.done ? "changes-done" : "changes-pending"}`}>
                            <span className="changes-old">{item.old}</span>
                            <span className="changes-arrow-inline">→</span>
                            <span className="changes-new">{item.new}</span>
                            {item.done ? <span className="changes-check">✅</span> : <span className="changes-notyet">(not yet)</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {changesSummary.newConnectives.length > 0 && (
                      <div className="changes-group">
                        <h4 className="changes-group-title">🔗 Connectives added</h4>
                        <div className="changes-item changes-done">
                          Added: {changesSummary.newConnectives.map((c, i) => (
                            <span key={i}><strong>{c}</strong>{i < changesSummary.newConnectives.length - 1 ? ", " : ""}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* VCOP improvements — V/C/O/P 全部維度 */}
                    {[
                      { dim: "V", emoji: "📚", label: "Vocabulary upgrades" },
                      { dim: "C", emoji: "🔗", label: "Connective improvements" },
                      { dim: "O", emoji: "✨", label: "Opener improvements" },
                      { dim: "P", emoji: "🎯", label: "Punctuation improvements" },
                    ].map(({ dim, emoji, label }) => changesSummary.vcopItems[dim]?.length > 0 && (
                      <div key={dim} className="changes-group">
                        <h4 className="changes-group-title">{emoji} {label}</h4>
                        {changesSummary.vcopItems[dim].map((item, i) => (
                          <div key={i} className={`changes-item ${item.done ? "changes-done" : "changes-pending"}`}>
                            {item.done ? (
                              <>
                                <span className="changes-old">{item.old}</span>
                                <span className="changes-arrow-inline">→</span>
                                <span className="changes-new">{item.new}</span>
                                <span className="changes-check">✅</span>
                              </>
                            ) : (
                              <>
                                <span className="changes-old">"{item.old}"</span>
                                <span className="changes-notyet">(not yet changed)</span>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                    {changesSummary.punctChanges.length > 0 && (
                      <div className="changes-group">
                        <h4 className="changes-group-title">✏️ Punctuation changes</h4>
                        {changesSummary.punctChanges.map((item, i) => (
                          <div key={i} className="changes-item changes-done">
                            {item.type === "changed" ? (
                              <>Changed <span className="changes-old">{item.old}</span> <span className="changes-arrow-inline">→</span> <span className="changes-new">{item.new}</span> after '{item.context}'</>
                            ) : (
                              <>Added <span className="changes-new">{item.new}</span> after '{item.context}'</>
                            )}
                            <span className="changes-check">✅</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 全局改進總覽 */}
            {globalProgress && (
              <div className="changes-summary global-progress">
                <button className="changes-summary-toggle" onClick={() => setShowGlobalProgress(v => !v)}>
                  <span>🏆 My Progress — Everything I've improved</span>
                  <span className="changes-arrow">{showGlobalProgress ? "▲" : "▼"}</span>
                </button>
                {showGlobalProgress && (
                  <div className="changes-summary-body">
                    {globalProgress.allSpelling.length > 0 && (
                      <div className="changes-group">
                        <h4 className="changes-group-title">🔤 Spelling fixes</h4>
                        {globalProgress.allSpelling.map((item, i) => (
                          <div key={i} className="changes-item changes-done">
                            <span className="changes-old">{item.old}</span>
                            <span className="changes-arrow-inline">→</span>
                            <span className="changes-new">{item.new}</span>
                            <span className="changes-check">✅</span>
                            <span className="changes-round">Round {item.round}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {globalProgress.allGrammar.length > 0 && (
                      <div className="changes-group">
                        <h4 className="changes-group-title">🟠 Grammar fixes</h4>
                        {globalProgress.allGrammar.map((item, i) => (
                          <div key={i} className="changes-item changes-done">
                            <span className="changes-old">{item.old}</span>
                            <span className="changes-arrow-inline">→</span>
                            <span className="changes-new">{item.new}</span>
                            <span className="changes-check">✅</span>
                            <span className="changes-round">Round {item.round}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {globalProgress.allConnectives.length > 0 && (
                      <div className="changes-group">
                        <h4 className="changes-group-title">🔗 Connectives added</h4>
                        {globalProgress.allConnectives.map((item, i) => (
                          <div key={i} className="changes-item changes-done">
                            Added: <strong>{item.word}</strong>
                            <span className="changes-check">✅</span>
                            <span className="changes-round">Round {item.round}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* VCOP improvements — V/C/O/P 全部維度 */}
                    {[
                      { dim: "V", emoji: "📚", label: "Vocabulary upgrades" },
                      { dim: "C", emoji: "🔗", label: "Connective improvements" },
                      { dim: "O", emoji: "✨", label: "Opener improvements" },
                      { dim: "P", emoji: "🎯", label: "Punctuation improvements" },
                    ].map(({ dim, emoji, label }) => globalProgress.allVcop[dim]?.length > 0 && (
                      <div key={dim} className="changes-group">
                        <h4 className="changes-group-title">{emoji} {label}</h4>
                        {globalProgress.allVcop[dim].map((item, i) => (
                          <div key={i} className="changes-item changes-done">
                            <span className="changes-old">{item.old}</span>
                            <span className="changes-arrow-inline">→</span>
                            <span className="changes-new">{item.new}</span>
                            <span className="changes-check">✅</span>
                            <span className="changes-round">Round {item.round}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                    {globalProgress.punctChanges.length > 0 && (
                      <div className="changes-group">
                        <h4 className="changes-group-title">✏️ Punctuation changes</h4>
                        {globalProgress.punctChanges.map((item, i) => (
                          <div key={i} className="changes-item changes-done">
                            {item.type === "changed" ? (
                              <>Changed <span className="changes-old">{item.old}</span> <span className="changes-arrow-inline">→</span> <span className="changes-new">{item.new}</span> after '{item.context}'</>
                            ) : (
                              <>Added <span className="changes-new">{item.new}</span> after '{item.context}'</>
                            )}
                            <span className="changes-check">✅</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="changes-total">
                      Total: {globalProgress.totalCount} improvement{globalProgress.totalCount !== 1 ? "s" : ""} across {globalProgress.totalRounds} round{globalProgress.totalRounds !== 1 ? "s" : ""}!
                    </div>
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

                {/* Auto-enable guiding message */}
                {autoEnableMsg && (
                  <div className="auto-enable-msg">{autoEnableMsg}</div>
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
                            isRevising={true}
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

        {/* Student Feedback Survey — always available, hidden by default */}
        {session && !feedbackSubmitted && !showFeedbackForm && (
          <div className="feedback-toggle-wrapper">
            <button className="feedback-toggle-btn" onClick={() => setShowFeedbackForm(true)}>
              Give feedback 📝
            </button>
          </div>
        )}
        {feedbackSubmitted && (
          <div className="student-feedback-section">
            <div className="feedback-submitted">Thanks for your feedback! 🙏</div>
          </div>
        )}
        {session && showFeedbackForm && !feedbackSubmitted && (
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
              {/* Grade trend — last 5 submissions */}
              {(() => {
                const recentWithGrades = pastSubmissions.slice(0, 5)
                  .filter(s => pastGrades[s.id])
                  .reverse(); // oldest first for trend display
                if (recentWithGrades.length < 2) return null;
                const parseLevel = (lvl) => parseInt((lvl || "").replace(/[^0-9]/g, "")) || 0;
                return (
                  <div className="grade-trend-bar">
                    <span className="grade-trend-label">Grade trend:</span>
                    {recentWithGrades.map((s, i) => {
                      const level = parseLevel(pastGrades[s.id]);
                      const prevLevel = i > 0 ? parseLevel(pastGrades[recentWithGrades[i - 1].id]) : level;
                      const trendClass = i === 0 ? "grade-trend-same" : level > prevLevel ? "grade-trend-up" : level < prevLevel ? "grade-trend-down" : "grade-trend-same";
                      return (
                        <span key={s.id} className={`grade-trend-badge ${trendClass}`}>
                          {pastGrades[s.id]}
                        </span>
                      );
                    })}
                  </div>
                );
              })()}
              {pastSubmissions.length === 0 ? (
                <p className="no-submissions-text">No past work yet</p>
              ) : (
                pastSubmissions.map((sub) => {
                  const isSB = sub.type === "sentenceBuilding";
                  const hasIterations = sub.iterations && sub.iterations.length > 0;
                  const pastVersion = pastSelectedVersions[sub.id] || 0;
                  return (
                    <div key={sub.id} className="past-submission-card">
                      <div className="past-submission-header" onClick={() => setExpandedPastId(expandedPastId === sub.id ? null : sub.id)}>
                        <span className="past-submission-topic">
                          {sub.sessionTopic || "Writing"}
                          {isSB && <span className="sb-type-badge">Sentence Building</span>}
                          {!isSB && hasIterations && <span className="iteration-badge">{sub.iterations.length}</span>}
                          {isSB && sub.sentences && <span className="iteration-badge">{sub.sentences.length} sentences</span>}
                        </span>
                        <span className="submission-time">{sub.createdAt?.toDate?.() ? sub.createdAt.toDate().toLocaleDateString() : ""}</span>
                        <span className="submission-toggle">{expandedPastId === sub.id ? "▲" : "▼"}</span>
                      </div>
                      {expandedPastId === sub.id && (
                        <div className="past-submission-detail">
                          {isSB ? (
                            <div className="submission-full-text">
                              <p>{sub.paragraph}</p>
                            </div>
                          ) : hasIterations ? (
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
