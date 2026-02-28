/**
 * Computes which word indices in newText are changed/added compared to oldText.
 * Returns a Set of word indices (0-based) in newText that are new or different.
 */
export function getChangedWordIndices(oldText, newText) {
  const oldWords = oldText.split(/\s+/).filter(Boolean);
  const newWords = newText.split(/\s+/).filter(Boolean);

  const m = oldWords.length;
  const n = newWords.length;

  // Build LCS table
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find which new words are "added" (not in LCS)
  const changedIndices = new Set();
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      // Same word — not changed
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      // This word in newText is added/changed
      changedIndices.add(j - 1);
      j--;
    } else {
      // Word removed from old
      i--;
    }
  }

  return changedIndices;
}
