import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";

const VCOP_OPTIONS = [
  { key: "V", label: "Vocabulary", emoji: "📚", color: "#8B5CF6" },
  { key: "C", label: "Connectives", emoji: "🔗", color: "#3B82F6" },
  { key: "O", label: "Openers", emoji: "✨", color: "#10B981" },
  { key: "P", label: "Punctuation", emoji: "🎯", color: "#F59E0B" },
  { key: "spelling", label: "Spelling", emoji: "🔤", color: "#DC2626" },
  { key: "grammar", label: "Grammar", emoji: "📏", color: "#92400e" },
];

export default function TeacherSetupPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [topic, setTopic] = useState("");
  const [targetYear, setTargetYear] = useState(""); // "", "Y4", "Y5", "Y6"
  const [vcopFocus, setVcopFocus] = useState(["V", "C", "O", "P", "spelling", "grammar"]);
  const [extraInstructions, setExtraInstructions] = useState("");
  const [writingMode, setWritingMode] = useState("bigWriting"); // "bigWriting" | "sentenceBuilding" | "guided"
  const [guidedGenre, setGuidedGenre] = useState("narrative");
  const [scaffoldingLevel, setScaffoldingLevel] = useState(1);

  // 選班級時自動設定 Writing Mode 預設值
  const handleYearChange = (year) => {
    setTargetYear(year);
    if (year === "Y4") {
      setWritingMode("sentenceBuilding");
    } else if (year) {
      setWritingMode("bigWriting");
    }
  };
  const [loading, setLoading] = useState(false);
  const [activeSessions, setActiveSessions] = useState([]); // 所有 active sessions
  const [sessionLoading, setSessionLoading] = useState(true);

  // Fetch all active sessions（每個年級可能各有一個）
  useEffect(() => {
    const fetchActive = async () => {
      try {
        const q = query(
          collection(db, "sessions"),
          where("active", "==", true)
        );
        const snap = await getDocs(q);
        const sessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setActiveSessions(sessions);
      } catch (err) {
        console.error("Failed to fetch active sessions:", err);
      } finally {
        setSessionLoading(false);
      }
    };
    fetchActive();
  }, []);

  const toggleFocus = (key) => {
    setVcopFocus((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleStart = async () => {
    if (!topic.trim() || !targetYear || vcopFocus.length === 0) return;
    setLoading(true);

    try {
      // 只關閉同一年級的 active sessions
      const q = query(
        collection(db, "sessions"),
        where("active", "==", true),
        where("targetYear", "==", targetYear)
      );
      const snap = await getDocs(q);
      const closePromises = snap.docs.map((d) =>
        updateDoc(doc(db, "sessions", d.id), { active: false })
      );
      await Promise.all(closePromises);

      // Create new session
      const newSession = {
        topic: topic.trim(),
        targetYear,
        writingMode,
        vcopFocus,
        extraInstructions: extraInstructions.trim() || null,
        active: true,
        createdAt: serverTimestamp(),
      };
      // Add guided mode fields if applicable
      if (writingMode === "guided") {
        newSession.genre = guidedGenre;
        newSession.scaffoldingLevel = scaffoldingLevel;
      }
      const docRef = await addDoc(collection(db, "sessions"), newSession);

      // 更新 activeSessions：移除同年級舊的，加入新的
      setActiveSessions((prev) => [
        ...prev.filter((s) => s.targetYear !== targetYear),
        { id: docRef.id, ...newSession },
      ]);

      // Reset form
      setTopic("");
      setExtraInstructions("");
      setTargetYear("");
      setVcopFocus(["V", "C", "O", "P", "spelling", "grammar"]);
      setWritingMode("bigWriting");
      setGuidedGenre("narrative");
      setScaffoldingLevel(1);
    } catch (err) {
      console.error("Failed to create session:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="page-header">
          <h1>Silvermine Bay School VCOP Coach ✏️</h1>
          <button className="logout-button" onClick={handleLogout}>
            Log out
          </button>
        </div>
        <p className="subtitle">Session Setup</p>
      </header>

      <main className="app-main">
        <nav className="teacher-nav">
          <button
            className="teacher-nav-btn active"
            disabled
          >
            Setup
          </button>
          <button
            className="teacher-nav-btn"
            onClick={() => navigate("/teacher/dashboard")}
          >
            Dashboard →
          </button>
        </nav>

        {/* Active sessions status — 每個年級各自顯示 */}
        {!sessionLoading && activeSessions.length > 0 && (
          <div className="active-sessions-list">
            {activeSessions.map((s) => (
              <div key={s.id} className="active-session-badge">
                <span className="active-dot" />
                <span className="focus-tag-sm" style={{ background: "#64748b" }}>{s.targetYear || "?"}</span>
                <strong>{s.topic}</strong>
                {s.writingMode === "sentenceBuilding" && (
                  <span className="focus-tag-sm" style={{ background: "#0D9488" }}>Sentence Building</span>
                )}
                {s.writingMode === "guided" && (
                  <span className="focus-tag-sm" style={{ background: "#9b59b6" }}>Guided Writing</span>
                )}
                <span className="session-focus-inline">
                  {(s.vcopFocus || []).map((d) => {
                    const opt = VCOP_OPTIONS.find((o) => o.key === d);
                    return opt ? (
                      <span
                        key={d}
                        className="focus-tag-sm"
                        style={{ background: opt.color }}
                      >
                        {opt.key}
                      </span>
                    ) : null;
                  })}
                </span>
              </div>
            ))}
          </div>
        )}

        {!sessionLoading && activeSessions.length === 0 && (
          <div className="no-session-badge">
            No active sessions — create one below.
          </div>
        )}

        {/* Setup form */}
        <div className="setup-form">
          <div className="form-group">
            <label className="input-label" htmlFor="topic">
              Writing Topic
            </label>
            <input
              id="topic"
              type="text"
              className="form-input"
              placeholder='e.g. "My favourite animal"'
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={loading}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>

          <div className="form-group">
            <label className="input-label">Class</label>
            <div className="writing-mode-buttons">
              {[
                { value: "Y4", label: "Y4" },
                { value: "Y5", label: "Y5" },
                { value: "Y6", label: "Y6" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  className={`writing-mode-btn ${targetYear === opt.value ? "active" : ""}`}
                  onClick={() => handleYearChange(opt.value)}
                  disabled={loading}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="input-label">Writing Mode</label>
            <div className="writing-mode-buttons">
              <button
                className={`writing-mode-btn ${writingMode === "bigWriting" ? "active" : ""}`}
                onClick={() => setWritingMode("bigWriting")}
                disabled={loading}
              >
                Big Writing
              </button>
              <button
                className={`writing-mode-btn ${writingMode === "sentenceBuilding" ? "active" : ""}`}
                onClick={() => setWritingMode("sentenceBuilding")}
                disabled={loading}
              >
                Sentence Building
              </button>
              <button
                className={`writing-mode-btn ${writingMode === "guided" ? "active" : ""}`}
                onClick={() => setWritingMode("guided")}
                disabled={loading}
              >
                Guided Writing
              </button>
            </div>
            {writingMode === "sentenceBuilding" && (
              <p className="writing-mode-hint">Focuses on Connectives and Openers</p>
            )}
            {writingMode === "guided" && (
              <p className="writing-mode-hint">Sentence-by-sentence through a story structure</p>
            )}
          </div>

          {writingMode === "guided" && (
            <>
              <div className="form-group">
                <label className="input-label">Genre</label>
                <div className="writing-mode-buttons">
                  <button
                    className={`writing-mode-btn ${guidedGenre === "narrative" ? "active" : ""}`}
                    onClick={() => setGuidedGenre("narrative")}
                    disabled={loading}
                  >
                    Narrative
                  </button>
                  <button
                    className="writing-mode-btn"
                    disabled
                    style={{ opacity: 0.4 }}
                    title="Coming soon"
                  >
                    Persuasive
                  </button>
                  <button
                    className="writing-mode-btn"
                    disabled
                    style={{ opacity: 0.4 }}
                    title="Coming soon"
                  >
                    Report
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label className="input-label">Default Scaffolding Level</label>
                <div className="writing-mode-buttons">
                  {[
                    { value: 1, label: "Level 1 — Full support" },
                    { value: 2, label: "Level 2 — Light guidance" },
                    { value: 3, label: "Level 3 — Minimal" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      className={`writing-mode-btn ${scaffoldingLevel === opt.value ? "active" : ""}`}
                      onClick={() => setScaffoldingLevel(opt.value)}
                      disabled={loading}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="form-group">
            <label className="input-label">VCOP Focus</label>
            <div className="vcop-checkboxes">
              {VCOP_OPTIONS.map((opt) => (
                <label
                  key={opt.key}
                  className={`vcop-checkbox ${vcopFocus.includes(opt.key) ? "checked" : ""}`}
                  style={{
                    borderColor: opt.color,
                    background: vcopFocus.includes(opt.key)
                      ? `${opt.color}15`
                      : "transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={vcopFocus.includes(opt.key)}
                    onChange={() => toggleFocus(opt.key)}
                    disabled={loading}
                  />
                  <span className="vcop-checkbox-emoji">{opt.emoji}</span>
                  <span
                    className="vcop-checkbox-label"
                    style={{ color: opt.color }}
                  >
                    {opt.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="input-label" htmlFor="extra">
              Extra Instructions <span className="optional-label">(optional)</span>
            </label>
            <textarea
              id="extra"
              className="writing-input"
              placeholder="e.g. Focus on using at least 3 different connectives"
              value={extraInstructions}
              onChange={(e) => setExtraInstructions(e.target.value)}
              disabled={loading}
              rows={3}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>

          <button
            className="analyze-button"
            onClick={handleStart}
            disabled={loading || !topic.trim() || !targetYear || vcopFocus.length === 0}
          >
            {loading ? (
              <span className="button-loading">
                <span className="spinner" />
                Creating session...
              </span>
            ) : (
              "Start New Session"
            )}
          </button>
        </div>
      </main>
    </div>
  );
}
