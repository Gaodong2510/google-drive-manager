import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Download, KeyRound, Save, Upload } from "lucide-react";
import { api, getToken } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Alert, Loading, PageHeader } from "../components/ui";

type Settings = {
  google_client_id: string;
  google_client_secret_set: boolean;
  google_redirect_uri: string;
  allow_file_delete: boolean;
  watchdog_interval_seconds: number;
  watchdog_max_restarts: number;
  rclone_config_path: string;
  data_dir: string;
  app_version: string;
};

export default function SettingsPage() {
  const { refresh } = useAuth();
  const [s, setS] = useState<Settings | null>(null);
  const [rclone, setRclone] = useState<any>(null);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [pwd, setPwd] = useState({ current: "", next: "" });
  const [backups, setBackups] = useState<any[]>([]);

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

  const save = async () => {
    if (!s) return;
    try {
      const body: any = {
        google_client_id: s.google_client_id,
        google_redirect_uri: s.google_redirect_uri,
        watchdog_interval_seconds: s.watchdog_interval_seconds,
        watchdog_max_restarts: s.watchdog_max_restarts,
      };
      if (secret) body.google_client_secret = secret;
      const updated = await api.put<Settings>("/settings", body);
      setS(updated);
      setSecret("");
      setMsg("设置已保存");
    } catch (e: any) {
      setError(e.detail || e.message);
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
      setPwd({ current: "", next: "" });
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

  if (loading || !s) return <Loading />;

  return (
    <div>
      <PageHeader
        title="系统设置"
        desc={`版本 v${s.app_version}`}
        actions={
          <Link to="/help#connect" className="btn-secondary">
            <BookOpen size={16} /> OAuth 配置教程
          </Link>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-4">
          <h3 className="font-semibold">Google OAuth</h3>
          <Alert type="info">
            在 Google Cloud Console 创建 OAuth 客户端（Web 应用），将授权重定向 URI 设为下方 Redirect URI。
            Scope 使用 Drive 完整访问权限。图文步骤见{" "}
            <Link to="/help#connect" className="font-medium underline">
              使用帮助
            </Link>
            。
          </Alert>
          <div>
            <label className="label">Client ID</label>
            <input className="input" value={s.google_client_id} onChange={(e) => setS({ ...s, google_client_id: e.target.value })} />
          </div>
          <div>
            <label className="label">Client Secret {s.google_client_secret_set ? "(已设置，留空不修改)" : ""}</label>
            <input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••••••" />
          </div>
          <div>
            <label className="label">Redirect URI</label>
            <input className="input" value={s.google_redirect_uri} onChange={(e) => setS({ ...s, google_redirect_uri: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Watchdog 间隔(秒)</label>
              <input
                className="input"
                type="number"
                value={s.watchdog_interval_seconds}
                onChange={(e) => setS({ ...s, watchdog_interval_seconds: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="label">最大连续恢复次数</label>
              <input
                className="input"
                type="number"
                value={s.watchdog_max_restarts}
                onChange={(e) => setS({ ...s, watchdog_max_restarts: Number(e.target.value) })}
              />
            </div>
          </div>
          <button className="btn-primary" onClick={save}>
            <Save size={16} /> 保存设置
          </button>
        </div>

        <div className="space-y-4">
          <div className="card space-y-3">
            <h3 className="font-semibold">rclone</h3>
            <div className="text-sm text-slate-500">
              状态: {rclone?.installed ? `已安装 v${rclone.version}` : "未安装"}
              <br />
              路径: {rclone?.path || "—"}
              <br />
              配置: <span className="font-mono text-xs">{s.rclone_config_path}</span>
              <br />
              数据目录: <span className="font-mono text-xs">{s.data_dir}</span>
            </div>
            {!rclone?.installed && (
              <button className="btn-primary" onClick={installRclone}>
                一键安装 rclone
              </button>
            )}
          </div>

          <div className="card space-y-3">
            <h3 className="font-semibold">修改密码</h3>
            <div>
              <label className="label">当前密码</label>
              <input className="input" type="password" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} />
            </div>
            <div>
              <label className="label">新密码（至少 8 位）</label>
              <input className="input" type="password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} />
            </div>
            <button className="btn-secondary" onClick={changePassword} disabled={pwd.next.length < 8}>
              <KeyRound size={16} /> 更新密码
            </button>
          </div>

          <div className="card space-y-3">
            <h3 className="font-semibold">备份与恢复</h3>
            <p className="text-xs text-slate-500">备份包含账号配置、挂载配置、rclone 配置（加密存储）。</p>
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
            <ul className="space-y-2 text-sm">
              {backups.map((b) => (
                <li key={b.name} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800">
                  <span className="truncate font-mono text-xs">{b.name}</span>
                  <button
                    className="text-brand-600 text-xs"
                    onClick={async () => {
                      const r = await fetch(`/api/backups/${b.name}/download`, {
                        headers: { Authorization: `Bearer ${getToken()}` },
                      });
                      const blob = await r.blob();
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = b.name;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                  >
                    下载
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
