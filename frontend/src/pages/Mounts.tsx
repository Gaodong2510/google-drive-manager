import { useEffect, useState } from "react";
import {
  FileText,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import { api, formatBytes, formatDuration, getToken } from "../lib/api";
import type { DriveAccount, Mount } from "../lib/types";
import { Alert, Empty, Loading, Modal, PageHeader, StatusBadge } from "../components/ui";

export default function MountsPage() {
  const [list, setList] = useState<Mount[]>([]);
  const [accounts, setAccounts] = useState<DriveAccount[]>([]);
  const [presets, setPresets] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logContent, setLogContent] = useState("");
  const [logId, setLogId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    name: "",
    account_id: 0,
    remote_path: "",
    local_path: "/mnt/google_drive",
    mode: "media",
    auto_start: true,
  });

  const load = async () => {
    try {
      const [m, a, p] = await Promise.all([
        api.get<Mount[]>("/mounts"),
        api.get<DriveAccount[]>("/accounts"),
        api.get<Record<string, any>>("/mounts/presets"),
      ]);
      setList(m);
      setAccounts(a);
      setPresets(p);
      if (!form.account_id && a.length) setForm((f) => ({ ...f, account_id: a[0].id }));
      setError("");
    } catch (e: any) {
      setError(e.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post("/mounts", form);
      setOpen(false);
      setMsg("挂载已创建");
      await load();
    } catch (e: any) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: number, action: "start" | "stop" | "restart") => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/mounts/${id}/${action}`);
      setMsg(`已执行 ${action}`);
      await load();
    } catch (e: any) {
      setError(e.detail || e.message);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number, name: string) => {
    if (!confirm(`删除挂载「${name}」？将先停止进程。`)) return;
    await api.delete(`/mounts/${id}`);
    await load();
  };

  const showLogs = async (id: number) => {
    setLogId(id);
    setLogOpen(true);
    const res = await api.get<{ content: string }>(`/mounts/${id}/logs?lines=300`);
    setLogContent(res.content || "(空日志)");
  };

  if (loading) return <Loading />;

  return (
    <div>
      <PageHeader
        title="挂载管理"
        desc="使用 rclone 将 Google Drive 挂载到本地，支持媒体服务器优化参数"
        actions={
          <>
            <button className="btn-secondary" onClick={load}>
              <RefreshCw size={16} /> 刷新
            </button>
            <button className="btn-primary" onClick={() => setOpen(true)} disabled={!accounts.length}>
              <Plus size={16} /> 创建挂载
            </button>
          </>
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

      {list.length === 0 ? (
        <Empty title="暂无挂载点" desc={accounts.length ? "创建第一个挂载，建议使用媒体服务器模式" : "请先添加并授权 Google Drive 账号"} />
      ) : (
        <div className="space-y-4">
          {list.map((m) => (
            <div key={m.id} className="card">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold">{m.name}</h3>
                    <StatusBadge status={m.status} />
                    <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {m.mode === "media" ? "媒体服务器" : m.mode === "cloud" ? "普通云盘" : "自定义"}
                    </span>
                    {m.watchdog_paused && <span className="badge bg-rose-100 text-rose-700">Watchdog 已暂停</span>}
                  </div>
                  <div className="grid gap-1 text-sm text-slate-500 sm:grid-cols-2">
                    <div>
                      账号: <span className="text-slate-700 dark:text-slate-200">{m.account_name}</span> ({m.remote_name}
                      {m.remote_path ? `:${m.remote_path}` : ":"})
                    </div>
                    <div>
                      本地: <span className="font-mono text-xs text-slate-700 dark:text-slate-200">{m.local_path}</span>
                    </div>
                    <div>PID: {m.pid || "—"}</div>
                    <div>运行: {formatDuration(m.uptime_seconds)}</div>
                    <div>缓存: {formatBytes(m.cache_size_bytes)}</div>
                    <div>
                      重启次数: {m.restart_count} · 连续失败: {m.consecutive_failures}
                    </div>
                  </div>
                  {m.last_error && (
                    <div className="mt-3">
                      <Alert type="error">{m.last_error}</Alert>
                    </div>
                  )}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-slate-400">查看 rclone 命令预览</summary>
                    <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-950 p-3 text-xs text-emerald-300">
                      {m.command_preview.join(" \\\n  ")}
                    </pre>
                  </details>
                </div>
                <div className="flex flex-wrap gap-2 lg:w-48 lg:flex-col">
                  <button className="btn-primary" disabled={busy || m.status === "running"} onClick={() => act(m.id, "start")}>
                    <Play size={14} /> 启动
                  </button>
                  <button className="btn-secondary" disabled={busy} onClick={() => act(m.id, "stop")}>
                    <Square size={14} /> 停止
                  </button>
                  <button className="btn-secondary" disabled={busy} onClick={() => act(m.id, "restart")}>
                    <RotateCcw size={14} /> 重启
                  </button>
                  <button className="btn-ghost" onClick={() => showLogs(m.id)}>
                    <FileText size={14} /> 日志
                  </button>
                  <button className="btn-ghost text-rose-600" onClick={() => remove(m.id, m.name)}>
                    <Trash2 size={14} /> 删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} title="创建挂载" onClose={() => setOpen(false)} wide>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">名称</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="media_main" />
            </div>
            <div>
              <label className="label">Google Drive 账号</label>
              <select className="input" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: Number(e.target.value) })}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.remote_name})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Remote 内路径（可空=根目录）</label>
              <input className="input" value={form.remote_path} onChange={(e) => setForm({ ...form, remote_path: e.target.value })} placeholder="Media" />
            </div>
            <div>
              <label className="label">本地挂载路径</label>
              <input className="input" value={form.local_path} onChange={(e) => setForm({ ...form, local_path: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">参数模式</label>
            <div className="grid gap-2 sm:grid-cols-3">
              {Object.entries(presets).map(([key, p]) => (
                <button
                  key={key}
                  type="button"
                  className={`rounded-xl border p-3 text-left text-sm transition ${
                    form.mode === key
                      ? "border-brand-500 bg-brand-50 dark:bg-brand-950/40"
                      : "border-slate-200 dark:border-slate-700"
                  }`}
                  onClick={() => setForm({ ...form, mode: key })}
                >
                  <div className="font-medium">{p.label}</div>
                  <div className="mt-1 text-xs text-slate-500">{p.description}</div>
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.auto_start} onChange={(e) => setForm({ ...form, auto_start: e.target.checked })} />
            开机 / 异常自动恢复
          </label>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setOpen(false)}>
              取消
            </button>
            <button className="btn-primary" disabled={busy || !form.name || !form.local_path} onClick={create}>
              创建
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={logOpen} title={`挂载日志 #${logId}`} onClose={() => setLogOpen(false)} wide>
        <div className="mb-3 flex gap-2">
          <button className="btn-secondary" onClick={() => logId && showLogs(logId)}>
            刷新
          </button>
          {logId && (
            <button
              className="btn-secondary"
              onClick={async () => {
                const r = await fetch(`/api/mounts/${logId}/logs/download`, {
                  headers: { Authorization: `Bearer ${getToken()}` },
                });
                const blob = await r.blob();
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `mount_${logId}.log`;
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              下载
            </button>
          )}
        </div>
        <pre className="max-h-[60vh] overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-relaxed text-slate-200 whitespace-pre-wrap">
          {logContent}
        </pre>
      </Modal>
    </div>
  );
}
