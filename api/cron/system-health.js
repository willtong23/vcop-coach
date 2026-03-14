/**
 * 系統健康檢查 — 每週一下午 5 點 HKT 自動執行
 * 檢查所有教育工具的使用狀況、品質指標、學生進度、系統可用性
 * 報告存入 Firestore `system-health-reports` collection
 */

import { getDb } from "../_firebase.js";

// HKT = UTC+8
const HKT_OFFSET = 8 * 60 * 60 * 1000;

function toHKT(date) {
  return new Date(date.getTime() + HKT_OFFSET);
}

function formatHKT(date) {
  const hkt = toHKT(date);
  return hkt.toISOString().replace("T", " ").slice(0, 19) + " HKT";
}

// 取得過去 N 天的起始時間
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export default async function handler(req, res) {
  // Vercel Cron 驗證
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const db = getDb();
    const now = new Date();
    const weekAgo = daysAgo(7);
    const twoWeeksAgo = daysAgo(14);

    const report = {
      generatedAt: now.toISOString(),
      generatedAtHKT: formatHKT(now),
      weekEnding: formatHKT(now),
      weekStarting: formatHKT(weekAgo),
    };

    // ====== 1. USAGE METRICS ======
    const usage = await getUsageMetrics(db, weekAgo, now);
    report.usage = usage;

    // ====== 2. QUALITY SIGNALS ======
    const quality = await getQualitySignals(db, weekAgo);
    report.quality = quality;

    // ====== 3. STUDENT PROGRESS ======
    const progress = await getStudentProgress(db, weekAgo, twoWeeksAgo);
    report.progress = progress;

    // ====== 4. SYSTEM HEALTH ======
    const health = await checkSystemHealth();
    report.systemHealth = health;

    // ====== 5. WEEK-OVER-WEEK COMPARISON ======
    const previousReport = await getPreviousReport(db);
    if (previousReport) {
      report.weekOverWeek = buildComparison(report, previousReport);
    }

    // ====== 6. SUMMARY（人類可讀摘要）======
    report.summary = buildSummary(report);

    // 存入 Firestore
    await db.collection("system-health-reports").add({
      ...report,
      createdAt: now,
    });

    return res.status(200).json(report);
  } catch (error) {
    console.error("[HEALTH CHECK] Error:", error);
    return res.status(500).json({ error: error.message });
  }
}

// ====== Usage Metrics ======
async function getUsageMetrics(db, weekAgo, now) {
  // VCOP submissions
  const submissionsSnap = await db
    .collection("submissions")
    .where("createdAt", ">=", weekAgo)
    .get();

  const submissions = submissionsSnap.docs.map((d) => d.data());
  const totalSubmissions = submissions.length;

  // 平均修改次數
  const avgRevisions =
    totalSubmissions > 0
      ? (
          submissions.reduce(
            (sum, s) => sum + (s.iterations?.length || 1),
            0
          ) / totalSubmissions
        ).toFixed(1)
      : 0;

  // 活躍學生（VCOP）
  const activeStudentIds = new Set(submissions.map((s) => s.studentId));

  // Maths interactions（如果 collection 存在）
  let mathsInteractions = 0;
  try {
    const mathsSnap = await db
      .collection("interactions")
      .where("createdAt", ">=", weekAgo)
      .get();
    mathsInteractions = mathsSnap.size;
    mathsSnap.docs.forEach((d) => {
      const data = d.data();
      if (data.studentId) activeStudentIds.add(data.studentId);
    });
  } catch (e) {
    // collection 可能不存在
  }

  // Maths challenges（備用 collection 名稱）
  let mathsChallenges = 0;
  try {
    const challengeSnap = await db
      .collection("maths-challenges")
      .where("createdAt", ">=", weekAgo)
      .get();
    mathsChallenges = challengeSnap.size;
  } catch (e) {}

  // Research Helper knowledge_cards
  let knowledgeCards = 0;
  try {
    const cardsSnap = await db
      .collection("knowledge_cards")
      .where("createdAt", ">=", weekAgo)
      .get();
    knowledgeCards = cardsSnap.size;
  } catch (e) {}

  return {
    vcopSubmissions: totalSubmissions,
    mathsInteractions,
    mathsChallenges,
    researchCards: knowledgeCards,
    activeStudents: activeStudentIds.size,
    activeStudentIds: [...activeStudentIds],
    avgRevisionsPerSubmission: Number(avgRevisions),
  };
}

