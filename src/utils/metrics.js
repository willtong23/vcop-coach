/**
 * Pilot metrics collection utilities for Guided Writing Mode.
 * Tracks stuck time, hint usage, revisions, and scaffolding progression.
 */
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

/**
 * Calculates seconds elapsed since a given start time.
 * @param {number} startTime - Timestamp from Date.now()
 * @returns {number} Seconds elapsed
 */
export function trackStuckTime(startTime) {
  if (!startTime) return 0;
  return Math.round((Date.now() - startTime) / 1000);
}

/**
 * Saves guided writing session metrics to Firestore.
 * Document ID: `${sessionId}_${studentId}` for easy querying.
 *
 * @param {string} sessionId
 * @param {string} studentId
 * @param {object} metrics
 * @param {number} metrics.completionRate - 0 to 1
 * @param {number} metrics.avgStuckTime - Average seconds stuck per sentence
 * @param {object} metrics.revisionsPerSentence - { "hook_0": 2, "setting_1": 0 }
 * @param {number} metrics.hintUsageRate - 0 to 1
 * @param {number} metrics.scaffoldFadeProgress - Final score minus starting score
 * @param {number} metrics.totalSentences
 * @param {number} metrics.completedSentences
 * @param {Date|null} metrics.startedAt
 * @param {boolean} metrics.isComplete
 */
export async function recordSentenceMetrics(sessionId, studentId, metrics) {
  if (!sessionId || !studentId) {
    console.warn("[METRICS] Missing sessionId or studentId, skipping save");
    return;
  }

  const docId = `${sessionId}_${studentId}`;

  try {
    const metricsData = {
      sessionId,
      studentId,
      completionRate: metrics.completionRate || 0,
      avgStuckTime: metrics.avgStuckTime || 0,
      revisionsPerSentence: metrics.revisionsPerSentence || {},
      hintUsageRate: metrics.hintUsageRate || 0,
      scaffoldFadeProgress: metrics.scaffoldFadeProgress || 0,
      totalSentences: metrics.totalSentences || 0,
      completedSentences: metrics.completedSentences || 0,
      startedAt: metrics.startedAt || serverTimestamp(),
      completedAt: metrics.isComplete ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    };

    await setDoc(doc(db, "guidedMetrics", docId), metricsData, { merge: true });
    console.log(`[METRICS] Saved metrics for ${docId}`);
  } catch (err) {
    // 查詢失敗不阻斷
    console.error("[METRICS] Failed to save metrics:", err.message);
  }
}

/**
 * Calculates aggregate metrics from session tracking state.
 * @param {object} sessionMetrics - Raw tracking data from the component
 * @param {number} totalSentences - Total sentences in the template
 * @param {number} completedSentences - How many sentences completed
 * @param {number} startingScore - Initial scaffolding score
 * @param {number} currentScore - Current scaffolding score
 * @returns {object} Formatted metrics for Firestore
 */
export function calculateMetrics(sessionMetrics, totalSentences, completedSentences, startingScore, currentScore) {
  const stuckTimes = sessionMetrics.stuckTimes || [];
  const avgStuckTime = stuckTimes.length > 0
    ? Math.round(stuckTimes.reduce((a, b) => a + b, 0) / stuckTimes.length)
    : 0;

  const totalHintOpportunities = completedSentences || 1;
  const hintUsageRate = totalHintOpportunities > 0
    ? (sessionMetrics.hintUsages || 0) / totalHintOpportunities
    : 0;

  return {
    completionRate: totalSentences > 0 ? completedSentences / totalSentences : 0,
    avgStuckTime,
    revisionsPerSentence: sessionMetrics.revisionCounts || {},
    hintUsageRate: Math.min(1, hintUsageRate),
    scaffoldFadeProgress: currentScore - startingScore,
    totalSentences,
    completedSentences,
    startedAt: sessionMetrics.startedAt || null,
    isComplete: completedSentences >= totalSentences,
  };
}
