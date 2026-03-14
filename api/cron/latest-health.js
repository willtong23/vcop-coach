/**
 * 查看最新健康報告 — GET /api/cron/latest-health
 * Will 可以隨時查看最新的系統健康報告
 * 需要 CRON_SECRET Bearer token 驗證
 */

import { getDb } from "../_firebase.js";

export default async function handler(req, res) {
  // Authorization: Bearer header（與 Vercel Cron 一致）
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const db = getDb();
    const limit = parseInt(req.query.limit) || 1;

    const snap = await db
      .collection("system-health-reports")
      .orderBy("createdAt", "desc")
      .limit(Math.min(limit, 10))
      .get();

    if (snap.empty) {
      return res.status(200).json({
        message: "No health reports yet. The first one will be generated on Monday 5 PM HKT.",
      });
    }

    const reports = snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      // Firestore Timestamp → ISO string
      createdAt: doc.data().createdAt?.toDate?.()
        ? doc.data().createdAt.toDate().toISOString()
        : doc.data().createdAt,
    }));

    // 如果只要一筆，直接返回（不包在 array 裡）
    if (limit === 1) {
      const report = reports[0];
      // 如果 accept header 想要 text，返回 summary
      if (req.headers.accept?.includes("text/plain")) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        return res.status(200).send(report.summary || JSON.stringify(report, null, 2));
      }
      return res.status(200).json(report);
    }

    return res.status(200).json({ reports });
  } catch (error) {
    console.error("[LATEST HEALTH] Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
