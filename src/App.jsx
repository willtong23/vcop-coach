import { useState } from "react";
import WritingInput from "./components/WritingInput";
import AnalyzeButton from "./components/AnalyzeButton";
import FeedbackCard from "./components/FeedbackCard";
import "./App.css";

export default function App() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [error, setError] = useState(null);

  const handleAnalyze = async () => {
    setLoading(true);
    setFeedback(null);
    setError(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Something went wrong");
      }

      const data = await res.json();
      setFeedback(data);
    } catch (err) {
      setError(err.message || "Could not analyse your writing. Please try again!");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>VCOP Coach ✏️</h1>
        <p className="subtitle">
          Your friendly writing helper! Paste your writing and let's see how
          amazing it is.
        </p>
      </header>

      <main className="app-main">
        <WritingInput value={text} onChange={setText} disabled={loading} />
        <AnalyzeButton
          onClick={handleAnalyze}
          loading={loading}
          disabled={!text.trim()}
        />

        {error && (
          <div className="error-message">
            <p>Oops! {error}</p>
          </div>
        )}

        {feedback && (
          <div className="feedback-grid">
            {feedback.map((item, i) => (
              <FeedbackCard key={item.dimension} data={item} index={i} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
