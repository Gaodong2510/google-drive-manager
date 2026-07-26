import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { HardDrive, Loader2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { Alert } from "../components/ui";

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username, password);
      navigate("/");
    } catch (err: any) {
      setError(err.detail || err.message || "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-brand-50 to-indigo-100 p-4 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950">
      <div className="w-full max-w-md animate-slide-up">
        <div className="card !p-8">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-600 text-white shadow-lg">
              <HardDrive size={28} />
            </div>
            <h1 className="text-2xl font-semibold">Google Drive Manager</h1>
            <p className="mt-2 text-sm text-slate-500">稳定挂载 · 媒体服务器友好 · 生产级管理面板</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            {error && <Alert type="error">{error}</Alert>}
            <div>
              <label className="label">用户名</label>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="label">密码</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="默认 admin123，请尽快修改"
              />
            </div>
            <button className="btn-primary w-full !py-2.5" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" size={16} /> : null}
              登录
            </button>
          </form>
          <p className="mt-6 text-center text-xs text-slate-400">
            首次登录请修改默认密码 · 仅限授权管理员访问
          </p>
        </div>
      </div>
    </div>
  );
}
