import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Loader2, Lock, User } from "lucide-react";
import { useAuth } from "../lib/auth";
import { Alert } from "../components/ui";
import { AppLogo } from "../components/BrandIcons";
import { APP_DESCRIPTION, APP_NAME, APP_NAME_EN } from "../lib/brand";

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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* Background orbs */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand-400/20 blur-3xl dark:bg-brand-500/15" />
        <div className="absolute -bottom-32 -right-16 h-96 w-96 rounded-full bg-indigo-400/20 blur-3xl dark:bg-indigo-500/15" />
        <div className="absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 rounded-full bg-violet-400/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-slide-up">
        <div className="card-solid !p-8 shadow-xl">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 inline-flex">
              <AppLogo size={64} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              {APP_NAME}
              <span className="ml-2 text-lg font-semibold text-slate-400">{APP_NAME_EN}</span>
            </h1>
            <p className="mt-2 text-sm text-slate-500">{APP_DESCRIPTION}</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            {error && <Alert type="error">{error}</Alert>}
            <div>
              <label className="label">用户名</label>
              <div className="relative">
                <User
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  className="input !pl-10"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                  autoComplete="username"
                />
              </div>
            </div>
            <div>
              <label className="label">密码</label>
              <div className="relative">
                <Lock
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  className="input !pl-10"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="默认 admin123，请尽快修改"
                  autoComplete="current-password"
                />
              </div>
            </div>
            <button className="btn-primary w-full !py-2.5" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" size={16} /> : null}
              登录
            </button>
          </form>
          <p className="mt-6 text-center text-xs text-slate-400">
            首次登录请修改默认密码与用户名 · 仅限授权管理员访问
          </p>
        </div>
      </div>
    </div>
  );
}
