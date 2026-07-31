import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpCircle,
  CheckCircle2,
  CloudUpload,
  Copy,
  Loader2,
  RefreshCw,
  XCircle,
  Clock,
  Activity,
  FileVideo,
  Ban,
} from "lucide-react";
import { api, formatBytes, formatSpeed } from "../lib/api";
import type { MountUpload, TransferJob, UploadEvent, UploadStatus } from "../lib/types";
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
  copying: {
    label: "复制中",
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-50 dark:bg-violet-950/40",
    icon: Copy,
  },
  copy_success: {
    label: "复制完成",
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    icon: CheckCircle2,
  },
  copy_failed: {
    label: "复制失败",
    color: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-50 dark:bg-rose-950/40",
    icon: XCircle,
  },
  copy_cancelled: {
    label: "已取消",
    color: "text-slate-500 dark:text-slate-400",
    bg: "bg-slate-100 dark:bg-slate-800",
    icon: Ban,
  },
};

function jobStatusLabel(status: string) {
  switch (status) {
    case "pending":
      return "排队";
    case "running":
      return "进行中";
    case "success":
      return "完成";
    case "error":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

function formatEventTime(t?: string | null) {
  if (!t) return "—";
  return t.replace("T", " ").replace("+00:00", "").replace(/\.\d+/, "").slice(0, 19);
}

function basename(p?: string | null) {
  if (!p) return "—";
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

type TimelineItem = UploadEvent & { mount_name?: string; mount_id?: number };

function pickPrimaryMount(mounts: MountUpload[]): MountUpload | null {
  if (!mounts.length) return null;
  const active = mounts.filter((m) => m.active);
  if (active.length) {
    // Prefer the one with highest speed / queue activity
    return [...active].sort((a, b) => {
      const sa = (a.transfer_speed_bps || 0) + (a.to_upload + a.uploading) * 1e6;
      const sb = (b.transfer_speed_bps || 0) + (b.to_upload + b.uploading) * 1e6;
      return sb - sa;
    })[0];
  }
  const running = mounts.find((m) => m.status === "running");
  return running || mounts[0];
}

export default function UploadsPage() {
  const [data, setData] = useState<UploadStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

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

  const cancelJob = async (jobId: string) => {
    setCancelling(jobId);
    try {
      await api.post(`/files/copy/${jobId}/cancel`);
      await load();
    } catch (e: any) {
      setError(e.detail || e.message);
    } finally {
      setCancelling(null);
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

  const summary = data?.summary;
  const mounts = data?.mounts || [];
  const copyJobs = data?.copy_jobs || [];
  const activeCopyJobs = copyJobs.filter((j) => j.status === "pending" || j.status === "running");
  const recentCopyJobs = copyJobs.slice(0, 12);
  const active = summary?.any_active;
  const copyActive = summary?.copy_active ?? activeCopyJobs.length;

  const primary = useMemo(() => pickPrimaryMount(mounts), [mounts]);

  const timeline = useMemo(() => {
    const items: TimelineItem[] = [];
    for (const m of mounts) {
      for (const ev of m.recent_events || []) {
        items.push({ ...ev, mount_name: m.mount_name, mount_id: m.mount_id });
      }
    }
    // de-dupe by job_id+event+path+time
    const seen = new Set<string>();
    const uniq: TimelineItem[] = [];
    for (const ev of items) {
      const key = `${ev.job_id || ""}|${ev.event}|${ev.path}|${ev.time || ""}|${ev.message || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(ev);
    }
    uniq.sort((a, b) => {
      const ta = a.time || "";
      const tb = b.time || "";
      return tb.localeCompare(ta);
    });
    return uniq.slice(0, 60);
  }, [mounts]);

  if (loading && !data) return <Loading label="加载上传进度..." />;

  const pct =
    primary?.transfer_percent != null
      ? primary.transfer_percent
      : primary && primary.to_upload + primary.uploading > 0
        ? Math.max(5, 100 - (primary.to_upload + primary.uploading) * 5)
        : primary?.active
          ? 50
          : 100;

  return (
    <div>
      <PageHeader
        title="上传进度"
        desc="VFS 回写与跨盘复制 · 全局汇总 + 统一事件流"
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
            全局传输状态
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
        <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-5 sm:divide-y-0 dark:divide-slate-800">
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
              {active ? "上传或复制进行中" : "队列已清空"}
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
              <Copy size={12} /> 跨盘复制
            </div>
            <div className="mt-1 text-xl font-bold tracking-tight tabular-nums text-violet-600 dark:text-violet-400">
              {copyActive}
              <span className="mx-1 text-sm font-normal text-slate-400">
                / {summary?.copy_total ?? copyJobs.length}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-slate-400">进行中 / 最近任务</div>
          </div>
          <div className="px-4 py-4 sm:px-5">
            <div className="flex items-center gap-1 text-xs font-medium text-slate-500">
              <CloudUpload size={12} /> 当前速度
            </div>
            <div className="mt-1 text-xl font-bold tracking-tight">
              {formatSpeed(summary?.total_speed_bps ?? 0)}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">VFS RC 上传速度</div>
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

      {/* 单一进度盘（当前最活跃挂载） */}
      {primary ? (
        <div className="card mb-4 !p-0 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold tracking-tight">{primary.mount_name}</h3>
                <StatusBadge status={primary.status} />
                {primary.active && (
                  <span className="badge bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
                    传输中
                  </span>
                )}
                {mounts.length > 1 && (
                  <span className="text-[11px] text-slate-400">
                    当前聚焦 · 共 {mounts.length} 个挂载
                  </span>
                )}
              </div>
              <div className="mt-1 truncate font-mono text-xs text-slate-500">{primary.local_path}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-400">
                {primary.rc_enabled ? (
                  <span className="text-emerald-600">RC :{primary.rc_port}</span>
                ) : (
                  <span className="text-amber-600">日志模式</span>
                )}
                <span>· 源 {primary.source}</span>
                <span>
                  · 对象 {primary.objects} · 使用中 {primary.in_use}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 text-xs">
              <span className="rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/60">
                待传 <strong className="text-slate-800 dark:text-slate-100">{primary.to_upload}</strong>
              </span>
              <span className="rounded-lg bg-sky-50 px-2.5 py-1.5 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
                上传中 <strong>{primary.uploading}</strong>
              </span>
              <span className="rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/60">
                缓存 <strong>{primary.cache_total_display || formatBytes(primary.cache_total_bytes)}</strong>
              </span>
            </div>
          </div>

          {(primary.transfer_percent != null || primary.active) && (
            <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">
              <div className="mb-1.5 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                <span>
                  {primary.transfer_bytes != null
                    ? `${formatBytes(primary.transfer_bytes)}${primary.transfer_total_bytes ? ` / ${formatBytes(primary.transfer_total_bytes)}` : ""}`
                    : primary.active
                      ? "VFS 回写 / 复制进行中"
                      : "已完成"}
                </span>
                <span className="font-medium text-slate-600 dark:text-slate-300">
                  {primary.transfer_speed_bps != null && `${formatSpeed(primary.transfer_speed_bps)} · `}
                  {primary.transfer_eta
                    ? `ETA ${primary.transfer_eta}`
                    : primary.transfer_percent != null
                      ? `${primary.transfer_percent}%`
                      : ""}
                </span>
              </div>
              <ProgressBar value={pct} color={primary.active ? "bg-sky-500" : "bg-emerald-500"} />
            </div>
          )}

          {primary.note && (
            <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">
              <Alert type="warning">{primary.note}</Alert>
            </div>
          )}
        </div>
      ) : (
        <Empty title="暂无挂载" desc="请先在挂载管理中创建并启动云盘挂载" />
      )}

      {/* 跨盘复制任务 */}
      {recentCopyJobs.length > 0 && (
        <div className="card mb-4 !p-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Copy size={16} className="text-violet-500" />
              跨盘复制任务
            </div>
            <span className="text-[11px] text-slate-400">
              {copyActive > 0 ? `${copyActive} 进行中 · ` : ""}
              共 {recentCopyJobs.length} 条
            </span>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {recentCopyJobs.map((job: TransferJob) => {
              const running = job.status === "pending" || job.status === "running";
              const srcName = basename(job.current_src || job.src_paths?.[0]);
              return (
                <li key={job.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={clsx(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            running && "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
                            job.status === "success" &&
                              "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
                            job.status === "error" &&
                              "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
                            job.status === "cancelled" && "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          )}
                        >
                          {running && <Loader2 size={10} className="animate-spin" />}
                          {jobStatusLabel(job.status)}
                        </span>
                        <span
                          className="truncate text-sm font-medium text-slate-800 dark:text-slate-100"
                          title={job.current_src || job.src_paths?.join(", ")}
                        >
                          {srcName}
                          {job.items_total > 1 ? (
                            <span className="ml-1 text-xs font-normal text-slate-400">
                              ({job.items_done}/{job.items_total})
                            </span>
                          ) : null}
                        </span>
                        <span className="text-[11px] text-slate-400">{job.mode === "local" ? "本地" : "rclone"}</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500" title={job.dest_dir}>
                        → {job.dest_dir}
                      </div>
                      {job.message && (
                        <div className="mt-0.5 truncate text-xs text-slate-500" title={job.message}>
                          {job.message}
                        </div>
                      )}
                      {job.error && job.status === "error" && (
                        <div className="mt-0.5 truncate text-xs text-rose-600" title={job.error}>
                          {job.error}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                        {job.percent?.toFixed?.(0) ?? 0}%
                      </span>
                      {running && (
                        <button
                          type="button"
                          className="btn-secondary !px-2 !py-1 text-xs"
                          disabled={cancelling === job.id}
                          onClick={() => cancelJob(job.id)}
                        >
                          {cancelling === job.id ? "取消中…" : "取消"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-2">
                    <div className="mb-1 flex flex-wrap justify-between gap-2 text-[11px] text-slate-400">
                      <span>
                        {job.transferred && job.total
                          ? `${job.transferred} / ${job.total}`
                          : (job.files_total ?? 0) > 0
                            ? `${job.files_total} 个文件 · 共 ${formatBytes(job.size_bytes || 0)}`
                            : running
                              ? "复制中…"
                              : jobStatusLabel(job.status)}
                      </span>
                      <span>
                        {job.speed ? `${job.speed}` : ""}
                        {job.speed && job.eta ? " · " : ""}
                        {job.eta ? `ETA ${job.eta}` : ""}
                      </span>
                    </div>
                    <ProgressBar
                      value={job.percent ?? 0}
                      color={
                        job.status === "error"
                          ? "bg-rose-500"
                          : job.status === "success"
                            ? "bg-emerald-500"
                            : "bg-violet-500"
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 统一最近事件（所有挂载合并） */}
      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <div className="text-sm font-semibold">最近事件</div>
          <span className="text-[11px] text-slate-400">{timeline.length} 条 · 全挂载合并</span>
        </div>
        <div className="px-5 py-4">
          {timeline.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-10 text-center dark:border-slate-700">
              <FileVideo size={28} className="mb-2 text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-slate-500">暂无事件</p>
              <p className="mt-1 text-xs text-slate-400">VFS 回写或跨盘复制会出现在这里</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {timeline.map((ev, i) => {
                const meta = eventMeta[ev.event] || eventMeta.stats;
                const Icon = meta.icon;
                const name = basename(ev.path);
                const isCopy =
                  ev.source === "copy" || (ev.event || "").startsWith("copy") || ev.event === "copying";
                return (
                  <li
                    key={`${ev.job_id || ev.path}-${ev.event}-${ev.time || ""}-${i}`}
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
                        {isCopy && (
                          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                            复制
                          </span>
                        )}
                        {ev.mount_name && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {ev.mount_name}
                          </span>
                        )}
                        <span className="text-[11px] text-slate-400">{formatEventTime(ev.time)}</span>
                        {ev.size_bytes != null && (
                          <span className="text-[11px] text-slate-400">{formatBytes(ev.size_bytes)}</span>
                        )}
                        {ev.percent != null && (
                          <span className="text-[11px] font-medium tabular-nums text-violet-600 dark:text-violet-400">
                            {ev.percent.toFixed(0)}%
                          </span>
                        )}
                        {ev.speed && <span className="text-[11px] text-slate-400">{ev.speed}</span>}
                        {ev.eta && <span className="text-[11px] text-slate-400">ETA {ev.eta}</span>}
                      </div>
                      <div
                        className="mt-0.5 truncate text-sm font-medium text-slate-700 dark:text-slate-200"
                        title={ev.path}
                      >
                        {name}
                      </div>
                      {ev.message && (
                        <div className="mt-0.5 truncate text-xs text-slate-500" title={ev.message}>
                          {ev.message}
                        </div>
                      )}
                      {isCopy && ev.percent != null && (ev.event === "copying" || Number(ev.percent) < 100) && (
                        <div className="mt-1.5 max-w-md">
                          <ProgressBar
                            value={ev.percent}
                            color={ev.event === "copy_failed" ? "bg-rose-500" : "bg-violet-500"}
                          />
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

      <div className="card mt-4 text-sm text-slate-500">
        <div className="mb-2 font-medium text-slate-700 dark:text-slate-200">说明</div>
        <ul className="list-inside list-disc space-y-1 text-xs sm:text-sm">
          <li>MoviePilot 写入挂载目录时，先落盘 VFS 缓存，再由 rclone 回写云盘（排队 / 上传中）。</li>
          <li>上方只展示当前最活跃的一个挂载进度；所有挂载的最近事件合并在下方统一时间线。</li>
          <li>「文件」页跨盘复制会进入「跨盘复制任务」，并写入最近事件。</li>
          <li>本地 copy 完成 ≠ 云端传完；以待传/上传中为 0 且事件为「成功」为准。</li>
        </ul>
      </div>
    </div>
  );
}
