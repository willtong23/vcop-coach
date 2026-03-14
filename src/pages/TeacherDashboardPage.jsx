import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  updateDoc,
  addDoc,
  deleteDoc,
  doc,
  arrayUnion,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import AnnotatedText from "../components/AnnotatedText";
import { getChangedWordIndices } from "../utils/wordDiff";

const YEAR_GROUP_MAP = {
  "19": "Y6",
  "20": "Y5",
  "21": "Y4",
};

function getActualYear(studentId) {
  if (!studentId) return null;
  const prefix = studentId.slice(0, 2);
  return YEAR_GROUP_MAP[prefix] || null;
}

export default function TeacherDashboardPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [allSessions, setAllSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [students, setStudents] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [commentDrafts, setCommentDrafts] = useState({});
  const [savingComment, setSavingComment] = useState(null);
  const [grammarNote, setGrammarNote] = useState(null);

  // Track selected version per submission
  const [selectedVersions, setSelectedVersions] = useState({});

  // Broadcast state
  const [broadcastText, setBroadcastText] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState(new Set());
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [broadcastGrammarNote, setBroadcastGrammarNote] = useState(null);
  const [sentBroadcasts, setSentBroadcasts] = useState([]);
  const [showBroadcast, setShowBroadcast] = useState(false);

  // AI Grading per submission
  const [grades, setGrades] = useState({});
  const [gradingId, setGradingId] = useState(null);

  // Coach draft grades (keyed by `coach-{draftId}-{checkIdx}`)
  const [coachGrades, setCoachGrades] = useState({});
  const [coachGradingKey, setCoachGradingKey] = useState(null);

  const handleCoachGrade = async (draftId, checkIdx, text, studentId) => {
    const key = `coach-${draftId}-${checkIdx}`;
    if (coachGrades[key] || !text?.trim()) return;
    setCoachGradingKey(key);
    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, studentId }),
      });
      if (res.ok) {
        const data = await res.json();
        setCoachGrades((prev) => ({ ...prev, [key]: data }));
      }
    } catch (err) { console.error("Coach grade error:", err); }
    setCoachGradingKey(null);
  };

  // Level-up rewrites for coach drafts (keyed by draftId)
  const [levelUpResults, setLevelUpResults] = useState({});
  const [levelUpLoading, setLevelUpLoading] = useState(null); // "draftId-level"

  const handleLevelUp = async (draftId, text, studentId, level, currentLevel) => {
    const key = `${draftId}-${level}`;
    if (levelUpResults[key] || !text?.trim()) return;
    setLevelUpLoading(key);
    try {
      // 從 currentLevel 提取數字（如 "Y1" → 1），直接傳 baseYear 給 API
      let baseYear = null;
      if (currentLevel) {
        const m = currentLevel.match(/\d+/);
        if (m) baseYear = parseInt(m[0], 10);
      }
      const res = await fetch("/api/coach-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "levelup", text, studentId, levelUp: level, currentLevel, baseYear }),
      });
      const data = await res.json();
      if (res.ok && data.rewrite) {
        setLevelUpResults((prev) => ({ ...prev, [key]: data }));
      } else {
        console.error("Level-up failed:", data);
        setLevelUpResults((prev) => ({ ...prev, [key]: { rewrite: "Error: " + (data.error || "Failed to generate"), changes: "", targetYear: `+${level}` } }));
      }
    } catch (err) {
      console.error("Level-up error:", err);
      setLevelUpResults((prev) => ({ ...prev, [key]: { rewrite: "Error: Network error", changes: "", targetYear: `+${level}` } }));
    }
    setLevelUpLoading(null);
  };

  // Raw text toggle per submission
  const [showRawText, setShowRawText] = useState({});
  const [copiedId, setCopiedId] = useState(null);

  // Live drafts
  const [drafts, setDrafts] = useState([]);

  // Student filter for activity feed
  const [filterStudent, setFilterStudent] = useState(null);

  // New session inline form
  const [showNewSession, setShowNewSession] = useState(false);
  const [newTopic, setNewTopic] = useState("");
  const [newTargetYear, setNewTargetYear] = useState("");
  const [creatingSession, setCreatingSession] = useState(false);

  // Fetch all sessions, default to active
  useEffect(() => {
    const q = query(
      collection(db, "sessions"),
      orderBy("createdAt", "desc")
    );
    getDocs(q)
      .then((snap) => {
        const sessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setAllSessions(sessions);
        // Default to "All Sessions" view
        setSession({ id: "__all__", topic: "All Sessions" });
      })
      .catch((err) => console.error("Session fetch error:", err))
      .finally(() => setSessionLoading(false));
  }, []);

  // Fetch all students
  useEffect(() => {
    getDocs(collection(db, "students"))
      .then((snap) => {
        setStudents(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        );
      })
      .catch((err) => console.error("Students fetch error:", err));
  }, []);

  // Real-time submissions — all or per session
  useEffect(() => {
    if (!session) return;

    const isAll = session.id === "__all__";
    const q = isAll
      ? query(collection(db, "submissions"), orderBy("createdAt", "desc"), limit(50))
      : query(collection(db, "submissions"), where("sessionId", "==", session.id));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        docs.sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() || 0;
          const tb = b.createdAt?.toMillis?.() || 0;
          return tb - ta;
        });
        setSubmissions(docs);
      },
      (err) => console.error("Submissions snapshot error:", err)
    );

    return unsub;
  }, [session]);

  // Real-time broadcasts for selected session
  useEffect(() => {
    if (!session) return;
    const q = query(
      collection(db, "broadcasts"),
      where("sessionId", "==", session.id)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        docs.sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() || 0;
          const tb = b.createdAt?.toMillis?.() || 0;
          return tb - ta;
        });
        setSentBroadcasts(docs);
      },
      (err) => console.error("Broadcasts snapshot error:", err)
    );
    return unsub;
  }, [session]);

  // Real-time drafts — all or per session
  useEffect(() => {
    if (!session) return;
    const isAll = session.id === "__all__";
    const q = isAll
      ? query(collection(db, "drafts"))
      : query(collection(db, "drafts"), where("sessionId", "==", session.id));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setDrafts(docs);
      },
      (err) => console.error("Drafts snapshot error:", err)
    );
    return unsub;
  }, [session]);

  const submittedStudentIds = new Set(submissions.map((s) => s.studentId));

  // Build a map of studentId -> draft for quick lookup
  const draftsByStudent = {};
  for (const d of drafts) {
    draftsByStudent[d.studentId] = d;
  }

  // Fetch grade for ALL versions of a submission
  const handleFetchGrade = async (sub) => {
    const subId = sub.id;
    if (grades[subId]) return;
    setGradingId(subId);

    const iters = sub.iterations || [];
    if (iters.length === 0) {
      const text = sub.text || "";
      if (!text.trim()) { setGradingId(null); return; }
      try {
        const res = await fetch("/api/grade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, studentId: sub.studentId }),
        });
        if (res.ok) {
          const data = await res.json();
          setGrades((prev) => ({ ...prev, [subId]: { versions: [{ version: 1, ...data }] } }));
        }
      } catch (err) { console.error("Grading error:", err); }
      setGradingId(null);
      return;
    }

    try {
      const results = await Promise.all(
        iters.map(async (iter) => {
          const text = iter.text || "";
          if (!text.trim()) return null;
          try {
            const res = await fetch("/api/grade", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text, studentId: sub.studentId }),
            });
            if (res.ok) {
              const data = await res.json();
              return { version: iter.version, ...data };
            }
          } catch (err) { console.error("Grading error for v" + iter.version, err); }
          return null;
        })
      );
      const versionGrades = results.filter(Boolean);
      if (versionGrades.length > 0) {
        setGrades((prev) => ({ ...prev, [subId]: { versions: versionGrades } }));
      }
    } catch (err) {
      console.error("Grading error:", err);
    } finally {
      setGradingId(null);
    }
  };

  // Copy raw text to clipboard
  const handleCopyRawText = async (text, subId) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(subId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  const handleSaveComment = async (submissionId) => {
    const comment = commentDrafts[submissionId]?.trim();
    if (!comment) return;
    setSavingComment(submissionId);
    setGrammarNote(null);

    try {
      let finalComment = comment;
      let hasChanges = false;
      try {
        const res = await fetch("/api/grammar-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: comment }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.corrected) {
            finalComment = data.corrected;
            hasChanges = data.hasChanges === true;
          }
        }
      } catch (grammarErr) {
        console.warn("Grammar check failed, saving original:", grammarErr);
      }

      await updateDoc(doc(db, "submissions", submissionId), {
        teacherComment: finalComment,
        teacherCommentOriginal: comment,
      });

      // Sync teacher comment to student profile's teacherNotes
      const sub = submissions.find((s) => s.id === submissionId);
      if (sub?.studentId) {
        updateDoc(doc(db, "studentProfiles", sub.studentId), {
          teacherNotes: arrayUnion({
            date: new Date().toISOString(),
            comment: finalComment,
            sessionTopic: sub.sessionTopic || "",
          }),
        }).catch((err) => console.warn("Failed to sync teacherNote to profile:", err.message));
      }

      if (hasChanges) {
        setGrammarNote({ submissionId, original: comment, corrected: finalComment });
      }

      setCommentDrafts((prev) => ({ ...prev, [submissionId]: "" }));
    } catch (err) {
      console.error("Failed to save comment:", err);
      alert("Failed to save comment. Please try again.");
    } finally {
      setSavingComment(null);
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const handleSessionChange = (e) => {
    const val = e.target.value;
    if (val === "__all__") {
      setSession({ id: "__all__", topic: "All Sessions" });
    } else {
      const selected = allSessions.find((s) => s.id === val);
      if (selected) setSession(selected);
    }
    setExpandedId(null);
    setGrammarNote(null);
    setFilterStudent(null);
  };

  const handleToggleStudent = (studentId) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  };

  const handleToggleAll = () => {
    if (selectedStudentIds.size === students.length) {
      setSelectedStudentIds(new Set());
    } else {
      setSelectedStudentIds(new Set(students.map((s) => s.id)));
    }
  };

  const handleSendBroadcast = async () => {
    if (!broadcastText.trim() || selectedStudentIds.size === 0 || !session) return;
    setSendingBroadcast(true);
    setBroadcastGrammarNote(null);

    try {
      let finalMessage = broadcastText.trim();
      let hasChanges = false;
      try {
        const res = await fetch("/api/grammar-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: broadcastText.trim() }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.corrected) {
            finalMessage = data.corrected;
            hasChanges = data.hasChanges === true;
          }
        }
      } catch (grammarErr) {
        console.warn("Grammar check failed, sending original:", grammarErr);
      }

      await addDoc(collection(db, "broadcasts"), {
        sessionId: session.id,
        message: finalMessage,
        messageOriginal: broadcastText.trim(),
        targetStudentIds: [...selectedStudentIds],
        dismissedBy: [],
        createdAt: serverTimestamp(),
      });

      if (hasChanges) {
        setBroadcastGrammarNote({ original: broadcastText.trim(), corrected: finalMessage });
      }

      setBroadcastText("");
      setSelectedStudentIds(new Set());
    } catch (err) {
      console.error("Failed to send broadcast:", err);
      alert("Failed to send broadcast. Please try again.");
    } finally {
      setSendingBroadcast(false);
    }
  };

  const handleDeleteBroadcast = async (broadcastId) => {
    try {
      await deleteDoc(doc(db, "broadcasts", broadcastId));
    } catch (err) {
      console.error("Failed to delete broadcast:", err);
      alert("Failed to delete broadcast.");
    }
  };

  const handleCreateSession = async () => {
    if (!newTopic.trim()) return;
    setCreatingSession(true);
    try {
      // 將其他 active session 設為 inactive
      for (const s of allSessions.filter((s) => s.active)) {
        await updateDoc(doc(db, "sessions", s.id), { active: false });
      }
      const docRef = await addDoc(collection(db, "sessions"), {
        topic: newTopic.trim(),
        targetYear: newTargetYear || null,
        vcopFocus: ["V", "C", "O", "P", "spelling", "grammar"],
        active: true,
        createdAt: serverTimestamp(),
      });
      // 重新載入 sessions
      const snap = await getDocs(query(collection(db, "sessions"), orderBy("createdAt", "desc")));
      const sessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setAllSessions(sessions);
      const newSession = sessions.find((s) => s.id === docRef.id);
      if (newSession) setSession(newSession);
      setNewTopic("");
      setNewTargetYear("");
      setShowNewSession(false);
    } catch (err) {
      console.error("Failed to create session:", err);
      alert("Failed to create session.");
    } finally {
      setCreatingSession(false);
    }
  };

  const formatSessionLabel = (s) => {
    const date = s.createdAt?.toDate
      ? s.createdAt.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short" })
      : "";
    const year = s.targetYear ? `[${s.targetYear}] ` : "";
    return `${year}${s.topic || "Untitled"}${date ? ` — ${date}` : ""}${s.active ? " ● Active" : ""}`;
  };

  const formatTime = (ts) => {
    if (!ts) return "";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatTimeAgo = (ts) => {
    if (!ts) return "";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const secs = Math.floor((Date.now() - d.getTime()) / 1000);
    if (secs < 60) return "just now";
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
  };

  const modeLabel = (mode) => {
    if (mode === "livecoach") return "Live Coach";
    if (mode === "writing") return "Writing";
    if (mode === "planning") return "Planning";
    return mode || "Writing";
  };

  const modeBadgeClass = (mode) => {
    if (mode === "livecoach") return "feed-mode-livecoach";
    if (mode === "planning") return "feed-mode-planning";
    return "feed-mode-writing";
  };

  // ===== Build unified activity feed =====
  // Merge drafts (status=drafting) and submissions (status=submitted) into one list
  const buildActivityFeed = () => {
    const items = [];

    // Add drafts as "drafting" items
    for (const d of drafts) {
      const previewText = d.mode === "livecoach"
        ? (d.coachText || d.text || "")
        : (d.text || "");
      items.push({
        type: "draft",
        id: `draft-${d.id}`,
        rawId: d.id,
        studentId: d.studentId,
        mode: d.mode || "writing",
        status: "drafting",
        time: d.lastUpdated,
        previewText,
        draft: d,
      });
    }

    // Add submissions as "submitted" items
    for (const sub of submissions) {
      const hasIterations = sub.iterations && sub.iterations.length > 0;
      const latestText = hasIterations
        ? sub.iterations[sub.iterations.length - 1]?.text || ""
        : sub.text || "";
      items.push({
        type: "submission",
        id: `sub-${sub.id}`,
        rawId: sub.id,
        studentId: sub.studentId,
        mode: sub.feedbackMode || "writing",
        status: "submitted",
        time: sub.createdAt,
        previewText: latestText,
        submission: sub,
        iterationCount: hasIterations ? sub.iterations.length : 1,
      });
    }

    // Sort by time, most recent first
    items.sort((a, b) => {
      const ta = a.time?.toMillis?.() || a.time?.seconds * 1000 || 0;
      const tb = b.time?.toMillis?.() || b.time?.seconds * 1000 || 0;
      return tb - ta;
    });

    // Filter by student if active
    if (filterStudent) {
      return items.filter((item) => item.studentId === filterStudent);
    }

    return items;
  };

  const activityFeed = session ? buildActivityFeed() : [];

  if (sessionLoading) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Silvermine Bay School VCOP Coach</h1>
          <p className="subtitle">Loading...</p>
        </header>
      </div>
    );
  }

  return (
    <div className="app td-dashboard">
      {/* Header */}
      <header className="td-header">
        <div className="td-header-row">
          <h1 className="td-title">VCOP Coach</h1>
          <div className="td-header-actions">
            <button
              className="td-icon-btn"
              onClick={() => setShowBroadcast(!showBroadcast)}
              title="Broadcast to students"
            >
              📢
            </button>
            <button
              className="td-icon-btn"
              onClick={() => navigate("/teacher/setup")}
              title="Session setup"
            >
              ⚙️
            </button>
            <button className="logout-button" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* Session selector */}
        <div className="td-session-bar">
          {allSessions.length > 0 ? (
            <div className="td-session-select-row">
              <select
                className="td-session-select"
                value={session?.id || ""}
                onChange={handleSessionChange}
              >
                <option value="__all__">All Sessions — Recent Activity</option>
                {allSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatSessionLabel(s)}
                  </option>
                ))}
              </select>
              <button
                className="td-new-session-btn"
                onClick={() => setShowNewSession(!showNewSession)}
              >
                {showNewSession ? "Cancel" : "+ New"}
              </button>
            </div>
          ) : (
            <div className="td-no-session">
              <p>No sessions yet.</p>
              <button
                className="td-new-session-btn"
                onClick={() => setShowNewSession(true)}
              >
                + New Session
              </button>
            </div>
          )}

          {/* Inline new session form */}
          {showNewSession && (
            <div className="td-new-session-form">
              <input
                className="td-new-session-input"
                type="text"
                placeholder="Topic (e.g. Describe your favourite place)"
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                spellCheck={false}
                autoCorrect="off"
              />
              <select
                className="td-new-session-year"
                value={newTargetYear}
                onChange={(e) => setNewTargetYear(e.target.value)}
              >
                <option value="">All years</option>
                <option value="Y4">Y4</option>
                <option value="Y5">Y5</option>
                <option value="Y6">Y6</option>
              </select>
              <button
                className="td-create-btn"
                onClick={handleCreateSession}
                disabled={creatingSession || !newTopic.trim()}
              >
                {creatingSession ? "Creating..." : "Start"}
              </button>
            </div>
          )}
        </div>

        {/* Active session topic display — hide for "All" */}
        {session && session.id !== "__all__" && (
          <div className="td-active-topic">
            <span className="td-topic-label">Topic:</span>
            <span className="td-topic-text">{session.topic}</span>
            {session.active && <span className="td-active-dot" />}
          </div>
        )}

        {/* Broadcast panel (toggled) */}
        {showBroadcast && session && (
          <div className="td-broadcast-panel">
            <div className="td-broadcast-header">
              <h3>Broadcast to Students</h3>
              <button className="td-close-btn" onClick={() => setShowBroadcast(false)}>×</button>
            </div>
            <div className="broadcast-student-grid">
              {students.map((s) => (
                <label
                  key={s.id}
                  className={`broadcast-check-label ${selectedStudentIds.has(s.id) ? "checked" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedStudentIds.has(s.id)}
                    onChange={() => handleToggleStudent(s.id)}
                  />
                  {s.name || s.id}
                </label>
              ))}
            </div>
            <button className="broadcast-select-all" onClick={handleToggleAll}>
              {selectedStudentIds.size === students.length ? "Deselect All" : "Select All"}
            </button>
            <textarea
              placeholder="Type a message to broadcast..."
              value={broadcastText}
              onChange={(e) => setBroadcastText(e.target.value)}
              rows={2}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="td-broadcast-textarea"
            />
            <button
              className="broadcast-send-btn"
              onClick={handleSendBroadcast}
              disabled={sendingBroadcast || !broadcastText.trim() || selectedStudentIds.size === 0}
            >
              {sendingBroadcast ? (
                <span className="button-loading">
                  <span className="spinner" />
                  Sending...
                </span>
              ) : (
                "Send"
              )}
            </button>
            {broadcastGrammarNote && (
              <div className="grammar-corrected-note">
                Grammar corrected before sending. Original: &ldquo;{broadcastGrammarNote.original}&rdquo;
              </div>
            )}
            {sentBroadcasts.length > 0 && (
              <div className="td-sent-list">
                <h4>Sent ({sentBroadcasts.length})</h4>
                {sentBroadcasts.map((b) => (
                  <div key={b.id} className="sent-broadcast-card">
                    <div className="sent-broadcast-content">
                      <p className="sent-broadcast-message">{b.message}</p>
                      <div className="sent-broadcast-meta">
                        <span className="sent-broadcast-time">{formatTime(b.createdAt)}</span>
                        <span className="sent-broadcast-targets">
                          → {(b.targetStudentIds || []).join(", ")}
                        </span>
                      </div>
                    </div>
                    <button
                      className="sent-broadcast-delete"
                      onClick={() => handleDeleteBroadcast(b.id)}
                      title="Delete broadcast"
                    >
                      🗑
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Student status bar (compact dots) */}
        {session && students.length > 0 && (
          <div className="td-student-bar">
            <button
              className={`td-student-pill td-pill-all ${!filterStudent ? "td-pill-active" : ""}`}
              onClick={() => setFilterStudent(null)}
            >
              All
            </button>
            {students.map((s) => {
              const hasSubmitted = submittedStudentIds.has(s.id);
              const hasDraft = !!draftsByStudent[s.id];
              let statusClass = "td-pill-inactive";
              if (hasSubmitted) statusClass = "td-pill-submitted";
              else if (hasDraft) statusClass = "td-pill-drafting";

              return (
                <button
                  key={s.id}
                  className={`td-student-pill ${statusClass} ${filterStudent === s.id ? "td-pill-active" : ""}`}
                  onClick={() => setFilterStudent(filterStudent === s.id ? null : s.id)}
                  title={`${s.id} — ${hasSubmitted ? "Submitted" : hasDraft ? "Drafting" : "Inactive"}`}
                >
                  {s.id}
                </button>
              );
            })}
          </div>
        )}

        {/* Unified Activity Feed */}
        {session && (
          <div className="td-feed">
            {filterStudent && (
              <div className="td-filter-banner">
                Showing: <strong>{filterStudent}</strong>
                <button className="td-clear-filter" onClick={() => setFilterStudent(null)}>
                  Clear filter
                </button>
              </div>
            )}

            {activityFeed.length === 0 && (
              <div className="td-empty-feed">
                {filterStudent
                  ? `No activity from ${filterStudent} yet.`
                  : "No activity yet. Waiting for students..."}
              </div>
            )}

            {activityFeed.map((item) => {
              const isExpanded = expandedId === item.id;

              return (
                <div
                  key={item.id}
                  className={`td-feed-card ${isExpanded ? "td-feed-card-expanded" : ""}`}
                >
                  {/* Card header */}
                  <div
                    className="td-feed-header"
                    onClick={() => {
                      setExpandedId(isExpanded ? null : item.id);
                      // Auto-fetch grade for submissions when expanding
                      if (!isExpanded && item.type === "submission" && !grades[item.rawId]) {
                        const sub = item.submission;
                        if (sub.type !== "sentenceBuilding") {
                          handleFetchGrade(sub);
                        }
                      }
                    }}
                  >
                    <span className="td-feed-student">{item.studentId}</span>
                    <span className={`td-feed-mode ${modeBadgeClass(item.mode)}`}>
                      {modeLabel(item.mode)}
                    </span>
                    <span className={`td-feed-status ${item.status === "submitted" ? "td-status-submitted" : "td-status-drafting"}`}>
                      {item.status === "submitted" ? "Submitted" : "Drafting"}
                    </span>
                    {item.type === "submission" && item.iterationCount > 1 && (
                      <span className="td-feed-versions">v{item.iterationCount}</span>
                    )}
                    {/* Grade badges in header */}
                    {item.type === "submission" && (() => {
                      const grade = grades[item.rawId];
                      const actualYear = getActualYear(item.studentId);
                      return (
                        <>
                          {actualYear && <span className="year-badge">{actualYear}</span>}
                          {grade?.versions && grade.versions.length > 0 && (
                            <>
                              <span className="grade-badge">{grade.versions[0].level}</span>
                              {grade.versions.length > 1 && (
                                <>
                                  <span className="grade-arrow-header">→</span>
                                  <span className={`grade-badge ${
                                    (() => {
                                      const first = parseInt(grade.versions[0].level.replace(/[^0-9]/g, "")) || 0;
                                      const last = parseInt(grade.versions[grade.versions.length - 1].level.replace(/[^0-9]/g, "")) || 0;
                                      return last > first ? "grade-improved" : last < first ? "grade-declined" : "";
                                    })()
                                  }`}>
                                    {grade.versions[grade.versions.length - 1].level}
                                  </span>
                                </>
                              )}
                            </>
                          )}
                        </>
                      );
                    })()}
                    <span className="td-feed-time">{formatTimeAgo(item.time)}</span>
                    <span className="td-feed-toggle">{isExpanded ? "▾" : "▸"}</span>
                  </div>

                  {/* Preview text (when collapsed) */}
                  {!isExpanded && item.previewText && (
                    <div className="td-feed-preview">
                      {item.previewText.slice(0, 100)}{item.previewText.length > 100 ? "..." : ""}
                    </div>
                  )}

                  {/* Expanded content */}
                  {isExpanded && item.type === "draft" && (
                    <div className="td-feed-detail">
                      {item.draft.mode === "livecoach" ? (() => {
                        const coachChecks = item.draft.coachChecks || [];
                        // checks 存為倒序（最新在前），反轉為正序 check1, check2...
                        const checksAsc = [...coachChecks].reverse();
                        const currentText = item.draft.coachText || item.draft.text || "";
                        const selectedIdx = selectedVersions[`coach-${item.id}`] ?? checksAsc.length - 1;
                        const selectedCheck = checksAsc[selectedIdx];
                        const hasSnapshots = checksAsc.some((c) => c.textSnapshot);

                        // Grade keys
                        const sessionGradeKey = `coach-${item.id}-session`;
                        const sessionGrade = coachGrades[sessionGradeKey];
                        const isGradingSession = coachGradingKey === sessionGradeKey;

                        // 渲染帶 diff 高亮的文字（綠色標記新增/修改的字詞）
                        const renderDiffText = (newText, oldText) => {
                          if (!oldText) return newText;
                          const changed = getChangedWordIndices(oldText, newText);
                          if (!changed || changed.size === 0) return newText;
                          const parts = newText.split(/(\s+)/);
                          let wordIdx = 0;
                          return parts.map((part, i) => {
                            if (/^\s+$/.test(part)) return part;
                            const isChanged = changed.has(wordIdx);
                            wordIdx++;
                            return isChanged
                              ? <mark key={i} className="td-coach-diff-add">{part}</mark>
                              : part;
                          });
                        };

                        return (
                          <>
                            {/* 當前文字 + Grade 按鈕 */}
                            <div className="td-detail-section td-coach-session-header">
                              <div className="td-coach-session-title-row">
                                <strong>Current text:</strong>
                                {sessionGrade
                                  ? <span className="td-coach-grade-badge">{sessionGrade.level}</span>
                                  : (
                                    <button
                                      className="td-coach-grade-btn"
                                      onClick={() => handleCoachGrade(item.id, "session", currentText, item.studentId)}
                                      disabled={isGradingSession || !currentText.trim()}
                                    >
                                      {isGradingSession ? "Grading..." : "Grade this session"}
                                    </button>
                                  )}
                              </div>
                              <p className="td-detail-text">{currentText || "(empty)"}</p>
                              {sessionGrade && <div className="td-coach-grade-reason">{sessionGrade.reason}</div>}
                            </div>

                            {checksAsc.length > 0 && (
                              <div className="td-detail-section">
                                <strong>Coach checks ({checksAsc.length}):</strong>
                                <div className="td-coach-version-tabs">
                                  {checksAsc.map((c, i) => (
                                    <button
                                      key={i}
                                      className={`td-coach-version-tab ${i === selectedIdx ? "active" : ""}`}
                                      onClick={() => setSelectedVersions((prev) => ({ ...prev, [`coach-${item.id}`]: i }))}
                                    >
                                      Check {i + 1}
                                      {c.focus !== "basics" && c.feedback?.fix_type ? ` · ${c.feedback.fix_type}` : ""}
                                    </button>
                                  ))}
                                </div>

                                {selectedCheck && (() => {
                                  const checkGradeKey = `coach-${item.id}-${selectedIdx}`;
                                  const checkGrade = coachGrades[checkGradeKey];
                                  const isGradingCheck = coachGradingKey === checkGradeKey;
                                  const snapshot = selectedCheck.textSnapshot;
                                  const prevSnapshot = selectedIdx > 0 ? checksAsc[selectedIdx - 1]?.textSnapshot : null;

                                  return (
                                    <div className="td-coach-version-detail">
                                      {/* 有 snapshot 時顯示該版本文字 + diff */}
                                      {snapshot && (
                                        <div className="td-coach-snapshot">
                                          <div className="td-coach-snapshot-label">
                                            Text at check {selectedIdx + 1}:
                                            {checkGrade && <span className="td-coach-grade-badge">{checkGrade.level}</span>}
                                            {!checkGrade && (
                                              <button
                                                className="td-coach-grade-btn td-coach-grade-btn-sm"
                                                onClick={() => handleCoachGrade(item.id, selectedIdx, snapshot, item.studentId)}
                                                disabled={isGradingCheck}
                                              >
                                                {isGradingCheck ? "..." : "Grade"}
                                              </button>
                                            )}
                                          </div>
                                          <p className="td-detail-text">
                                            {prevSnapshot
                                              ? renderDiffText(snapshot, prevSnapshot)
                                              : snapshot}
                                          </p>
                                          {checkGrade && <div className="td-coach-grade-reason">{checkGrade.reason}</div>}
                                        </div>
                                      )}

                                      {/* 沒有 snapshot（舊資料） */}
                                      {!snapshot && !hasSnapshots && (
                                        <div className="td-coach-no-snapshot">
                                          Text snapshots not available for this session (recorded before this feature).
                                          Start a new Live Coach session to see text at each checkpoint.
                                        </div>
                                      )}

                                      {/* 回饋卡 */}
                                      <div className="td-coach-check">
                                        <span className="td-coach-praise">"{selectedCheck.sentence}" — {selectedCheck.feedback?.praise || ""}</span>
                                        {selectedCheck.feedback?.fix && <span className="td-coach-fix">{selectedCheck.feedback.fix}</span>}
                                        {selectedCheck.feedback?.hint && <span className="td-coach-fix">💡 {selectedCheck.feedback.hint}</span>}
                                      </div>

                                      {/* Level Up — 基於該 check 的 grade */}
                                      {(snapshot || currentText) && (
                                        <div className="td-coach-levelup">
                                          <strong>Level up{checkGrade ? ` from ${checkGrade.level}` : ""}:</strong>
                                          {!checkGrade && <span className="td-coach-no-snapshot"> (Grade first for accurate levelling)</span>}
                                          <div className="td-coach-levelup-btns">
                                            {[1, 2, 3, 4, 5].map((lvl) => {
                                              const luKey = `${item.id}-chk${selectedIdx}-${lvl}`;
                                              const luResult = levelUpResults[luKey];
                                              const luLoading = levelUpLoading === luKey;
                                              return (
                                                <button
                                                  key={lvl}
                                                  className={`td-coach-levelup-btn ${luResult ? "done" : ""}`}
                                                  onClick={() => handleLevelUp(`${item.id}-chk${selectedIdx}`, snapshot || currentText, item.studentId, lvl, checkGrade?.level)}
                                                  disabled={luLoading || !!luResult}
                                                >
                                                  {luLoading ? "..." : luResult ? `✓ +${lvl}` : `+${lvl}`}
                                                </button>
                                              );
                                            })}
                                          </div>
                                          {[1, 2, 3, 4, 5].map((lvl) => {
                                            const luResult = levelUpResults[`${item.id}-chk${selectedIdx}-${lvl}`];
                                            if (!luResult) return null;
                                            return (
                                              <div key={lvl} className="td-coach-levelup-result">
                                                <div className="td-coach-levelup-result-header">
                                                  <span className="td-coach-grade-badge">{luResult.targetYear}</span>
                                                  <span className="td-coach-levelup-label">+{lvl} level{lvl > 1 ? "s" : ""} up</span>
                                                </div>
                                                <p className="td-detail-text">{luResult.rewrite}</p>
                                                <div className="td-coach-levelup-changes">{luResult.changes}</div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}

                                {/* 等級進程 */}
                                {(() => {
                                  const gradedVersions = checksAsc
                                    .map((c, i) => ({ idx: i, grade: coachGrades[`coach-${item.id}-${i}`] }))
                                    .filter((v) => v.grade);
                                  if (gradedVersions.length < 2) return null;
                                  return (
                                    <div className="td-coach-grade-progression">
                                      <strong>Level progression: </strong>
                                      {gradedVersions.map((v, vi) => {
                                        const prev = vi > 0 ? gradedVersions[vi - 1].grade.level : null;
                                        const improved = prev && v.grade.level > prev;
                                        return (
                                          <span key={v.idx}>
                                            {vi > 0 && " → "}
                                            <span className={improved ? "grade-improved" : ""}>
                                              Check {v.idx + 1}: {v.grade.level}
                                            </span>
                                          </span>
                                        );
                                      })}
                                    </div>
                                  );
                                })()}

                              </div>
                            )}
                          </>
                        );
                      })() : (
                        <div className="td-detail-section">
                          <p className="td-detail-text">{item.previewText || "(empty)"}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {isExpanded && item.type === "submission" && (() => {
                    const sub = item.submission;
                    const isSB = sub.type === "sentenceBuilding";
                    const hasIterations = sub.iterations && sub.iterations.length > 0;
                    const currentVersion = selectedVersions[sub.id] || 0;
                    const actualYear = getActualYear(sub.studentId);
                    const grade = grades[sub.id];
                    const isGrading = gradingId === sub.id;
                    const currentText = hasIterations
                      ? sub.iterations[currentVersion]?.text || ""
                      : sub.text || "";
                    const isRawVisible = showRawText[sub.id] || false;

                    return (
                      <div className="td-feed-detail">
                        {/* AI Grading section */}
                        {!isSB && (
                          <div className="grading-section">
                            {isGrading ? (
                              <div className="grading-loading">
                                <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                                <span>Grading...</span>
                              </div>
                            ) : grade?.versions ? (
                              <div className="grading-result">
                                <div className="grading-badges">
                                  <span className="grading-actual-year">Actual: {actualYear || "?"}</span>
                                  {grade.versions.map((vg, i) => (
                                    <span key={vg.version}>
                                      {i > 0 && <span className="grading-arrow">→</span>}
                                      <span className={`grading-ai-level ${i === grade.versions.length - 1 ? "grading-ai-latest" : ""}`}>
                                        v{vg.version}: {vg.level}
                                      </span>
                                    </span>
                                  ))}
                                </div>
                                <p className="grading-reason">{grade.versions[grade.versions.length - 1]?.reason || ""}</p>
                              </div>
                            ) : (
                              <button
                                className="grade-fetch-btn"
                                onClick={() => handleFetchGrade(sub)}
                              >
                                Get AI Grade
                              </button>
                            )}
                          </div>
                        )}

                        {/* Sentence Building display */}
                        {isSB ? (
                          <>
                            <div className="td-detail-text" style={{ whiteSpace: "pre-wrap" }}>{sub.paragraph}</div>
                            {sub.sentences && sub.sentences.length > 0 && (
                              <div style={{ marginTop: 12 }}>
                                {sub.sentences.map((s, i) => (
                                  <div key={i} style={{ marginBottom: 8, fontSize: 14 }}>
                                    {s.original !== s.final && (
                                      <span style={{ color: "#94a3b8", textDecoration: "line-through", marginRight: 8 }}>{s.original}</span>
                                    )}
                                    <span>{s.final}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        ) : hasIterations ? (
                          <>
                            {/* Version tabs */}
                            {sub.iterations.length > 1 && (
                              <div className="version-tabs">
                                {sub.iterations.map((iter, idx) => (
                                  <button
                                    key={idx}
                                    className={`version-tab ${currentVersion === idx ? "active" : ""}`}
                                    onClick={() => setSelectedVersions((prev) => ({ ...prev, [sub.id]: idx }))}
                                  >
                                    v{iter.version}
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Raw text toggle + copy */}
                            <div className="raw-text-controls">
                              <button
                                className={`raw-text-toggle ${isRawVisible ? "active" : ""}`}
                                onClick={() => setShowRawText((prev) => ({ ...prev, [sub.id]: !prev[sub.id] }))}
                              >
                                {isRawVisible ? "Hide" : "Show"} Clean Text
                              </button>
                              <button
                                className="copy-text-btn"
                                onClick={() => handleCopyRawText(currentText, sub.id)}
                              >
                                {copiedId === sub.id ? "Copied!" : "Copy Text"}
                              </button>
                            </div>

                            {isRawVisible && (
                              <div className="raw-text-display">
                                <p>{currentText}</p>
                              </div>
                            )}

                            {/* Annotated text */}
                            <div className="submission-full-text">
                              <AnnotatedText
                                text={sub.iterations[currentVersion]?.text || ""}
                                annotations={sub.iterations[currentVersion]?.annotations || []}
                                changedWords={null}
                              />
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="raw-text-controls">
                              <button
                                className="copy-text-btn"
                                onClick={() => handleCopyRawText(sub.text || "", sub.id)}
                              >
                                {copiedId === sub.id ? "Copied!" : "Copy Text"}
                              </button>
                            </div>
                            <div className="submission-full-text">
                              <p>{sub.text}</p>
                            </div>
                          </>
                        )}

                        {/* Existing teacher comment */}
                        {sub.teacherComment && (
                          <div className="teacher-comment">
                            <h3>Your comment</h3>
                            <p>{sub.teacherComment}</p>
                          </div>
                        )}

                        {/* Teacher comment input */}
                        <div className="teacher-comment-input">
                          <label className="input-label" style={{ fontSize: 15 }}>
                            {sub.teacherComment ? "Update your comment" : "Add a comment"}
                          </label>
                          <textarea
                            className="writing-input"
                            placeholder="Write a comment for this student..."
                            value={commentDrafts[sub.id] || ""}
                            onChange={(e) =>
                              setCommentDrafts((prev) => ({
                                ...prev,
                                [sub.id]: e.target.value,
                              }))
                            }
                            rows={2}
                            spellCheck={false}
                            autoCorrect="off"
                            autoCapitalize="off"
                          />
                          <button
                            className="save-comment-btn"
                            onClick={() => handleSaveComment(sub.id)}
                            disabled={
                              savingComment === sub.id ||
                              !commentDrafts[sub.id]?.trim()
                            }
                          >
                            {savingComment === sub.id ? (
                              <span className="button-loading">
                                <span className="spinner" />
                                Checking grammar...
                              </span>
                            ) : (
                              "Save Comment"
                            )}
                          </button>
                          {grammarNote?.submissionId === sub.id && (
                            <div className="grammar-corrected-note">
                              Grammar corrected before saving. Original: &ldquo;{grammarNote.original}&rdquo;
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
