import { useEffect, useRef, useState, useCallback } from "react";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

/**
 * useAutoSave — debounced auto-save to Firestore `drafts` collection
 * Document ID: `{studentId}_{sessionId}`
 */
export default function useAutoSave(studentId, sessionId, delay = 3000) {
  const [saveStatus, setSaveStatus] = useState("idle"); // "idle" | "saving" | "saved" | "error"
  const saveTimerRef = useRef(null);
  const fadeTimerRef = useRef(null);
  const docId = studentId && sessionId ? `${studentId}_${sessionId}` : null;

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  const showSavedBriefly = useCallback(() => {
    setSaveStatus("saved");
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => setSaveStatus("idle"), 4000);
  }, []);

  // Debounced save
  const saveDraft = useCallback(
    (data) => {
      if (!docId) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

      saveTimerRef.current = setTimeout(async () => {
        try {
          setSaveStatus("saving");
          await setDoc(
            doc(db, "drafts", docId),
            { studentId, sessionId, ...data, lastUpdated: serverTimestamp() },
            { merge: true }
          );
          showSavedBriefly();
        } catch (err) {
          console.error("[AUTO-SAVE] Failed:", err.message);
          setSaveStatus("error");
        }
      }, delay);
    },
    [docId, studentId, sessionId, delay, showSavedBriefly]
  );

  // Immediate save
  const saveNow = useCallback(
    async (data) => {
      if (!docId) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      try {
        setSaveStatus("saving");
        await setDoc(
          doc(db, "drafts", docId),
          { studentId, sessionId, ...data, lastUpdated: serverTimestamp() },
          { merge: true }
        );
        showSavedBriefly();
      } catch (err) {
        console.error("[AUTO-SAVE] Immediate save failed:", err.message);
        setSaveStatus("error");
      }
    },
    [docId, studentId, sessionId, showSavedBriefly]
  );

  const loadDraft = useCallback(async () => {
    if (!docId) return null;
    try {
      const snap = await getDoc(doc(db, "drafts", docId));
      if (snap.exists()) return snap.data();
      return null;
    } catch (err) {
      console.error("[AUTO-SAVE] Load failed:", err.message);
      return null;
    }
  }, [docId]);

  const clearDraft = useCallback(async () => {
    if (!docId) return;
    try {
      const { deleteDoc } = await import("firebase/firestore");
      await deleteDoc(doc(db, "drafts", docId));
    } catch (err) {
      console.error("[AUTO-SAVE] Clear failed:", err.message);
    }
  }, [docId]);

  return { saveDraft, saveNow, loadDraft, clearDraft, saveStatus };
}
