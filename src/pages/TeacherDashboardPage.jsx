import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  query,
  where,
  orderBy,
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

  // Dashboard tab
  const [dashboardTab, setDashboardTab] = useState("dashboard");

  // Feedback data
  const [feedbackDocs, setFeedbackDocs] = useState([]);

  // Broadcast state
  const [broadcastText, setBroadcastText] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState(new Set());
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [broadcastGrammarNote, setBroadcastGrammarNote] = useState(null);
  const [sentBroadcasts, setSentBroadcasts] = useState([]);

  // AI Grading per submission
  const [grades, setGrades] = useState({});
  const [gradingId, setGradingId] = useState(null);

  // Raw text toggle per submission
  const [showRawText, setShowRawText] = useState({});
  const [copiedId, setCopiedId] = useState(null);

  // Class Overview
  const [studentProfiles, setStudentProfiles] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(false);

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
        const active = sessions.find((s) => s.active);
        if (active) {
          setSession(active);
        } else if (sessions.length > 0) {
          setSession(sessions[0]);
        }
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

  // Real-time submissions for selected session
  useEffect(() => {
    if (!session) return;

    const q = query(
      collection(db, "submissions"),
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

  // Real-time feedback for selected session
  useEffect(() => {
    if (!session) return;
    const q = query(
      collection(db, "feedback"),
      where("sessionId", "==", session.id)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setFeedbackDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => console.error("Feedback snapshot error:", err)
    );
    return unsub;
  }, [session]);

  // Fetch student profiles when Class Overview tab is selected
  useEffect(() => {
    if (dashboardTab !== "overview") return;
    setProfilesLoading(true);
    getDocs(collection(db, "studentProfiles"))
      .then((snap) => {
        setStudentProfiles(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      })
      .catch((err) => console.error("Student profiles fetch error:", err))
      .finally(() => setProfilesLoading(false));
  }, [dashboardTab]);

  const submittedStudentIds = new Set(submissions.map((s) => s.studentId));
  const submittedCount = submittedStudentIds.size;
  const totalStudents = students.length;

  // Fetch grade for ALL versions of a submission
  const handleFetchGrade = async (sub) => {
    const subId = sub.id;
    if (grades[subId]) return; // Already graded
    setGradingId(subId);

    const iters = sub.iterations || [];
    if (iters.length === 0) {
      // Old format fallback
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

    // Grade each version in parallel
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
      // Grammar check via API
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
    const selected = allSessions.find((s) => s.id === e.target.value);
    if (selected) {
      setSession(selected);
      setExpandedId(null);
      setGrammarNote(null);
    }
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

  const formatSessionLabel = (s) => {
    const date = s.createdAt?.toDate
      ? s.createdAt.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short" })
      : "";
    return `${s.topic || "Untitled"}${date ? ` — ${date}` : ""}${s.active ? " ●" : ""}`;
  };

  const formatTime = (ts) => {
    if (!ts) return "";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
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

  return (
    <div className="app teacher-dashboard">
      <header className="app-header">
        <div className="page-header">
          <h1>Silvermine Bay School VCOP Coach ✏️</h1>
          <button className="logout-button" onClick={handleLogout}>
            Log out
          </button>
        </div>
        <p className="subtitle">Teacher Dashboard</p>
      </header>

      <main className="app-main">
        <nav className="teacher-nav">
          <button
            className="teacher-nav-btn"
            onClick={() => navigate("/teacher/setup")}
          >
            ← Setup
          </button>
          <button
            className={`teacher-nav-btn ${dashboardTab === "dashboard" ? "active" : ""}`}
            onClick={() => setDashboardTab("dashboard")}
          >
            Dashboard
          </button>
          <button
            className={`teacher-nav-btn ${dashboardTab === "feedback" ? "active" : ""}`}
            onClick={() => setDashboardTab("feedback")}
          >
            Feedback
          </button>
          <button
            className={`teacher-nav-btn ${dashboardTab === "overview" ? "active" : ""}`}
            onClick={() => setDashboardTab("overview")}
          >
            Class Overview
          </button>
        </nav>

        {allSessions.length === 0 ? (
          <div className="no-session">
            <p>No sessions found.</p>
            <button
              className="analyze-button"
              style={{ marginTop: 16, maxWidth: 300 }}
              onClick={() => navigate("/teacher/setup")}
            >
              Create a Session
            </button>
          </div>
        ) : (
          <>
            {/* Session selector */}
            <div className="session-selector-wrapper">
              <select
                className="session-selector"
                value={session?.id || ""}
                onChange={handleSessionChange}
              >
                {allSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatSessionLabel(s)}
                  </option>
                ))}
              </select>
            </div>

            {dashboardTab === "dashboard" && (
              <>
                {/* Session info */}
                <div className="session-info">
                  <div className="session-topic">
                    Topic: {session.topic}
                  </div>
                  <div className="session-focus">
                    {(session.vcopFocus || ["V", "C", "O", "P", "spelling", "grammar"]).map((d) => {
                      const colors = {
                        V: "#8B5CF6",
                        C: "#3B82F6",
                        O: "#10B981",
                        P: "#F59E0B",
                        spelling: "#DC2626",
                        grammar: "#92400e",
                      };
                      const labels = {
                        V: "Vocabulary",
                        C: "Connectives",
                        O: "Openers",
                        P: "Punctuation",
                        spelling: "Spelling",
                        grammar: "Grammar",
                      };
                      return (
                        <span
                          key={d}
                          className="focus-tag"
                          style={{ background: colors[d] }}
                        >
                          {labels[d]}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="progress-section">
                  <div className="progress-label">
                    <strong>{submittedCount}</strong> / {totalStudents} submitted
                  </div>
                  <div className="progress-bar-track">
                    <div
                      className="progress-bar-fill"
                      style={{
                        width:
                          totalStudents > 0
                            ? `${(submittedCount / totalStudents) * 100}%`
                            : "0%",
                      }}
                    />
                  </div>
                </div>

                {/* Student status grid */}
                <div className="student-grid">
                  {students.map((s) => (
                    <span
                      key={s.id}
                      className={`student-chip ${submittedStudentIds.has(s.id) ? "submitted" : ""}`}
                    >
                      {s.name || s.id}
                    </span>
                  ))}
                </div>

                {/* Broadcast section */}
                <div className="broadcast-section">
                  <h3>Broadcast to Students 📢</h3>

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
                      "Send 📢"
                    )}
                  </button>

                  {broadcastGrammarNote && (
                    <div className="grammar-corrected-note">
                      Grammar corrected before sending. Original: &ldquo;{broadcastGrammarNote.original}&rdquo;
                    </div>
                  )}
                </div>

                {/* Sent broadcasts list */}
                {sentBroadcasts.length > 0 && (
                  <div className="sent-broadcasts">
                    <h3 className="sent-broadcasts-title">Sent Messages ({sentBroadcasts.length})</h3>
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

                {/* Submissions list */}
                <div className="submissions-list">
                  <h2 className="submissions-title">
                    Submissions ({submissions.length})
                  </h2>

                  {submissions.length === 0 && (
                    <p className="no-submissions-text">
                      No submissions yet. Waiting for students...
                    </p>
                  )}

                  {submissions.map((sub) => {
                    const isExpanded = expandedId === sub.id;
                    const hasIterations = sub.iterations && sub.iterations.length > 0;
                    const iterationCount = hasIterations ? sub.iterations.length : 1;
                    const preview = hasIterations
                      ? (sub.iterations[0].text?.length > 80
                        ? sub.iterations[0].text.slice(0, 80) + "..."
                        : sub.iterations[0].text)
                      : (sub.text?.length > 80
                        ? sub.text.slice(0, 80) + "..."
                        : sub.text);

                    const currentVersion = selectedVersions[sub.id] || 0;
                    const actualYear = getActualYear(sub.studentId);
                    const grade = grades[sub.id];
                    const isGrading = gradingId === sub.id;

                    // Get raw text for the latest version
                    const latestText = hasIterations
                      ? sub.iterations[sub.iterations.length - 1]?.text || ""
                      : sub.text || "";
                    const currentText = hasIterations
                      ? sub.iterations[currentVersion]?.text || ""
                      : sub.text || "";
                    const isRawVisible = showRawText[sub.id] || false;

                    return (
                      <div key={sub.id} className="submission-card">
                        <div
                          className="submission-header"
                          onClick={() => {
                            setExpandedId(isExpanded ? null : sub.id);
                            // Auto-fetch grade when expanding
                            if (!isExpanded && !grades[sub.id]) {
                              handleFetchGrade(sub);
                            }
                          }}
                        >
                          <span className="submission-student">
                            {sub.studentId}
                          </span>
                          {/* Actual year badge */}
                          {actualYear && (
                            <span className="year-badge">{actualYear}</span>
                          )}
                          {/* AI grade badge (compact, in header — show first and last version) */}
                          {grade?.versions && grade.versions.length > 0 && (
                            <>
                              <span className="grade-badge">
                                {grade.versions[0].level}
                              </span>
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
                          <span className="submission-preview">{preview}</span>
                          {iterationCount > 1 && (
                            <span className="iteration-badge">{iterationCount}</span>
                          )}
                          <span className="submission-time">
                            {formatTime(sub.createdAt)}
                          </span>
                          <span className="submission-toggle">
                            {isExpanded ? "▾" : "▸"}
                          </span>
                        </div>

                        {isExpanded && (
                          <div className="submission-detail">
                            {/* AI Grading section */}
                            <div className="grading-section">
                              {isGrading ? (
                                <div className="grading-loading">
                                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                                  <span>Grading all versions...</span>
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
                                    {actualYear && grade.versions.length > 0 && (
                                      <span className={`grading-gap ${
                                        (() => {
                                          const lastGrade = grade.versions[grade.versions.length - 1];
                                          const levelNum = parseInt(lastGrade.level.replace(/[^0-9]/g, "")) || 0;
                                          const actualNum = parseInt(actualYear.replace(/[^0-9]/g, "")) || 0;
                                          return levelNum > actualNum ? "grading-above" : levelNum < actualNum ? "grading-below" : "";
                                        })()
                                      }`}>
                                        {(() => {
                                          const lastGrade = grade.versions[grade.versions.length - 1];
                                          const levelNum = parseInt(lastGrade.level.replace(/[^0-9]/g, "")) || 0;
                                          const actualNum = parseInt(actualYear.replace(/[^0-9]/g, "")) || 0;
                                          if (levelNum > actualNum) return `+${levelNum - actualNum} above`;
                                          if (levelNum < actualNum) return `${actualNum - levelNum} below`;
                                          return "At level";
                                        })()}
                                      </span>
                                    )}
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

                            {hasIterations ? (
                              <>
                                {/* Version tabs */}
                                {sub.iterations.length > 1 && (
                                  <div className="version-tabs" style={{ marginTop: 16 }}>
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

                                {/* Raw text (clean, no annotations) */}
                                {isRawVisible && (
                                  <div className="raw-text-display">
                                    <p>{currentText}</p>
                                  </div>
                                )}

                                {/* Annotated text for selected version */}
                                <div className="submission-full-text">
                                  <h3>Writing {sub.iterations.length > 1 ? `(v${sub.iterations[currentVersion]?.version || 1})` : ""} — AI Feedback</h3>
                                  <AnnotatedText
                                    text={sub.iterations[currentVersion]?.text || ""}
                                    annotations={sub.iterations[currentVersion]?.annotations || []}
                                    changedWords={null}
                                  />
                                </div>
                              </>
                            ) : (
                              /* Old format fallback — plain text */
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
                                  <h3>Writing</h3>
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
                              <label className="input-label">
                                {sub.teacherComment
                                  ? "Update your comment"
                                  : "Add a comment"}
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
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {dashboardTab === "feedback" && (
              <div className="feedback-stats">
                <h2 className="submissions-title">
                  Student Feedback ({feedbackDocs.length} responses)
                </h2>

                {feedbackDocs.length === 0 ? (
                  <p className="no-submissions-text">No feedback yet for this session.</p>
                ) : (
                  <>
                    {/* Mood distribution */}
                    <div className="feedback-stats-card">
                      <h3>How did students feel?</h3>
                      <div className="emoji-bar">
                        {[
                          { value: 1, emoji: "😫" },
                          { value: 2, emoji: "😕" },
                          { value: 3, emoji: "😐" },
                          { value: 4, emoji: "🙂" },
                          { value: 5, emoji: "🤩" },
                        ].map((m) => {
                          const count = feedbackDocs.filter((f) => f.mood === m.value).length;
                          return (
                            <div key={m.value} className="emoji-bar-item">
                              <span className="emoji-bar-emoji">{m.emoji}</span>
                              <div className="emoji-bar-track">
                                <div
                                  className="emoji-bar-fill"
                                  style={{
                                    width: feedbackDocs.length > 0
                                      ? `${(count / feedbackDocs.length) * 100}%`
                                      : "0%",
                                  }}
                                />
                              </div>
                              <span className="emoji-bar-count">{count}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* What helped most */}
                    <div className="feedback-stats-card">
                      <h3>What helped you most?</h3>
                      {["AI feedback", "Seeing my old writing", "Speech input"].map((opt) => {
                        const count = feedbackDocs.filter((f) => (f.helpedMost || []).includes(opt)).length;
                        return (
                          <div key={opt} className="option-count-row">
                            <span className="option-count-label">{opt}</span>
                            <div className="option-count-bar-track">
                              <div
                                className="option-count-bar-fill"
                                style={{
                                  width: feedbackDocs.length > 0
                                    ? `${(count / feedbackDocs.length) * 100}%`
                                    : "0%",
                                }}
                              />
                            </div>
                            <span className="option-count-num">{count}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* What was difficult */}
                    <div className="feedback-stats-card">
                      <h3>What was difficult?</h3>
                      {[
                        "Understanding the feedback",
                        "Knowing how to improve",
                        "The app was confusing",
                        "Nothing, it was easy",
                      ].map((opt) => {
                        const count = feedbackDocs.filter((f) => (f.difficult || []).includes(opt)).length;
                        return (
                          <div key={opt} className="option-count-row">
                            <span className="option-count-label">{opt}</span>
                            <div className="option-count-bar-track">
                              <div
                                className="option-count-bar-fill"
                                style={{
                                  width: feedbackDocs.length > 0
                                    ? `${(count / feedbackDocs.length) * 100}%`
                                    : "0%",
                                }}
                              />
                            </div>
                            <span className="option-count-num">{count}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Text comments */}
                    {feedbackDocs.some((f) => f.comment?.trim()) && (
                      <div className="feedback-stats-card">
                        <h3>Comments</h3>
                        <div className="feedback-comments-list">
                          {feedbackDocs
                            .filter((f) => f.comment?.trim())
                            .map((f) => (
                              <div key={f.id} className="feedback-comment-item">
                                <span className="feedback-comment-student">{f.studentId}</span>
                                <p className="feedback-comment-text">{f.comment}</p>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {dashboardTab === "overview" && (
              <div className="class-overview">
                <h2 className="submissions-title">Class Overview</h2>

                {profilesLoading ? (
                  <p className="no-submissions-text">Loading profiles...</p>
                ) : studentProfiles.length === 0 ? (
                  <p className="no-submissions-text">No student profiles yet. Profiles are created after students submit their first writing.</p>
                ) : (
                  <>
                    {/* VCOP Level Averages */}
                    <div className="feedback-stats-card">
                      <h3>Class VCOP Level Averages</h3>
                      <div className="vcop-averages">
                        {[
                          { key: "vocabulary", label: "Vocabulary", color: "#8B5CF6", emoji: "📚" },
                          { key: "connectives", label: "Connectives", color: "#3B82F6", emoji: "🔗" },
                          { key: "openers", label: "Openers", color: "#10B981", emoji: "✨" },
                          { key: "punctuation", label: "Punctuation", color: "#F59E0B", emoji: "🎯" },
                        ].map(({ key, label, color, emoji }) => {
                          const levels = studentProfiles
                            .map((p) => p.vcop?.[key]?.level)
                            .filter((l) => typeof l === "number");
                          const avg = levels.length > 0
                            ? (levels.reduce((a, b) => a + b, 0) / levels.length).toFixed(1)
                            : "—";
                          const pct = levels.length > 0
                            ? Math.round((levels.reduce((a, b) => a + b, 0) / levels.length / 5) * 100)
                            : 0;
                          return (
                            <div key={key} className="vcop-avg-row">
                              <span className="vcop-avg-label">{emoji} {label}</span>
                              <div className="vcop-avg-bar-track">
                                <div
                                  className="vcop-avg-bar-fill"
                                  style={{ width: `${pct}%`, backgroundColor: color }}
                                />
                              </div>
                              <span className="vcop-avg-value" style={{ color }}>{avg}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Common Weaknesses */}
                    <div className="feedback-stats-card">
                      <h3>Common Weaknesses</h3>
                      {(() => {
                        const weaknessCounts = {};
                        for (const p of studentProfiles) {
                          const weaknesses = p.vcop?.vocabulary?.weaknesses || [];
                          for (const w of weaknesses) {
                            weaknessCounts[w] = (weaknessCounts[w] || 0) + 1;
                          }
                          // Check openers never used
                          const neverUsed = p.vcop?.openers?.ispacedNeverUsed || [];
                          for (const opener of neverUsed) {
                            const key = `Never used ${opener} opener`;
                            weaknessCounts[key] = (weaknessCounts[key] || 0) + 1;
                          }
                          // Check punctuation not yet
                          const notYet = p.vcop?.punctuation?.notYet || [];
                          for (const item of notYet) {
                            const key = `Punctuation: ${item} not yet`;
                            weaknessCounts[key] = (weaknessCounts[key] || 0) + 1;
                          }
                        }
                        const sorted = Object.entries(weaknessCounts)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 5);

                        if (sorted.length === 0) {
                          return <p className="no-submissions-text">No weakness patterns detected yet.</p>;
                        }

                        return (
                          <div className="weakness-list">
                            {sorted.map(([weakness, count]) => (
                              <div key={weakness} className="weakness-item">
                                <span className="weakness-count">{count}/{studentProfiles.length}</span>
                                <span className="weakness-text">{weakness}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Student VCOP Heatmap */}
                    <div className="feedback-stats-card">
                      <h3>Student VCOP Heatmap</h3>
                      <div className="heatmap-wrapper">
                        <table className="heatmap-table">
                          <thead>
                            <tr>
                              <th>Student</th>
                              <th style={{ color: "#8B5CF6" }}>V</th>
                              <th style={{ color: "#3B82F6" }}>C</th>
                              <th style={{ color: "#10B981" }}>O</th>
                              <th style={{ color: "#F59E0B" }}>P</th>
                              <th>Submissions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {studentProfiles
                              .sort((a, b) => a.id.localeCompare(b.id))
                              .map((p) => {
                                const levelColor = (level) => {
                                  if (level <= 1) return { bg: "#fef2f2", color: "#dc2626" };
                                  if (level <= 2) return { bg: "#fff7ed", color: "#ea580c" };
                                  if (level <= 3) return { bg: "#fefce8", color: "#ca8a04" };
                                  if (level <= 4) return { bg: "#f0fdf4", color: "#16a34a" };
                                  return { bg: "#ecfdf5", color: "#047857" };
                                };
                                const vLevel = p.vcop?.vocabulary?.level || 0;
                                const cLevel = p.vcop?.connectives?.level || 0;
                                const oUsed = p.vcop?.openers?.ispacedUsed?.length || 0;
                                const oLevel = oUsed >= 5 ? 4 : oUsed >= 3 ? 3 : oUsed >= 1 ? 2 : 1;
                                const pLevel = p.vcop?.punctuation?.level || 0;

                                return (
                                  <tr key={p.id}>
                                    <td className="heatmap-student">{p.id}</td>
                                    {[vLevel, cLevel, oLevel, pLevel].map((level, i) => {
                                      const { bg, color } = levelColor(level);
                                      return (
                                        <td
                                          key={i}
                                          className="heatmap-cell"
                                          style={{ backgroundColor: bg, color }}
                                        >
                                          {level || "—"}
                                        </td>
                                      );
                                    })}
                                    <td className="heatmap-submissions">{p.totalSubmissions || 0}</td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