// ====== Quality Signals ======
async function getQualitySignals(db, weekAgo) {
  const submissionsSnap = await db
    .collection("submissions")
    .where("createdAt", ">=", weekAgo)
    .get();

  const submissions = submissionsSnap.docs.map((d) => d.data());
  const total = submissions.length;

  if (total === 0) {
    return {
      teacherInterventionRate: "N/A",
      avgAnnotationsPerSubmission: "N/A",
      studentGaveUpRate: "N/A",
      avgResearchConversationTurns: "N/A",
    };
  }

  // 老師評語介入率（有 teacherComment 的比例，低 = 好）
  const withTeacherComment = submissions.filter((s) => s.teacherComment).length;
  const interventionRate = ((withTeacherComment / total) * 100).toFixed(1);

  // 平均 annotations 數量（v1 的 annotations）
  const totalAnnotations = submissions.reduce((sum, s) => {
    const v1 = s.iterations?.[0];
    return sum + (v1?.annotations?.length || 0);
  }, 0);
  const avgAnnotations = (totalAnnotations / total).toFixed(1);

  // Maths 放棄率（showedAnswer=true）
  let gaveUpRate = "N/A";
  try {
    const mathsSnap = await db
      .collection("interactions")
      .where("createdAt", ">=", weekAgo)
      .get();

    if (mathsSnap.size > 0) {
      const gaveUp = mathsSnap.docs.filter(
        (d) => d.data().showedAnswer === true
      ).length;
      gaveUpRate = ((gaveUp / mathsSnap.size) * 100).toFixed(1) + "%";
    }
  } catch (e) {}

  // Research Helper 對話輪次
  let avgTurns = "N/A";
  try {
    const cardsSnap = await db
      .collection("knowledge_cards")
      .where("createdAt", ">=", weekAgo)
      .get();

    if (cardsSnap.size > 0) {
      const totalTurns = cardsSnap.docs.reduce(
        (sum, d) => sum + (d.data().conversationTurns || 0),
        0
      );
      avgTurns = (totalTurns / cardsSnap.size).toFixed(1);
    }
  } catch (e) {}

  return {
    teacherInterventionRate: interventionRate + "%",
    teacherComments: withTeacherComment,
    totalSubmissions: total,
    avgAnnotationsPerSubmission: Number(avgAnnotations),
    studentGaveUpRate: gaveUpRate,
    avgResearchConversationTurns: avgTurns,
  };
}

// ====== Student Progress ======
async function getStudentProgress(db, weekAgo, twoWeeksAgo) {
  // 本週最活躍學生
  const submissionsSnap = await db
    .collection("submissions")
    .where("createdAt", ">=", weekAgo)
    .get();

  const studentCounts = {};
  submissionsSnap.docs.forEach((d) => {
    const sid = d.data().studentId;
    studentCounts[sid] = (studentCounts[sid] || 0) + 1;
  });

  const topStudents = Object.entries(studentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({ studentId: id, submissions: count }));

  // 掙扎中的學生（所有 VCOP levels < 2）
  const profilesSnap = await db.collection("studentProfiles").get();
  const struggling = [];
  const allProfiles = [];

  profilesSnap.docs.forEach((doc) => {
    const data = doc.data();
    const profile = { studentId: doc.id, ...data };
    allProfiles.push(profile);

    if (data.vcop) {
      const levels = [
        data.vcop.vocabulary?.level,
        data.vcop.connectives?.level,
        data.vcop.openers?.level,
        data.vcop.punctuation?.level,
      ].filter((l) => l !== undefined);

      if (levels.length > 0 && levels.every((l) => l < 2)) {
        struggling.push({
          studentId: doc.id,
          levels: {
            V: data.vcop.vocabulary?.level ?? "?",
            C: data.vcop.connectives?.level ?? "?",
            O: data.vcop.openers?.level ?? "?",
            P: data.vcop.punctuation?.level ?? "?",
          },
        });
      }
    }
  });

  // 超過兩週沒提交的學生
  const recentSubmitters = new Set();
  const twoWeekSnap = await db
    .collection("submissions")
    .where("createdAt", ">=", twoWeeksAgo)
    .get();

  twoWeekSnap.docs.forEach((d) => recentSubmitters.add(d.data().studentId));

  // 從 students collection 取所有學生
  const studentsSnap = await db.collection("students").get();
  const disengaged = [];

  studentsSnap.docs.forEach((doc) => {
    if (!recentSubmitters.has(doc.id)) {
      disengaged.push({ studentId: doc.id });
    }
  });

  return {
    topStudentsThisWeek: topStudents,
    strugglingStudents: struggling,
    disengagedStudents: disengaged,
    totalStudentProfiles: allProfiles.length,
  };
}

