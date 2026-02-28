import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import LoginPage from "./pages/LoginPage";
import StudentWritePage from "./pages/StudentWritePage";
import TeacherSetupPage from "./pages/TeacherSetupPage";
import TeacherDashboardPage from "./pages/TeacherDashboardPage";
import "./App.css";

function ProtectedRoute({ children, allowedRole }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/" replace />;
  if (allowedRole && user.role !== allowedRole) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route
        path="/student/write"
        element={
          <ProtectedRoute allowedRole="student">
            <StudentWritePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/setup"
        element={
          <ProtectedRoute allowedRole="teacher">
            <TeacherSetupPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/dashboard"
        element={
          <ProtectedRoute allowedRole="teacher">
            <TeacherDashboardPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
