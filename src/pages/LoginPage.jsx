import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function LoginPage() {
  const [role, setRole] = useState(null); // null | "teacher" | "student"
  const [password, setPassword] = useState("");
  const [studentId, setStudentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { loginAsTeacher, loginAsStudent } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (role === "teacher") {
        await loginAsTeacher(password);
        navigate("/teacher/dashboard");
      } else {
        await loginAsStudent(studentId, password);
        navigate("/student/write");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!role) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Silvermine Bay School VCOP Coach ✏️</h1>
          <p className="subtitle">Who are you?</p>
        </header>
        <main className="app-main">
          <div className="role-buttons">
            <button className="role-button teacher-btn" onClick={() => setRole("teacher")}>
              🍎 I'm a Teacher
            </button>
            <button className="role-button student-btn" onClick={() => setRole("student")}>
              📝 I'm a Student
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Silvermine Bay School VCOP Coach ✏️</h1>
        <p className="subtitle">
          {role === "teacher" ? "Teacher Login" : "Student Login"}
        </p>
      </header>
      <main className="app-main">
        <form className="login-form" onSubmit={handleSubmit}>
          {role === "student" && (
            <div className="form-group">
              <label htmlFor="student-id" className="input-label">Student ID</label>
              <input
                id="student-id"
                type="text"
                className="form-input"
                placeholder="e.g. 18-01"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                disabled={loading}
                autoFocus
              />
            </div>
          )}
          <div className="form-group">
            <label htmlFor="password" className="input-label">Password</label>
            <input
              id="password"
              type="password"
              className="form-input"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoFocus={role === "teacher"}
            />
          </div>

          {error && (
            <div className="error-message">
              <p>{error}</p>
            </div>
          )}

          <button
            type="submit"
            className="analyze-button"
            disabled={loading || !password || (role === "student" && !studentId)}
          >
            {loading ? (
              <span className="button-loading">
                <span className="spinner" />
                Logging in...
              </span>
            ) : (
              "Log In"
            )}
          </button>

          <button
            type="button"
            className="back-link"
            onClick={() => { setRole(null); setError(null); setPassword(""); setStudentId(""); }}
          >
            ← Back
          </button>
        </form>
      </main>
    </div>
  );
}
