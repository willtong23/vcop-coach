import bcrypt from "bcryptjs";
import { getDb } from "./_firebase.js";

export default async function handler(req, res) {
  const db = getDb();
  // Verify teacher password for authorization
  const teacherPw = req.headers["x-teacher-password"];
  if (!teacherPw || teacherPw !== process.env.TEACHER_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method === "POST") {
    const { studentId, name, password } = req.body || {};
    if (!studentId || !name || !password) {
      return res.status(400).json({ error: "Missing studentId, name, or password" });
    }

    try {
      const hashed = await bcrypt.hash(password, 10);
      await db.collection("students").doc(studentId).set({
        name,
        password: hashed,
        yearGroup: parseInt(studentId.split("-")[0], 10) || null,
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("Create student error:", err);
      return res.status(500).json({ error: "Failed to create student" });
    }
  }

  if (req.method === "GET") {
    try {
      const snap = await db.collection("students").get();
      const students = snap.docs.map((doc) => ({
        id: doc.id,
        name: doc.data().name,
        yearGroup: doc.data().yearGroup,
      }));
      return res.status(200).json(students);
    } catch (err) {
      console.error("List students error:", err);
      return res.status(500).json({ error: "Failed to list students" });
    }
  }

  if (req.method === "DELETE") {
    const { studentId } = req.body || {};
    if (!studentId) {
      return res.status(400).json({ error: "Missing studentId" });
    }
    try {
      await db.collection("students").doc(studentId).delete();
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("Delete student error:", err);
      return res.status(500).json({ error: "Failed to delete student" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
