import { useState, useRef } from "react";

export default function SpeechInput({ onTranscript, disabled, large }) {
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef(null);

  const supported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const toggle = () => {
    if (recording) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-GB";
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (last.isFinal) {
        onTranscript(last[0].transcript);
      }
    };

    recognition.onend = () => setRecording(false);
    recognition.onerror = () => setRecording(false);

    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  };

  if (!supported) return null;

  return (
    <button
      type="button"
      className={`speech-button ${recording ? "recording" : ""}${large ? " speech-button-large" : ""}`}
      onClick={toggle}
      disabled={disabled}
      title={recording ? "Stop recording" : "Start voice input"}
    >
      {recording ? "⏹" : "🎤"}
    </button>
  );
}
