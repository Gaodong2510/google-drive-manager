import { useEffect, useState } from "react";
import {
  ArrowUpCircle,
  CheckCircle2,
  CloudUpload,
  Loader2,
  RefreshCw,
  XCircle,
  Clock,
  Activity,
} from "lucide-react";
import { api, formatBytes, formatSpeed } from "../lib/api";
import type { UploadStatus } from "../lib/types";
import { Alert, Empty, Loading, PageHeader, ProgressBar, StatCard, StatusBadge } from "../components/ui";
import clsx from "clsx";

const eventMeta: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  success: { label: "成功", color: "text-emerald-600 dark:text-emerald-400", icon: CheckCircle2 },
  copied: { label: "已同步", color: "text-emerald-600 dark:text-emerald-400", icon: CheckCircle2 },
  queued: { label: "排队中", color: "text-amber-600 dark:text-amber-400", icon: Clock },
  uploading: { label: "上传中", color: "text-sky-600 dark:text-sky-400", icon: CloudUpload },
  failed: { label: "失败", color: "text-rose-600 dark:text-rose-400", icon: XCircle },
  stats: { label: "统计", color: "text-slate-500", icon: Activity },
};

export default function UploadsPage() {
  const [data, setData] = useState<UploadStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);

  const load = async () => {
    try {
      const d = await api.get<UploadStatus>("/uploads/status");
      setData(d);
      setError("");
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
    if (!auto) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [auto]);

  if (loading && !data) return <Loading label="加载上传进度..." />;

  const summary = data?.summary;
  const mounts = data?.mounts || [];
  const active = summary?.any_active;

  return (
    <div>
      <PageHeader
        title="上传进度"
        desc="MoviePilot 写入挂载后，rclone VFS 回写到 Google Drive 的实时队列与文件明细"
        actions={
          <>
            <label className="btn-secondary cursor-pointer gap-2">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="rounded" />
              自动刷新 3s
            </label>
            <button className="btn-secondary" onClick={load}>
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> 刷新
            </button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert type="error">{error}</Alert>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="上传状态"
          value={active ? "进行中" : "空闲"}
          icon={active ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
          accent={
            active
              ? "bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-300"
              : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300"
          }
          sub={active ? "有文件正在排队或上传到 Drive" : "队列为空，云端已跟上本地写入"}
        />
        <StatCard
          title="排队 / 上传中"
          value={`${summary?.to_upload ?? 0} / ${summary?.uploading ?? 0}`}
          icon={<ArrowUpCircle size={18} />}
          sub="VFS to_upload · uploading"
        />
        <StatCard
          title="当前速度"
          value={formatSpeed(summary?.total_speed_bps ?? 0)}
          icon={<CloudUpload size={18} />}
          sub="需重启挂载开启 RC 后更准确"
        />
        <StatCard
          title="错误数"
          value={summary?.errors ?? 0}
          icon={<XCircle size={18} />}
          accent={
            (summary?.errors ?? 0) > 0
              ? "bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-300"
              : undefined
          }
        />
      </div>

      {!mounts.length && <Empty title="暂无挂载" desc="请先在挂载管理中创建并启动 Google Drive 挂载" />}

      <div className="space-y-4">
        {mounts.map((m) => {
          const pct =
            m.transfer_percent != null
              ? m.transfer_percent
              : m.to_upload + m.uploading > 0
                ? Math.max(5, 100 - (m.to_upload + m.uploading) * 5)
                : m.active
                  ? 50
                  : 100;
          return (
            <div key={m.mount_id} className="card">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold">{m.mount_name}</h3>
                    <StatusBadge status={m.status} />
                    {m.active && (
                      <span className="badge bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
                        上传中
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {m.local_path}
                    {m.rc_enabled ? (
                      <span className="ml-2 text-emerald-600">· RC 实时 :{m.rc_port}</span>
                    ) : (
                      <span className="ml-2 text-amber-600">· 日志模式</span>
                    )}
                    <span className="ml-2">· 数据源 {m.source}</span>
                  </div>
                </div>
                <div className="text-right text-sm text-slate-500">
                  <div>
                    缓存对象 {m.objects} · 使用中 {m.in_use}
                  </div>
                  <div>
                    待传 {m.to_upload} · 上传中 {m.uploading} · 缓存 {m.cache_total_display || formatBytes(m.cache_total_bytes)}
                  </div>
                  {m.last_cleaned_at && <div className="text-xs">队列快照 {m.last_cleaned_at}</div>}
                </div>
              </div>

              {(m.transfer_percent != null || m.active) && (
                <div className="mb-4">
                  <div className="mb-1 flex justify-between text-xs text-slate-500">
                    <span>
                      {m.transfer_bytes != null
                        ? `${formatBytes(m.transfer_bytes)}${m.transfer_total_bytes ? ` / ${formatBytes(m.transfer_total_bytes)}` : ""}`
                        : m.active
                          ? "VFS 回写进行中"
                          : "已完成"}
                    </span>
                    <span>
                      {m.transfer_speed_bps != null && `${formatSpeed(m.transfer_speed_bps)} · `}
                      {m.transfer_eta ? `ETA ${m.transfer_eta}` : m.transfer_percent != null ? `${m.transfer_percent}%` : ""}
                    </span>
                  </div>
                  <ProgressBar
                    value={pct}
                    color={m.active ? "bg-sky-500" : "bg-emerald-500"}
                  />
                </div>
              )}

              {m.note && (
                <div className="mb-3">
                  <Alert type="warning">{m.note}</Alert>
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-400 dark:bg-slate-900/50">
                    <tr>
                      <th className="px-3 py-2 font-medium">时间</th>
                      <th className="px-3 py-2 font-medium">状态</th>
                      <th className="px-3 py-2 font-medium">文件</th>
                      <th className="px-3 py-2 font-medium">详情</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(m.recent_events || []).length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                          暂无最近上传事件（MoviePilot 入库后会在这里显示排队/成功）
                        </td>
                      </tr>
                    )}
                    {(m.recent_events || []).map((ev, i) => {
                      const meta = eventMeta[ev.event] || eventMeta.stats;
                      const Icon = meta.icon;
                      return (
                        <tr key={`${ev.path}-${i}`} className="hover:bg-slate-50/80 dark:hover:bg-slate-900/40">
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">
                            {ev.time ? ev.time.replace("T", " ").replace("+00:00", "") : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <span className={clsx("inline-flex items-center gap-1 text-xs font-medium", meta.color)}>
                              <Icon size={14} />
                              {meta.label}
                            </span>
                          </td>
                          <td className="max-w-md truncate px-3 py-2 font-mono text-xs" title={ev.path}>
                            {ev.path}
                          </td>
                          <td className="max-w-xs truncate px-3 py-2 text-xs text-slate-500" title={ev.message}>
                            {ev.message}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 card text-sm text-slate-500">
        <div className="mb-2 font-medium text-slate-700 dark:text-slate-200">说明（与 MP 联用）</div>
        <ul className="list-inside list-disc space-y-1">
          <li>MoviePilot 整理后写入挂载目录时，先落盘到本地 VFS 缓存，再由 rclone 回写到 Google Drive。</li>
          <li>「排队中 / 上传中」是正常过程，不是错误；传完后会变为「成功」。真正失败才会显示红色「失败」。</li>
          <li>本地 copy/move 完成 ≠ 云端已传完；以本页「待传 / 上传中 = 0」且视频为「成功」为准。</li>
          <li>若 Dashboard 瞬时没看到上行流量，可能是写缓存阶段，或上传已在几十秒内完成（带宽较高时常见）。</li>
          <li>每个文件只显示最终状态（已成功的不会再显示旧的排队）。</li>
        </ul>
      </div>
    </div>
  );
}
