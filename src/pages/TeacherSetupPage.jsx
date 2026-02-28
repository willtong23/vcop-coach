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
  limit,
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
  const [vcopFocus, setVcopFocus] = useState(["V", "C", "O", "P", "spelling", "grammar"]);
  const [extraInstructions, setExtraInstructions] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeSession, setActiveSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  // Fetch current active session
  useEffect(() => {
    const fetchActive = async () => {
      try {
        const q = query(
          collection(db, "sessions"),
          where("active", "==", true),
          limit(1)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const d = snap.docs[0];
          setActiveSession({ id: d.id, ...d.data() });
        }
      } catch (err) {
        console.error("Failed to fetch active session:", err);
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
    if (!topic.trim() || vcopFocus.length === 0) return;
    setLoading(true);

    try {
      // Close all active sessions
      const q = query(collection(db, "sessions"), where("active", "==", true));
      const snap = await getDocs(q);
      const closePromises = snap.docs.map((d) =>
        updateDoc(doc(db, "sessions", d.id), { active: false })
      );
      await Promise.all(closePromises);

      // Create new session
      const docRef = await addDoc(collection(db, "sessions"), {
        topic: topic.trim(),
        vcopFocus,
        extraInstructions: extraInstructions.trim() || null,
        active: true,
        createdAt: serverTimestamp(),
      });

      setActiveSession({
        id: docRef.id,
        topic: topic.trim(),
        vcopFocus,
        extraInstructions: extraInstructions.trim() || null,
        active: true,
      });

      // Reset form
      setTopic("");
      setExtraInstructions("");
      setVcopFocus(["V", "C", "O", "P", "spelling", "grammar"]);
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

        {/* Active session status */}
        {!sessionLoading && activeSession && (
          <div className="active-session-badge">
            <span className="active-dot" />
            Active session: <strong>{activeSession.topic}</strong>
            <span className="session-focus-inline">
              {(activeSession.vcopFocus || []).map((d) => {
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
        )}

        {!sessionLoading && !activeSession && (
          <div className="no-session-badge">
            No active session — create one below.
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
            />
          </div>

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
            />
          </div>

          <button
            className="analyze-button"
            onClick={handleStart}
            disabled={loading || !topic.trim() || vcopFocus.length === 0}
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
