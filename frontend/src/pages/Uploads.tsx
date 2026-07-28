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
  FileVideo,
} from "lucide-react";
import { api, formatBytes, formatSpeed } from "../lib/api";
import type { UploadStatus } from "../lib/types";
import { Alert, Empty, Loading, PageHeader, ProgressBar, StatusBadge } from "../components/ui";
import clsx from "clsx";

const eventMeta: Record<string, { label: string; color: string; bg: string; icon: typeof CheckCircle2 }> = {
  success: {
    label: "成功",
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    icon: CheckCircle2,
  },
  copied: {
    label: "已同步",
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    icon: CheckCircle2,
  },
  queued: {
    label: "排队中",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    icon: Clock,
  },
  uploading: {
    label: "上传中",
    color: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-50 dark:bg-sky-950/40",
    icon: CloudUpload,
  },
  failed: {
    label: "失败",
    color: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-50 dark:bg-rose-950/40",
    icon: XCircle,
  },
  stats: {
    label: "统计",
    color: "text-slate-500",
    bg: "bg-slate-100 dark:bg-slate-800",
    icon: Activity,
  },
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
        desc="MoviePilot 写入后，rclone VFS 回写到云盘的实时队列与明细"
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

      {/* 汇总一栏 */}
      <div className="card mb-4 !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CloudUpload size={16} className="text-sky-500" />
            全局上传状态
          </div>
          <span
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              active
                ? "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"
                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
            )}
          >
            {active ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            {active ? "进行中" : "空闲"}
          </span>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-4 sm:divide-y-0 dark:divide-slate-800">
          <div className="px-4 py-4 sm:px-5">
            <div className="text-xs font-medium text-slate-500">状态</div>
            <div
              className={clsx(
                "mt-1 text-xl font-bold tracking-tight",
                active ? "text-sky-600" : "text-emerald-600"
              )}
            >
              {active ? "进行中" : "空闲"}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              {active ? "有文件排队或上传" : "队列已清空"}
            </div>
          </div>
          <div className="px-4 py-4 sm:px-5">
            <div className="flex items-center gap-1 text-xs font-medium text-slate-500">
              <ArrowUpCircle size={12} /> 排队 / 上传中
            </div>
            <div className="mt-1 text-xl font-bold tracking-tight tabular-nums">
              {summary?.to_upload ?? 0}
              <span className="mx-1 text-slate-300 dark:text-slate-600">/</span>
              {summary?.uploading ?? 0}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">VFS to_upload · uploading</div>
          </div>
          <div className="px-4 py-4 sm:px-5">
            <div className="flex items-center gap-1 text-xs font-medium text-slate-500">
              <CloudUpload size={12} /> 当前速度
            </div>
            <div className="mt-1 text-xl font-bold tracking-tight">
              {formatSpeed(summary?.total_speed_bps ?? 0)}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">RC 更准确</div>
          </div>
          <div className="px-4 py-4 sm:px-5">
            <div className="flex items-center gap-1 text-xs font-medium text-slate-500">
              <XCircle size={12} /> 错误数
            </div>
            <div
              className={clsx(
                "mt-1 text-xl font-bold tracking-tight tabular-nums",
                (summary?.errors ?? 0) > 0 ? "text-rose-600" : ""
              )}
            >
              {summary?.errors ?? 0}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              活跃挂载 {summary?.active_mounts ?? 0}
            </div>
          </div>
        </div>
      </div>

      {!mounts.length && <Empty title="暂无挂载" desc="请先在挂载管理中创建并启动云盘挂载" />}

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
          const events = m.recent_events || [];
          return (
            <div key={m.mount_id} className="card !p-0 overflow-hidden">
              {/* Header */}
              <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold tracking-tight">{m.mount_name}</h3>
                    <StatusBadge status={m.status} />
                    {m.active && (
                      <span className="badge bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
                        上传中
                      </span>
                    )}
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-slate-500">{m.local_path}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-400">
                    {m.rc_enabled ? (
                      <span className="text-emerald-600">RC :{m.rc_port}</span>
                    ) : (
                      <span className="text-amber-600">日志模式</span>
                    )}
                    <span>· 源 {m.source}</span>
                    <span>
                      · 对象 {m.objects} · 使用中 {m.in_use}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 text-xs">
                  <span className="rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/60">
                    待传 <strong className="text-slate-800 dark:text-slate-100">{m.to_upload}</strong>
                  </span>
                  <span className="rounded-lg bg-sky-50 px-2.5 py-1.5 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
                    上传中 <strong>{m.uploading}</strong>
                  </span>
                  <span className="rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/60">
                    缓存 <strong>{m.cache_total_display || formatBytes(m.cache_total_bytes)}</strong>
                  </span>
                </div>
              </div>

              {/* Progress */}
              {(m.transfer_percent != null || m.active) && (
                <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">
                  <div className="mb-1.5 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                    <span>
                      {m.transfer_bytes != null
                        ? `${formatBytes(m.transfer_bytes)}${m.transfer_total_bytes ? ` / ${formatBytes(m.transfer_total_bytes)}` : ""}`
                        : m.active
                          ? "VFS 回写进行中"
                          : "已完成"}
                    </span>
                    <span className="font-medium text-slate-600 dark:text-slate-300">
                      {m.transfer_speed_bps != null && `${formatSpeed(m.transfer_speed_bps)} · `}
                      {m.transfer_eta
                        ? `ETA ${m.transfer_eta}`
                        : m.transfer_percent != null
                          ? `${m.transfer_percent}%`
                          : ""}
                    </span>
                  </div>
                  <ProgressBar value={pct} color={m.active ? "bg-sky-500" : "bg-emerald-500"} />
                </div>
              )}

              {m.note && (
                <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">
                  <Alert type="warning">{m.note}</Alert>
                </div>
              )}

              {/* Events timeline */}
              <div className="px-5 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-semibold">最近上传事件</div>
                  <span className="text-[11px] text-slate-400">{events.length} 条</span>
                </div>
                {events.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-10 text-center dark:border-slate-700">
                    <FileVideo size={28} className="mb-2 text-slate-300 dark:text-slate-600" />
                    <p className="text-sm text-slate-500">暂无上传事件</p>
                    <p className="mt-1 text-xs text-slate-400">MoviePilot 入库后会显示排队 / 成功</p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {events.map((ev, i) => {
                      const meta = eventMeta[ev.event] || eventMeta.stats;
                      const Icon = meta.icon;
                      const name = ev.path?.split("/").pop() || ev.path || "—";
                      return (
                        <li
                          key={`${ev.path}-${i}`}
                          className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:bg-slate-800/40"
                        >
                          <div
                            className={clsx(
                              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                              meta.bg,
                              meta.color
                            )}
                          >
                            <Icon size={15} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={clsx("text-xs font-semibold", meta.color)}>{meta.label}</span>
                              <span className="text-[11px] text-slate-400">
                                {ev.time ? ev.time.replace("T", " ").replace("+00:00", "") : "—"}
                              </span>
                              {ev.size_bytes != null && (
                                <span className="text-[11px] text-slate-400">{formatBytes(ev.size_bytes)}</span>
                              )}
                            </div>
                            <div className="mt-0.5 truncate text-sm font-medium text-slate-700 dark:text-slate-200" title={ev.path}>
                              {name}
                            </div>
                            {ev.message && (
                              <div className="mt-0.5 truncate text-xs text-slate-500" title={ev.message}>
                                {ev.message}
                              </div>
                            )}
                            {ev.path && name !== ev.path && (
                              <div className="mt-0.5 truncate font-mono text-[10px] text-slate-400" title={ev.path}>
                                {ev.path}
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card mt-4 text-sm text-slate-500">
        <div className="mb-2 font-medium text-slate-700 dark:text-slate-200">说明（与 MoviePilot 联用）</div>
        <ul className="list-inside list-disc space-y-1 text-xs sm:text-sm">
          <li>整理后写入挂载目录时，先落盘 VFS 缓存，再由 rclone 回写云盘。</li>
          <li>「排队 / 上传中」是正常过程；真正失败才显示红色「失败」。</li>
          <li>本地 copy 完成 ≠ 云端传完；以待传/上传中为 0 且事件为「成功」为准。</li>
        </ul>
      </div>
    </div>
  );
}