// ====== System Health ======
async function checkSystemHealth() {
  const apps = [
    { name: "VCOP Coach", url: "https://vcop-coach.vercel.app" },
    { name: "Maths Coach Y4", url: "https://maths-coach.vercel.app" },
    { name: "Maths Coach Y6", url: "https://y6-maths-coach.vercel.app" },
    {
      name: "Research Helper",
      url: "https://research-helper-iota.vercel.app",
    },
  ];

  const results = await Promise.all(
    apps.map(async (app) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(app.url, { signal: controller.signal });
        clearTimeout(timeout);
        return {
          name: app.name,
          url: app.url,
          status: response.status,
          ok: response.ok,
        };
      } catch (error) {
        return {
          name: app.name,
          url: app.url,
          status: "ERROR",
          ok: false,
          error: error.message,
        };
      }
    })
  );

  const allUp = results.every((r) => r.ok);
  return {
    allAppsUp: allUp,
    apps: results,
  };
}

// ====== Previous Report (week-over-week) ======
async function getPreviousReport(db) {
  const snap = await db
    .collection("system-health-reports")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();

  if (snap.empty) return null;
  return snap.docs[0].data();
}

// ====== Week-over-week Comparison ======
function buildComparison(current, previous) {
  const c = current.usage;
  const p = previous.usage || {};

  function delta(curr, prev, label) {
    if (prev === undefined || prev === null) return { label, current: curr, previous: "N/A", change: "N/A" };
    const diff = curr - prev;
    const pct = prev > 0 ? ((diff / prev) * 100).toFixed(0) : "N/A";
    return {
      label,
      current: curr,
      previous: prev,
      change: diff > 0 ? `+${diff}` : `${diff}`,
      changePct: pct !== "N/A" ? `${pct}%` : "N/A",
    };
  }

  return {
    vcopSubmissions: delta(c.vcopSubmissions, p.vcopSubmissions, "VCOP Submissions"),
    activeStudents: delta(c.activeStudents, p.activeStudents, "Active Students"),
    mathsInteractions: delta(c.mathsInteractions, p.mathsInteractions, "Maths Interactions"),
    researchCards: delta(c.researchCards, p.researchCards, "Research Cards"),
    avgRevisions: delta(c.avgRevisionsPerSubmission, p.avgRevisionsPerSubmission, "Avg Revisions"),
  };
}

// ====== Human-readable Summary ======
function buildSummary(report) {
  const lines = [];
  const u = report.usage;
  const q = report.quality;
  const p = report.progress;
  const h = report.systemHealth;

  lines.push(`=== Weekly System Health Report ===`);
  lines.push(`Period: ${report.weekStarting} to ${report.weekEnding}`);
  lines.push(``);

  // Usage
  lines.push(`📊 USAGE`);
  lines.push(`  VCOP submissions: ${u.vcopSubmissions}`);
  lines.push(`  Maths interactions: ${u.mathsInteractions}`);
  if (u.mathsChallenges > 0) lines.push(`  Maths challenges: ${u.mathsChallenges}`);
  lines.push(`  Research cards: ${u.researchCards}`);
  lines.push(`  Active students: ${u.activeStudents}`);
  lines.push(`  Avg revisions per submission: ${u.avgRevisionsPerSubmission}`);
  lines.push(``);

  // Quality
  lines.push(`📈 QUALITY`);
  lines.push(`  Teacher intervention rate: ${q.teacherInterventionRate} (lower = AI handling well)`);
  lines.push(`  Avg annotations per submission: ${q.avgAnnotationsPerSubmission}`);
  lines.push(`  Maths student gave-up rate: ${q.studentGaveUpRate}`);
  lines.push(``);

  // Progress
  lines.push(`👩‍🎓 STUDENTS`);
  if (p.topStudentsThisWeek.length > 0) {
    lines.push(`  Most active: ${p.topStudentsThisWeek.map((s) => `${s.studentId} (${s.submissions})`).join(", ")}`);
  } else {
    lines.push(`  No submissions this week`);
  }
  if (p.strugglingStudents.length > 0) {
    lines.push(`  ⚠️ Struggling (all VCOP < 2): ${p.strugglingStudents.map((s) => s.studentId).join(", ")}`);
  }
  if (p.disengagedStudents.length > 0) {
    lines.push(`  ⚠️ Inactive 2+ weeks: ${p.disengagedStudents.map((s) => s.studentId).join(", ")}`);
  }
  lines.push(``);

  // System
  lines.push(`🖥️ SYSTEM`);
  if (h.allAppsUp) {
    lines.push(`  All apps UP ✅`);
  } else {
    h.apps.forEach((app) => {
      lines.push(`  ${app.name}: ${app.ok ? "UP ✅" : `DOWN ❌ (${app.status})`}`);
    });
  }

  // Week-over-week
  if (report.weekOverWeek) {
    lines.push(``);
    lines.push(`📊 WEEK-OVER-WEEK`);
    Object.values(report.weekOverWeek).forEach((d) => {
      lines.push(`  ${d.label}: ${d.previous} → ${d.current} (${d.change})`);
    });
  }

  return lines.join("\n");
}
