import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { useAuth } from "./lib/auth";
import { Loading } from "./components/ui";
import LoginPage from "./pages/Login";
import DashboardPage from "./pages/Dashboard";
import AccountsPage from "./pages/Accounts";
import MountsPage from "./pages/Mounts";
import FilesPage from "./pages/Files";
import CachePage from "./pages/Cache";
import TasksPage from "./pages/Tasks";
import UploadsPage from "./pages/Uploads";
import SettingsPage from "./pages/Settings";
import HelpPage from "./pages/Help";

function Private({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Private>
            <Layout />
          </Private>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="mounts" element={<MountsPage />} />
        <Route path="files" element={<FilesPage />} />
        <Route path="uploads" element={<UploadsPage />} />
        <Route path="cache" element={<CachePage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="help" element={<HelpPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
