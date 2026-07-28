import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  Download,
  HardDrive,
  KeyRound,
  Save,
  Settings2,
  Shield,
  Upload,
  UserRound,
} from "lucide-react";
import { api, getToken, setToken } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Alert, Loading, PageHeader } from "../components/ui";
import { GoogleDriveIcon, OneDriveIcon } from "../components/BrandIcons";
import clsx from "clsx";

type Settings = {
  google_client_id: string;
  google_client_secret_set: boolean;
  google_redirect_uri: string;
  microsoft_client_id: string;
  microsoft_client_secret_set: boolean;
  microsoft_redirect_uri: string;
  microsoft_tenant: string;
  allow_file_delete: boolean;
  watchdog_interval_seconds: number;
  watchdog_max_restarts: number;
  rclone_config_path: string;
  data_dir: string;
  app_version: string;
};

type Tab = "account" | "oauth" | "runtime" | "backup";

export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const [s, setS] = useState<Settings | null>(null);
  const [rclone, setRclone] = useState<any>(null);
  const [secret, setSecret] = useState("");
  const [msSecret, setMsSecret] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [pwd, setPwd] = useState({ current: "", next: "" });
  const [uname, setUname] = useState({ next: "", password: "" });
  const [backups, setBackups] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>("account");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const [settings, rc, bk] = await Promise.all([
        api.get<Settings>("/settings"),
        api.get("/rclone/status"),
        api.get<any[]>("/backups"),
      ]);
      setS(settings);
      setRclone(rc);
      setBackups(bk);
    } catch (e: any) {
      setError(e.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (user?.username) {
      setUname((u) => ({ ...u, next: u.next || user.username }));
    }
  }, [user?.username]);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    try {
      const body: any = {
        google_client_id: s.google_client_id,
        google_redirect_uri: s.google_redirect_uri,
        microsoft_client_id: s.microsoft_client_id,
        microsoft_redirect_uri: s.microsoft_redirect_uri,
        microsoft_tenant: s.microsoft_tenant || "common",
        watchdog_interval_seconds: s.watchdog_interval_seconds,
        watchdog_max_restarts: s.watchdog_max_restarts,
      };
      if (secret) body.google_client_secret = secret;
      if (msSecret) body.microsoft_client_secret = msSecret;
      const updated = await api.put<Settings>("/settings", body);
      setS(updated);
      setSecret("");
      setMsSecret("");
      setMsg("设置已保存");
      setError("");
    } catch (e: any) {
      setError(e.detail || e.message);
    } finally {
      setSaving(false);
    }
  };

  const installRclone = async () => {
    try {
      const res = await api.post<{ message: string }>("/rclone/install");
      setMsg(res.message);
      await load();
    } catch (e: any) {
      setError(e.detail || e.message);
    }
  };

  const changePassword = async () => {
    try {
      await api.post("/auth/change-password", {
        current_password: pwd.current,
        new_password: pwd.next,
      });
      setMsg("密码已修改");
      setError("");
      setPwd({ current: "", next: "" });
      await refresh();
    } catch (e: any) {
      setError(e.detail || e.message);
    }
  };

  const changeUsername = async () => {
    const next = uname.next.trim();
    if (!next) {
      setError("请输入新用户名");
      return;
    }
    if (!uname.password) {
      setError("修改用户名需要验证当前密码");
      return;
    }
    try {
      const res = await api.post<{
        message: string;
        username: string;
        access_token: string;
      }>("/auth/change-username", {
        new_username: next,
        current_password: uname.password,
      });
      setToken(res.access_token);
      setMsg(res.message || "用户名已更新");
      setError("");
      setUname({ next: res.username, password: "" });
      await refresh();
    } catch (e: any) {
      setError(e.detail || e.message);
    }
  };

  const createBackup = async () => {
    try {
      const res = await api.post<{ message: string; detail: any }>("/backups");
      setMsg(res.message);
      await load();
    } catch (e: any) {
      setError(e.detail || e.message);
    }
  };

  const restore = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await api.upload<{ message: string }>("/backups/restore", fd);
      setMsg(res.message);
      await load();
    } catch (e: any) {
      setError(e.detail || e.message);
    }
  };

  const downloadBackup = async (name: string) => {
    const r = await fetch(`/api/backups/${name}/download`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loading || !s) return <Loading />;

  const initial = (user?.username || "A").slice(0, 1).toUpperCase();
  const tabs: { id: Tab; label: string; icon: typeof UserRound }[] = [
    { id: "account", label: "账号安全", icon: Shield },
    { id: "oauth", label: "OAuth 授权", icon: KeyRound },
    { id: "runtime", label: "运行环境", icon: Settings2 },
    { id: "backup", label: "备份恢复", icon: Download },
  ];

  return (
    <div>
      <PageHeader
        title="系统设置"
        desc={`云桥 v${s.app_version} · 当前用户 ${user?.username || "—"}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/help#connect" className="btn-secondary">
              <BookOpen size={16} /> OAuth 教程
            </Link>
            {(tab === "oauth" || tab === "runtime") && (
              <button className="btn-primary" onClick={save} disabled={saving}>
                <Save size={16} /> {saving ? "保存中…" : "保存设置"}
              </button>
            )}
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert type="error">{error}</Alert>
        </div>
      )}
      {msg && (
        <div className="mb-4">
          <Alert type="success">{msg}</Alert>
        </div>
      )}

      {/* Profile strip */}
      <div className="card mb-4 !py-3.5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-600 text-lg font-bold text-white shadow-sm">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold tracking-tight">{user?.username}</div>
            <div className="text-xs text-slate-500">
              管理员 · 上次登录{" "}
              {user?.last_login ? new Date(user.last_login).toLocaleString() : "—"}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span
              className={clsx(
                "rounded-full px-2.5 py-1 font-medium",
                rclone?.installed
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
              )}
            >
              rclone {rclone?.installed ? `v${rclone.version}` : "未安装"}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              v{s.app_version}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-700 dark:bg-slate-900">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={clsx(
              "inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition sm:flex-none sm:px-4",
              tab === t.id
                ? "bg-white text-brand-700 shadow-sm dark:bg-slate-800 dark:text-brand-300"
                : "text-slate-500 hover:bg-white/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-200"
            )}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Account */}
      {tab === "account" && (
        <div className="card !p-0 overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Shield size={16} className="text-brand-500" />
              账号安全
            </div>
            <p className="mt-0.5 text-xs text-slate-500">修改登录用户名与密码，需验证当前密码</p>
          </div>
          <div className="grid divide-y divide-slate-100 lg:grid-cols-2 lg:divide-x lg:divide-y-0 dark:divide-slate-800">
            <div className="space-y-4 p-5">
              <div className="flex items-center gap-2">
                <div className="rounded-xl bg-brand-50 p-2 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
                  <UserRound size={16} />
                </div>
                <div>
                  <div className="text-sm font-semibold">修改用户名</div>
                  <div className="text-[11px] text-slate-400">生效后当前会话自动续签</div>
                </div>
              </div>
              <div>
                <label className="label">当前用户名</label>
                <input className="input" value={user?.username || ""} disabled />
              </div>
              <div>
                <label className="label">新用户名</label>
                <input
                  className="input"
                  value={uname.next}
                  onChange={(e) => setUname({ ...uname, next: e.target.value })}
                  placeholder="2–64 位，中英文 / 数字 / _ . -"
                  autoComplete="username"
                />
              </div>
              <div>
                <label className="label">当前密码（验证）</label>
                <input
                  className="input"
                  type="password"
                  value={uname.password}
                  onChange={(e) => setUname({ ...uname, password: e.target.value })}
                  placeholder="输入当前登录密码"
                  autoComplete="current-password"
                />
              </div>
              <button
                className="btn-primary"
                onClick={changeUsername}
                disabled={
                  !uname.next.trim() || !uname.password || uname.next.trim() === user?.username
                }
              >
                <UserRound size={16} /> 更新用户名
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="flex items-center gap-2">
                <div className="rounded-xl bg-violet-50 p-2 text-violet-600 dark:bg-violet-950 dark:text-violet-300">
                  <KeyRound size={16} />
                </div>
                <div>
                  <div className="text-sm font-semibold">修改密码</div>
                  <div className="text-[11px] text-slate-400">新密码至少 8 位</div>
                </div>
              </div>
              <div>
                <label className="label">当前密码</label>
                <input
                  className="input"
                  type="password"
                  value={pwd.current}
                  onChange={(e) => setPwd({ ...pwd, current: e.target.value })}
                  autoComplete="current-password"
                />
              </div>
              <div>
                <label className="label">新密码</label>
                <input
                  className="input"
                  type="password"
                  value={pwd.next}
                  onChange={(e) => setPwd({ ...pwd, next: e.target.value })}
                  autoComplete="new-password"
                  placeholder="至少 8 位"
                />
              </div>
              <button
                className="btn-secondary"
                onClick={changePassword}
                disabled={pwd.next.length < 8 || !pwd.current}
              >
                <KeyRound size={16} /> 更新密码
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OAuth */}
      {tab === "oauth" && (
        <div className="space-y-4">
          <div className="card !p-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <GoogleDriveIcon size={18} />
                Google OAuth · Drive
              </div>
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  s.google_client_id
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                )}
              >
                {s.google_client_id ? "已配置 Client ID" : "未配置"}
              </span>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-xs leading-relaxed text-slate-500">
                在 Google Cloud Console 创建 OAuth 客户端（Web 应用），Redirect URI 填下方地址。Scope
                使用 Drive 完整访问。详见{" "}
                <Link to="/help#connect" className="font-medium text-brand-600 underline">
                  使用帮助
                </Link>
                。
              </p>
              <div>
                <label className="label">Client ID</label>
                <input
                  className="input font-mono text-xs"
                  value={s.google_client_id}
                  onChange={(e) => setS({ ...s, google_client_id: e.target.value })}
                />
              </div>
              <div>
                <label className="label">
                  Client Secret {s.google_client_secret_set ? "（已设置，留空不改）" : ""}
                </label>
                <input
                  className="input font-mono text-xs"
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="label">Redirect URI</label>
                <input
                  className="input font-mono text-xs"
                  value={s.google_redirect_uri}
                  onChange={(e) => setS({ ...s, google_redirect_uri: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="card !p-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <OneDriveIcon size={18} />
                Microsoft OAuth · OneDrive
              </div>
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  s.microsoft_client_id
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                )}
              >
                {s.microsoft_client_id ? "已配置 Client ID" : "未配置"}
              </span>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-xs leading-relaxed text-slate-500">
                在{" "}
                <a
                  className="font-medium text-brand-600 underline"
                  href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                  target="_blank"
                  rel="noreferrer"
                >
                  Azure 应用注册
                </a>{" "}
                创建 Web 平台应用，Redirect URI 可与 Google 共用路径。账号页点「Web OAuth」即可网页登录。
              </p>
              <div>
                <label className="label">Application (client) ID</label>
                <input
                  className="input font-mono text-xs"
                  value={s.microsoft_client_id || ""}
                  onChange={(e) => setS({ ...s, microsoft_client_id: e.target.value })}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
              </div>
              <div>
                <label className="label">
                  Client Secret {s.microsoft_client_secret_set ? "（已设置，留空不改）" : ""}
                </label>
                <input
                  className="input font-mono text-xs"
                  type="password"
                  value={msSecret}
                  onChange={(e) => setMsSecret(e.target.value)}
                  placeholder="Azure 客户端密码值（不是 Secret ID）"
                />
              </div>
              <div>
                <label className="label">Redirect URI</label>
                <input
                  className="input font-mono text-xs"
                  value={s.microsoft_redirect_uri || s.google_redirect_uri || ""}
                  onChange={(e) => setS({ ...s, microsoft_redirect_uri: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Tenant</label>
                <select
                  className="input"
                  value={s.microsoft_tenant || "common"}
                  onChange={(e) => setS({ ...s, microsoft_tenant: e.target.value })}
                >
                  <option value="common">common（个人 + 组织，推荐）</option>
                  <option value="consumers">consumers（仅个人 Microsoft 账号）</option>
                  <option value="organizations">organizations（仅工作/学校）</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button className="btn-primary" onClick={save} disabled={saving}>
              <Save size={16} /> {saving ? "保存中…" : "保存 OAuth 设置"}
            </button>
          </div>
        </div>
      )}

      {/* Runtime */}
      {tab === "runtime" && (
        <div className="card !p-0 overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Settings2 size={16} className="text-indigo-500" />
              运行环境
            </div>
            <p className="mt-0.5 text-xs text-slate-500">Watchdog、rclone 与数据路径</p>
          </div>

          <div className="grid divide-y divide-slate-100 lg:grid-cols-2 lg:divide-x lg:divide-y-0 dark:divide-slate-800">
            <div className="space-y-4 p-5">
              <div className="text-sm font-semibold">Watchdog 参数</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">检测间隔（秒）</label>
                  <input
                    className="input"
                    type="number"
                    min={5}
                    value={s.watchdog_interval_seconds}
                    onChange={(e) =>
                      setS({ ...s, watchdog_interval_seconds: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <label className="label">最大连续恢复</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={s.watchdog_max_restarts}
                    onChange={(e) =>
                      setS({ ...s, watchdog_max_restarts: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
              <button className="btn-primary" onClick={save} disabled={saving}>
                <Save size={16} /> 保存参数
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <HardDrive size={16} className="text-slate-500" />
                  rclone
                </div>
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    rclone?.installed
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                  )}
                >
                  {rclone?.installed ? `已安装 v${rclone.version}` : "未安装"}
                </span>
              </div>
              <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">二进制</span>
                  <span className="truncate font-mono text-slate-700 dark:text-slate-200">
                    {rclone?.path || "—"}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 shrink-0">配置</span>
                  <span className="truncate font-mono text-slate-700 dark:text-slate-200">
                    {s.rclone_config_path}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 shrink-0">数据目录</span>
                  <span className="truncate font-mono text-slate-700 dark:text-slate-200">
                    {s.data_dir}
                  </span>
                </div>
              </div>
              {!rclone?.installed && (
                <button className="btn-primary w-full" onClick={installRclone}>
                  一键安装 rclone
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Backup */}
      {tab === "backup" && (
        <div className="card !p-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Download size={16} className="text-sky-500" />
                备份与恢复
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                含账号、挂载与 rclone 配置（加密存储）
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={createBackup}>
                <Download size={16} /> 创建备份
              </button>
              <label className="btn-secondary cursor-pointer">
                <Upload size={16} /> 恢复备份
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])}
                />
              </label>
            </div>
          </div>

          {backups.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-slate-500">暂无备份文件</div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {backups.map((b) => (
                <li
                  key={b.name}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 transition hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs font-medium text-slate-700 dark:text-slate-200">
                      {b.name}
                    </div>
                    {(b.size != null || b.mtime) && (
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        {b.size != null && `${(b.size / 1024).toFixed(1)} KB`}
                        {b.mtime && ` · ${new Date(b.mtime).toLocaleString()}`}
                      </div>
                    )}
                  </div>
                  <button className="btn-ghost !py-1.5 text-xs text-brand-600" onClick={() => downloadBackup(b.name)}>
                    下载
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
