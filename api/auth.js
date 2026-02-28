import bcrypt from "bcryptjs";
import { getDb } from "./_firebase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { role, password, studentId } = req.body || {};

  if (!role || !password) {
    return res.status(400).json({ error: "Missing role or password" });
  }

  try {
    if (role === "teacher") {
      const teacherPw = process.env.TEACHER_PASSWORD;
      if (!teacherPw) {
        return res.status(500).json({ error: "Teacher password not configured" });
      }
      if (password !== teacherPw) {
        return res.status(401).json({ error: "Incorrect password" });
      }
      return res.status(200).json({ role: "teacher" });
    }

    if (role === "student") {
      if (!studentId) {
        return res.status(400).json({ error: "Missing student ID" });
      }
      const db = getDb();
      const doc = await db.collection("students").doc(studentId).get();
      if (!doc.exists) {
        return res.status(401).json({ error: "Student not found" });
      }
      const student = doc.data();
      const match = await bcrypt.compare(password, student.password);
      if (!match) {
        return res.status(401).json({ error: "Incorrect password" });
      }
      return res.status(200).json({ role: "student", name: student.name });
    }

    return res.status(400).json({ error: "Invalid role" });
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(500).json({ error: "Authentication failed" });
  }
}
