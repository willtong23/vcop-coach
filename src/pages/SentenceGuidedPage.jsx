/**
 * SentenceGuidedPage — Main page for guided writing mode.
 * Students write one sentence at a time through structured narrative sections.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, where, limit, getDocs, addDoc, serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { GENRE_TEMPLATES, SECTION_COLOURS } from "../data/genreTemplates";
import { adjustScaffoldingScore } from "../utils/scaffolding";
import { trackStuckTime, recordSentenceMetrics, calculateMetrics } from "../utils/metrics";
import EssayProgress from "../components/guided/EssayProgress";
import CoachPrompt from "../components/guided/CoachPrompt";
import SentenceInput from "../components/guided/SentenceInput";
import SectionCheckCard from "../components/guided/SectionCheckCard";
import VocabHintChips from "../components/guided/VocabHintChips";

const YEAR_GROUP_MAP = { "19": "Y6", "20": "Y5", "21": "Y4" };
function getStudentYear(studentId) {
  if (!studentId) return null;
  return YEAR_GROUP_MAP[studentId.slice(0, 2)] || null;
}

// Stuck detection threshold (seconds)
const STUCK_THRESHOLD = 90;

export default function SentenceGuidedPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const studentId = user?.studentId;
  const yearGroup = getStudentYear(studentId);

  // Session state
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  // Template
  const template = GENRE_TEMPLATES.narrative;
  const sections = template.sections;

  // Writing state
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [sentences, setSentences] = useState({});
  const [inputValue, setInputValue] = useState("");

  // Feedback state
  const [feedbackState, setFeedbackState] = useState("writing"); // writing | feedback | sectionCheck | complete
  const [currentFeedback, setCurrentFeedback] = useState(null);
  const [sectionCheckFeedback, setSectionCheckFeedback] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Scaffolding
  const [scaffoldingScore, setScaffoldingScore] = useState(1.0);
  const startingScoreRef = useRef(1.0);

  // Hints
  const [hintWords, setHintWords] = useState(null);
  const [showHint, setShowHint] = useState(false);
  const [usedHint, setUsedHint] = useState(false);

  // Stuck detection
  const promptShownTimeRef = useRef(Date.now());
  const lastKeystrokeRef = useRef(Date.now());
  const [showNudge, setShowNudge] = useState(false);
  const stuckTimerRef = useRef(null);

  // Session metrics
  const [sessionMetrics, setSessionMetrics] = useState({
    stuckTimes: [],
    hintUsages: 0,
    totalVocabPrompts: 0,
    revisionCounts: {},
    startedAt: Date.now(),
  });

  // Revision mode
  const [isRevising, setIsRevising] = useState(false);
  const [revisingSentenceIndex, setRevisingSentenceIndex] = useState(null);

  // Current section helper
  const currentSection = sections[currentSectionIndex];
  const sectionColour = currentSection ? SECTION_COLOURS[currentSection.id] : "#3498db";

  // ──────────────────────────────────────────────
  // Fetch active session for this student's year
  // ──────────────────────────────────────────────
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const q = query(
          collection(db, "sessions"),
          where("active", "==", true),
          where("targetYear", "==", yearGroup),
          limit(1)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const sessionDoc = snap.docs[0];
          const sessionData = { id: sessionDoc.id, ...sessionDoc.data() };
          setSession(sessionData);
          // Set scaffolding from session default
          if (sessionData.scaffoldingLevel) {
            const initialScore = Number(sessionData.scaffoldingLevel) || 1.0;
            setScaffoldingScore(initialScore);
            startingScoreRef.current = initialScore;
          }
        }
      } catch (err) {
        console.error("Failed to fetch session:", err);
      } finally {
        setSessionLoading(false);
      }
    };
    if (yearGroup) fetchSession();
    else setSessionLoading(false);
  }, [yearGroup]);

  // ──────────────────────────────────────────────
  // Stuck detection timer
  // ──────────────────────────────────────────────
  useEffect(() => {
    if (feedbackState !== "writing") return;

    const checkStuck = () => {
      const elapsed = trackStuckTime(lastKeystrokeRef.current);
      if (elapsed >= STUCK_THRESHOLD && !showNudge) {
        setShowNudge(true);
        // Record stuck time
        setSessionMetrics((prev) => ({
          ...prev,
          stuckTimes: [...prev.stuckTimes, elapsed],
        }));
        // Decrease scaffolding
        setScaffoldingScore((prev) => adjustScaffoldingScore(prev, "stuck"));
      }
    };

    stuckTimerRef.current = setInterval(checkStuck, 10000);
    return () => {
      if (stuckTimerRef.current) clearInterval(stuckTimerRef.current);
    };
  }, [feedbackState, showNudge]);

  // Reset nudge on keystroke
  const handleInputChange = useCallback((val) => {
    setInputValue(val);
    lastKeystrokeRef.current = Date.now();
    setShowNudge(false);
  }, []);

  // ──────────────────────────────────────────────
  // Get openers so far (first word of each sentence)
  // ──────────────────────────────────────────────
  const getOpenersSoFar = useCallback(() => {
    const openers = [];
    for (const section of sections) {
      const sectionSentences = sentences[section.id] || [];
      for (const s of sectionSentences) {
        const firstWord = s.trim().split(/\s+/)[0] || "";
        openers.push(firstWord);
      }
    }
    return openers;
  }, [sections, sentences]);

  // Get all sentences as flat array
  const getAllSentences = useCallback(() => {
    const all = [];
    for (const section of sections) {
      const sectionSentences = sentences[section.id] || [];
      all.push(...sectionSentences);
    }
    return all;
  }, [sections, sentences]);

  // Count total sentences needed
  const getTotalSentenceCount = useCallback(() => {
    return sections.reduce((sum, s) => sum + s.sentenceCount.min, 0);
  }, [sections]);

  // Count completed sentences
  const getCompletedSentenceCount = useCallback(() => {
    return Object.values(sentences).reduce((sum, arr) => sum + arr.length, 0);
  }, [sentences]);

  // Get scaffolding level (1, 2, or 3)
  const scaffoldingLevel = Math.max(1, Math.min(3, Math.round(scaffoldingScore)));

  // ──────────────────────────────────────────────
  // Submit sentence for feedback
  // ──────────────────────────────────────────────
  const handleSubmitSentence = async () => {
    if (!inputValue.trim() || isLoading) return;

    setIsLoading(true);
    setFeedbackState("feedback");
    setHintWords(null);
    setShowHint(false);

    try {
      const sectionPrompt = currentSection.prompts[scaffoldingLevel] || currentSection.prompts[1];

      const res = await fetch("/api/sentence-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentence: inputValue.trim(),
          essaySoFar: getAllSentences(),
          currentSection: currentSection.id,
          sectionPrompt,
          genre: "narrative",
          scaffoldingScore,
          vcopFocus: session?.vcopFocus || ["V", "C", "O", "P"],
          yearGroup: yearGroup || "Y5",
          showHint: false,
          sentenceIndex: currentSentenceIndex,
          openersSoFar: getOpenersSoFar(),
          previousFeedback: currentFeedback?.feedback || null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to get feedback");
      }

      const data = await res.json();
      setCurrentFeedback(data);
    } catch (err) {
      console.error("Sentence feedback error:", err);
      setCurrentFeedback({
        feedback: "Something went wrong getting feedback. Keep writing!",
        encouragement: "Don't worry, just keep going.",
        vcopCategory: null,
        spellingCorrection: null,
        grammarCorrection: null,
        hintWords: null,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // ──────────────────────────────────────────────
  // Request hint
  // ──────────────────────────────────────────────
  const handleRequestHint = async () => {
    setIsLoading(true);
    setUsedHint(true);

    try {
      const sectionPrompt = currentSection.prompts[scaffoldingLevel] || currentSection.prompts[1];

      const res = await fetch("/api/sentence-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentence: inputValue.trim(),
          essaySoFar: getAllSentences(),
          currentSection: currentSection.id,
          sectionPrompt,
          genre: "narrative",
          scaffoldingScore,
          vcopFocus: session?.vcopFocus || ["V", "C", "O", "P"],
          yearGroup: yearGroup || "Y5",
          showHint: true,
          sentenceIndex: currentSentenceIndex,
          openersSoFar: getOpenersSoFar(),
          previousFeedback: currentFeedback?.feedback || null,
        }),
      });

      if (!res.ok) throw new Error("Failed to get hints");

      const data = await res.json();
      setHintWords(data.hintWords || null);
      setCurrentFeedback(data);

      // Track hint usage
      setSessionMetrics((prev) => ({
        ...prev,
        hintUsages: prev.hintUsages + 1,
      }));
    } catch (err) {
      console.error("Hint request error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // ──────────────────────────────────────────────
  // Handle hint word selection
  // ──────────────────────────────────────────────
  const handleSelectHint = (hint) => {
    // Simple: append the hint word into the input
    setInputValue((prev) => {
      if (!prev.trim()) return hint.word;
      // Replace the last word if it seems like a placeholder
      return prev + " " + hint.word;
    });
    setHintWords(null);
  };

  // ──────────────────────────────────────────────
  // Keep and move on
  // ──────────────────────────────────────────────
  const handleKeepSentence = () => {
    const sectionId = currentSection.id;
    const trimmed = inputValue.trim();

    if (isRevising && revisingSentenceIndex !== null) {
      // Replace existing sentence
      setSentences((prev) => {
        const sectionArr = [...(prev[sectionId] || [])];
        sectionArr[revisingSentenceIndex] = trimmed;
        return { ...prev, [sectionId]: sectionArr };
      });
      setIsRevising(false);
      setRevisingSentenceIndex(null);

      // Track revision
      const key = `${sectionId}_${revisingSentenceIndex}`;
      setSessionMetrics((prev) => ({
        ...prev,
        revisionCounts: {
          ...prev.revisionCounts,
          [key]: (prev.revisionCounts[key] || 0) + 1,
        },
      }));
    } else {
      // Add new sentence
      setSentences((prev) => ({
        ...prev,
        [sectionId]: [...(prev[sectionId] || []), trimmed],
      }));
    }

    // Adjust scaffolding: success if no hint used
    if (!usedHint) {
      setScaffoldingScore((prev) => adjustScaffoldingScore(prev, "success"));
    }

    // Reset for next sentence
    setInputValue("");
    setCurrentFeedback(null);
    setHintWords(null);
    setShowHint(false);
    setUsedHint(false);
    setShowNudge(false);
    promptShownTimeRef.current = Date.now();
    lastKeystrokeRef.current = Date.now();

    // Check if section is done
    const sectionSentences = sentences[sectionId] || [];
    const totalAfterAdd = isRevising ? sectionSentences.length : sectionSentences.length + 1;

    if (totalAfterAdd >= currentSection.sentenceCount.min && !isRevising) {
      // Can optionally add more, or do section check
      if (totalAfterAdd >= currentSection.sentenceCount.max) {
        // Section full — trigger section check
        triggerSectionCheck(sectionId, totalAfterAdd);
      } else {
        // Between min and max — offer choice (auto section check for simplicity)
        triggerSectionCheck(sectionId, totalAfterAdd);
      }
    } else {
      setCurrentSentenceIndex((prev) => prev + 1);
      setFeedbackState("writing");
    }
  };

  // ──────────────────────────────────────────────
  // Improve this sentence
  // ──────────────────────────────────────────────
  const handleImproveSentence = () => {
    // Keep input as-is for editing
    setFeedbackState("writing");
    setCurrentFeedback(null);
    setHintWords(null);
  };

  // ──────────────────────────────────────────────
  // Section check
  // ──────────────────────────────────────────────
  const triggerSectionCheck = async (sectionId, count) => {
    setFeedbackState("sectionCheck");
    setIsLoading(true);

    try {
      // Get the sentences for this section (including the just-added one)
      const allSoFar = getAllSentences();
      // The last sentence was just committed so add it
      const sectionSents = [...(sentences[sectionId] || [])];
      if (sectionSents.length < count) {
        sectionSents.push(inputValue.trim());
      }

      const res = await fetch("/api/section-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionSentences: sectionSents,
          sectionName: currentSection.name,
          essaySoFar: [...allSoFar, inputValue.trim()],
          genre: "narrative",
          yearGroup: yearGroup || "Y5",
          vcopFocus: session?.vcopFocus || ["V", "C", "O", "P"],
        }),
      });

      if (!res.ok) throw new Error("Section check failed");

      const data = await res.json();
      setSectionCheckFeedback(data);
    } catch (err) {
      console.error("Section check error:", err);
      setSectionCheckFeedback({
        sectionFeedback: "Great work on this section! Let's move on.",
        suggestedAction: "accept",
        focusSentence: null,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // ──────────────────────────────────────────────
  // Section check actions
  // ──────────────────────────────────────────────
  const handleSectionRevise = () => {
    // Let student pick a sentence to revise
    const sectionSents = sentences[currentSection.id] || [];
    const focusIdx = sectionCheckFeedback?.focusSentence ?? 0;
    const idx = Math.min(focusIdx, sectionSents.length - 1);
    setRevisingSentenceIndex(idx);
    setIsRevising(true);
    setInputValue(sectionSents[idx] || "");
    setFeedbackState("writing");
    setSectionCheckFeedback(null);
  };

  const handleSectionContinue = () => {
    setSectionCheckFeedback(null);

    if (currentSectionIndex >= sections.length - 1) {
      // All sections done!
      setFeedbackState("complete");
      saveCompletedEssay();
      return;
    }

    // Move to next section
    setCurrentSectionIndex((prev) => prev + 1);
    setCurrentSentenceIndex(0);
    setFeedbackState("writing");
    setInputValue("");
    setCurrentFeedback(null);
    promptShownTimeRef.current = Date.now();
    lastKeystrokeRef.current = Date.now();
  };

  // ──────────────────────────────────────────────
  // Save completed essay as a submission
  // ──────────────────────────────────────────────
  const saveCompletedEssay = async () => {
    if (!session?.id || !studentId) return;

    try {
      const fullEssay = getAllSentences().join(" ");

      await addDoc(collection(db, "submissions"), {
        sessionId: session.id,
        studentId,
        sessionTopic: session.topic || null,
        feedbackMode: "guided",
        teacherComment: null,
        createdAt: serverTimestamp(),
        iterations: [
          {
            version: 1,
            text: fullEssay,
            annotations: [],
            createdAt: new Date().toISOString(),
          },
        ],
      });

      // Save metrics
      const totalSentences = getTotalSentenceCount();
      const completedSentences = getCompletedSentenceCount();
      const metrics = calculateMetrics(
        sessionMetrics,
        totalSentences,
        completedSentences,
        startingScoreRef.current,
        scaffoldingScore
      );
      await recordSentenceMetrics(session.id, studentId, metrics);

      console.log("[GUIDED] Essay saved and metrics recorded");
    } catch (err) {
      console.error("Failed to save guided essay:", err);
    }
  };

  // ──────────────────────────────────────────────
  // Handle logout
  // ──────────────────────────────────────────────
  const handleLogout = () => {
    logout();
    navigate("/");
  };

  // ──────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────
  if (sessionLoading) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Silvermine Bay School VCOP Coach</h1>
        </header>
        <main className="app-main">
          <p style={{ textAlign: "center", color: "#64748b" }}>Loading...</p>
        </main>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="app">
        <header className="app-header">
          <div className="page-header">
            <h1>Silvermine Bay School VCOP Coach</h1>
            <button className="logout-button" onClick={handleLogout}>Log out</button>
          </div>
        </header>
        <main className="app-main">
          <div className="no-session-badge">
            No active session found for {yearGroup || "your year group"}. Please wait for your teacher to start one.
          </div>
        </main>
      </div>
    );
  }

  // Completed state
  if (feedbackState === "complete") {
    const fullEssay = getAllSentences();
    return (
      <div className="app">
        <header className="app-header">
          <div className="page-header">
            <h1>Silvermine Bay School VCOP Coach</h1>
            <button className="logout-button" onClick={handleLogout}>Log out</button>
          </div>
        </header>
        <main className="app-main">
          <div className="guided-complete">
            <h2 className="guided-complete-title">Well done! You have finished your story!</h2>
            <div className="guided-complete-essay">
              {sections.map((section) => {
                const sectionSentences = sentences[section.id] || [];
                if (sectionSentences.length === 0) return null;
                const colour = SECTION_COLOURS[section.id];
                return (
                  <div key={section.id} className="guided-complete-section">
                    <span className="guided-complete-label" style={{ color: colour }}>
                      {section.name}
                    </span>
                    <p>{sectionSentences.join(" ")}</p>
                  </div>
                );
              })}
            </div>
            <p className="guided-complete-saved">Your story has been saved. Your teacher can see it on the dashboard.</p>
          </div>
        </main>
      </div>
    );
  }

  // Prompt for current sentence
  const prompt = currentSection
    ? currentSection.prompts[scaffoldingLevel] || currentSection.prompts[1]
    : "";

  // Hint button prominence
  const renderHintButton = () => {
    if (feedbackState !== "feedback" || !currentFeedback) return null;

    if (scaffoldingScore < 1.5) {
      return (
        <button
          type="button"
          className="hint-button hint-button-prominent"
          onClick={handleRequestHint}
          disabled={isLoading}
        >
          Show me options
        </button>
      );
    }
    if (scaffoldingScore <= 2.5) {
      return (
        <button
          type="button"
          className="hint-button hint-button-medium"
          onClick={handleRequestHint}
          disabled={isLoading}
        >
          Show me options
        </button>
      );
    }
    return (
      <button
        type="button"
        className="hint-button hint-button-subtle"
        onClick={handleRequestHint}
        disabled={isLoading}
      >
        hints
      </button>
    );
  };

  return (
    <div className="app guided-app">
      <header className="app-header app-header-compact">
        <div className="page-header">
          <h1>Silvermine Bay School VCOP Coach</h1>
          <button className="logout-button" onClick={handleLogout}>Log out</button>
        </div>
        {session.topic && (
          <p className="subtitle" style={{ fontSize: "14px" }}>
            Guided Writing: {session.topic}
          </p>
        )}
      </header>

      <main className="app-main guided-main">
        <div className="guided-layout">
          {/* Left: Essay Progress */}
          <div className="guided-sidebar">
            <EssayProgress
              sections={sections}
              sentences={sentences}
              currentSectionIndex={currentSectionIndex}
            />
          </div>

          {/* Right: Writing area */}
          <div className="guided-writing-area">
            {/* Coach prompt */}
            <CoachPrompt
              prompt={prompt}
              feedback={feedbackState === "feedback" ? currentFeedback : null}
              isLoading={isLoading && feedbackState === "feedback"}
              sectionName={currentSection?.name}
              sectionColour={sectionColour}
            />

            {/* Hint chips */}
            {hintWords && (
              <VocabHintChips
                hintWords={hintWords}
                onSelectHint={handleSelectHint}
                scaffoldingScore={scaffoldingScore}
              />
            )}

            {/* Hint button (after feedback) */}
            {feedbackState === "feedback" && !hintWords && renderHintButton()}

            {/* Stuck nudge */}
            {showNudge && feedbackState === "writing" && (
              <div className="guided-nudge">
                Need some help? Try looking at the coach's suggestion again, or click the hint button for ideas.
              </div>
            )}

            {/* Section check card */}
            {feedbackState === "sectionCheck" && (
              <SectionCheckCard
                sectionName={currentSection?.name}
                sectionColour={sectionColour}
                feedback={sectionCheckFeedback}
                onRevise={handleSectionRevise}
                onContinue={handleSectionContinue}
                isLastSection={currentSectionIndex >= sections.length - 1}
              />
            )}

            {/* Sentence input (show during writing and feedback states) */}
            {(feedbackState === "writing" || feedbackState === "feedback") && (
              <>
                {feedbackState === "writing" && (
                  <SentenceInput
                    value={inputValue}
                    onChange={handleInputChange}
                    onSubmit={handleSubmitSentence}
                    disabled={isLoading}
                    sentenceStarters={
                      scaffoldingLevel <= 2 && currentSentenceIndex === 0 && !isRevising
                        ? currentSection?.sentenceStarters
                        : null
                    }
                    placeholder={
                      isRevising
                        ? "Edit your sentence..."
                        : "Write your sentence here..."
                    }
                  />
                )}

                {feedbackState === "feedback" && currentFeedback && !isLoading && (
                  <div className="guided-feedback-actions">
                    <button
                      type="button"
                      className="guided-action-btn guided-action-improve"
                      onClick={handleImproveSentence}
                    >
                      Improve this sentence
                    </button>
                    <button
                      type="button"
                      className="guided-action-btn guided-action-keep"
                      onClick={handleKeepSentence}
                    >
                      Keep and move on
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
