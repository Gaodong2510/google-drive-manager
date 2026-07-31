import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  CloudUpload,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { api, formatBytes, formatDuration, formatSpeed } from "../lib/api";
import type { Dashboard, Traffic, UploadStatus } from "../lib/types";
import { Alert, Loading, PageHeader, ProgressBar, StatusBadge } from "../components/ui";
import { GoogleDriveIcon, ProviderMark } from "../components/BrandIcons";
import clsx from "clsx";

function formatResetCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分`;
  return `${s} 秒`;
}

function barColor(pct: number, kind: "default" | "disk" = "default") {
  if (pct >= 90) return "bg-rose-500";
  if (pct >= 80) return "bg-amber-500";
  return kind === "disk" ? "bg-emerald-500" : "bg-brand-500";
}

function MetricCell({
  icon,
  label,
  value,
  sub,
  bar,
  barClass,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  bar?: number;
  barClass?: string;
  className?: string;
}) {
  return (
    <div className={clsx("min-w-0 px-4 py-3 sm:px-5 sm:py-4", className)}>
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {icon}
        </span>
        {label}
      </div>
      <div className="text-xl font-bold tracking-tight sm:text-2xl">{value}</div>
      {sub && <div className="mt-1 text-[11px] leading-snug text-slate-500 sm:text-xs">{sub}</div>}
      {bar != null && (
        <div className="mt-2.5">
          <ProgressBar value={bar} color={barClass} />
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [uploads, setUploads] = useState<UploadStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [trafficMsg, setTrafficMsg] = useState("");

  const load = async () => {
    try {
      const [d, u] = await Promise.all([
        api.get<Dashboard>("/dashboard"),
        api.get<UploadStatus>("/uploads/status").catch(() => null),
      ]);
      setData(d);
      setUploads(u);
      setError("");
    } catch (e: any) {
      setError(e.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  const resetTraffic = async (mountId?: number) => {
    const label = mountId != null ? "该挂载今日上传流量" : "全部今日上传流量";
    if (!confirm(`确认将${label}清零？\n仅影响云桥本地统计与 rclone 会话累计显示。`)) {
      return;
    }
    setResetting(true);
    setTrafficMsg("");
    try {
      const q = mountId != null ? `?mount_id=${mountId}` : "";
      const t = await api.post<Traffic>(`/traffic/reset${q}`);
      setData((prev) => (prev ? { ...prev, traffic: t } : prev));
      setTrafficMsg("今日上传流量已清零");
    } catch (e: any) {
      setError(e.detail || e.message);
    } finally {
      setResetting(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (loading && !data) return <Loading />;
  if (!data) return <Alert type="error">{error || "无法加载"}</Alert>;

  const s = data.system;
  const traffic = data.traffic;

  return (
    <div>
      <PageHeader
        title="总览"
        desc="服务器资源与云盘挂载实时状态"
        actions={
          <button className="btn-secondary" onClick={load}>
            <RefreshCw size={16} /> 刷新
          </button>
        }
      />

      {data.disk_warnings?.length > 0 && (
        <div className="mb-4 space-y-2">
          {data.disk_warnings.map((w, i) => (
            <Alert key={i} type={w.level === "critical" ? "error" : "warning"}>
              {w.message}
            </Alert>
          ))}
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Alert type="error">{error}</Alert>
        </div>
      )}

      {/* 系统资源：一栏四格 */}
      <div className="card mb-4 !p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Server size={16} className="text-brand-500" />
            系统资源
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Timer size={12} />
            运行 {formatDuration(s.uptime_seconds)}
          </div>
        </div>
        <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 dark:divide-slate-800">
          <MetricCell
            icon={<Cpu size={14} />}
            label="CPU"
            value={`${s.cpu_percent.toFixed(1)}%`}
            bar={s.cpu_percent}
            barClass={barColor(s.cpu_percent)}
            className="sm:border-r sm:border-slate-100 dark:sm:border-slate-800"
          />
          <MetricCell
            icon={<MemoryStick size={14} />}
            label="内存"
            value={`${s.memory_percent.toFixed(1)}%`}
            sub={`${formatBytes(s.memory_used)} / ${formatBytes(s.memory_total)}`}
            bar={s.memory_percent}
            barClass={barColor(s.memory_percent)}
            className="lg:border-r lg:border-slate-100 dark:lg:border-slate-800"
          />
          <MetricCell
            icon={<HardDrive size={14} />}
            label="磁盘"
            value={`${s.disk_percent.toFixed(1)}%`}
            sub={`${formatBytes(s.disk_used)} / ${formatBytes(s.disk_total)}`}
            bar={s.disk_percent}
            barClass={barColor(s.disk_percent, "disk")}
            className="sm:border-r sm:border-slate-100 dark:sm:border-slate-800"
          />
          <MetricCell
            icon={<Network size={14} />}
            label="网络"
            value={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base sm:text-lg">
                <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                  <ArrowUp size={14} />
                  {formatSpeed(s.net_upload_speed)}
                </span>
                <span className="inline-flex items-center gap-0.5 text-sky-600 dark:text-sky-400">
                  <ArrowDown size={14} />
                  {formatSpeed(s.net_download_speed)}
                </span>
              </span>
            }
            sub="实时上下行速率"
          />
        </div>
      </div>

      {/* 本地日流量（北京时间 0 点重置） */}
      {traffic && (
        <div className="card mb-4 !p-0 overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Gauge size={16} className="text-violet-500" />
              今日上传流量
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                北京时间 · {traffic.day}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Timer size={12} />
                {formatResetCountdown(traffic.seconds_until_reset)} 后重置
              </span>
              <button
                type="button"
                className="btn-ghost !px-2 !py-1 text-xs text-slate-600"
                disabled={resetting}
                onClick={() => resetTraffic()}
                title="手动清零今日本地上传统计"
              >
                <RotateCcw size={12} /> 清零今日
              </button>
            </div>
          </div>
          <div className="grid gap-0 sm:grid-cols-3">
            <div className="border-b border-slate-100 px-5 py-4 sm:border-b-0 sm:border-r dark:border-slate-800">
              <div className="text-xs font-medium text-slate-500">今日上传累计（本地）</div>
              <div className="mt-1 text-2xl font-bold tracking-tight text-violet-600 dark:text-violet-400">
                {formatBytes(traffic.today_bytes)}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                采样增量合计 · 每天 00:00 自动换日
              </div>
            </div>
            <div className="border-b border-slate-100 px-5 py-4 sm:border-b-0 sm:border-r dark:border-slate-800">
              <div className="text-xs font-medium text-slate-500">rclone 会话累计</div>
              <div className="mt-1 text-2xl font-bold tracking-tight">
                {formatBytes(traffic.session_bytes)}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                进程启动以来 · 重启挂载才归零
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="text-xs font-medium text-slate-500">说明</div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                {traffic.note || "本地统计：按 rclone 会话传输增量累计，每天北京时间 00:00 自动换日清零。"}
              </p>
              {trafficMsg && (
                <p className="mt-2 text-[11px] font-medium text-emerald-600">{trafficMsg}</p>
              )}
            </div>
          </div>
          {traffic.mounts.length > 0 && (
            <div className="border-t border-slate-100 dark:border-slate-800">
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {traffic.mounts.map((m) => (
                  <div
                    key={m.mount_id}
                    className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{m.mount_name}</span>
                        {m.team_drive && (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                            共享盘
                          </span>
                        )}
                        <StatusBadge status={m.status} />
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        {m.account_name || "—"}
                        {!m.rc_ok && m.status === "running" ? " · RC 暂不可用" : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums">
                      <div>
                        <span className="text-slate-400">今日 </span>
                        <span className="font-semibold text-violet-600 dark:text-violet-400">
                          {formatBytes(m.today_bytes)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400">会话 </span>
                        <span className="font-medium text-slate-700 dark:text-slate-200">
                          {formatBytes(m.session_bytes)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="text-slate-400 hover:text-brand-600"
                        disabled={resetting}
                        onClick={() => resetTraffic(m.mount_id)}
                        title="清零该挂载今日上传流量"
                      >
                        清零
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 云盘 + 挂载：合并一栏 */}
      <div className="card mb-4 !p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <GoogleDriveIcon size={16} />
            云盘与挂载
          </div>
          <div className="flex gap-2">
            <Link to="/accounts" className="text-xs text-brand-600 hover:underline">
              账号
            </Link>
            <span className="text-slate-300">·</span>
            <Link to="/mounts" className="text-xs text-brand-600 hover:underline">
              挂载
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-4 sm:divide-y-0 dark:divide-slate-800">
          <Link
            to="/accounts"
            className="group px-4 py-4 transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40 sm:px-5"
          >
            <div className="text-xs font-medium text-slate-500">云盘账号</div>
            <div className="mt-1 text-2xl font-bold tracking-tight group-hover:text-brand-600">
              {data.accounts_total}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">已配置账号</div>
          </Link>
          <div className="px-4 py-4 sm:px-5">
            <div className="text-xs font-medium text-slate-500">挂载总数</div>
            <div className="mt-1 text-2xl font-bold tracking-tight">{data.mounts_total}</div>
            <div className="mt-1 text-[11px] text-slate-400">挂载点</div>
          </div>
          <div className="px-4 py-4 sm:px-5">
            <div className="text-xs font-medium text-slate-500">运行 / 异常</div>
            <div className="mt-1 text-2xl font-bold tracking-tight">
              <span className="text-emerald-600">{data.mounts_running}</span>
              <span className="mx-1 text-slate-300 dark:text-slate-600">/</span>
              <span className={data.mounts_error ? "text-rose-600" : "text-slate-400"}>
                {data.mounts_error}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-slate-400">已停止 {data.mounts_stopped}</div>
          </div>
          <Link
            to="/cache"
            className="group px-4 py-4 transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40 sm:px-5"
          >
            <div className="text-xs font-medium text-slate-500">总缓存</div>
            <div className="mt-1 text-2xl font-bold tracking-tight group-hover:text-brand-600">
              {formatBytes(data.total_cache_bytes)}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">VFS 缓存占用</div>
          </Link>
        </div>
      </div>

      {/* 上传进度条 */}
      {uploads && (
        <Link
          to="/uploads"
          className="card mb-4 block !py-3.5 transition hover:ring-2 hover:ring-brand-200 dark:hover:ring-brand-800"
        >
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CloudUpload size={16} className="text-sky-500" />
              上传进度
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              <span>
                <span className="text-slate-400">状态 </span>
                {uploads.summary.any_active ? (
                  <span className="font-medium text-sky-600">进行中</span>
                ) : (
                  <span className="font-medium text-emerald-600">空闲</span>
                )}
              </span>
              <span>
                <span className="text-slate-400">排队/上传 </span>
                <span className="font-medium">
                  {uploads.summary.to_upload}/{uploads.summary.uploading}
                </span>
              </span>
              {(uploads.summary.copy_active ?? 0) > 0 && (
                <span>
                  <span className="text-slate-400">复制 </span>
                  <span className="font-medium text-violet-600">{uploads.summary.copy_active}</span>
                </span>
              )}
              <span>
                <span className="text-slate-400">速度 </span>
                <span className="font-medium">{formatSpeed(uploads.summary.total_speed_bps)}</span>
              </span>
              <span>
                <span className="text-slate-400">错误 </span>
                <span className={clsx("font-medium", uploads.summary.errors ? "text-rose-600" : "")}>
                  {uploads.summary.errors}
                </span>
              </span>
            </div>
            <span className="ml-auto text-xs text-brand-600">详情 →</span>
          </div>
        </Link>
      )}

      {/* rclone + 挂载一览：同一大卡片 */}
      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Activity size={16} className="text-indigo-500" />
            挂载一览
          </div>

          {/* rclone 状态条 */}
          <div className="flex flex-wrap items-center gap-2">
            <div
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                data.rclone_installed
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
              )}
            >
              <span
                className={clsx(
                  "h-1.5 w-1.5 rounded-full",
                  data.rclone_installed ? "bg-emerald-500" : "bg-rose-500"
                )}
              />
              rclone {data.rclone_installed ? `v${data.rclone_version || "?"}` : "未安装"}
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <HardDrive size={12} />
              进程 {data.rclone_mount_processes}
            </div>
            <div
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                data.watchdog_running
                  ? "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"
                  : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
              )}
            >
              <ShieldCheck size={12} />
              Watchdog {data.watchdog_running ? "运行中" : "已停止"}
            </div>
            {!data.rclone_installed && (
              <Link to="/settings" className="text-xs font-medium text-brand-600 hover:underline">
                去安装
              </Link>
            )}
            <Link
              to="/mounts"
              className="ml-auto text-xs font-medium text-brand-600 hover:underline sm:ml-1"
            >
              管理挂载 →
            </Link>
          </div>
        </div>

        {data.mounts.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800">
              <HardDrive size={22} />
            </div>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">暂无挂载点</p>
            <p className="mt-1 text-xs text-slate-400">先添加云盘账号，再创建挂载</p>
            <div className="mt-4 flex justify-center gap-2">
              <Link to="/accounts" className="btn-secondary !py-1.5 text-xs">
                云盘账号
              </Link>
              <Link to="/mounts" className="btn-primary !py-1.5 text-xs">
                创建挂载
              </Link>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.mounts.map((m) => {
              return (
                <div
                  key={m.id}
                  className="flex flex-col gap-3 px-5 py-3.5 transition hover:bg-slate-50/60 dark:hover:bg-slate-800/30 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <ProviderMark provider={m.provider} size={40} className="mt-0.5" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold tracking-tight">{m.name}</span>
                        <StatusBadge status={m.status} />
                      </div>
                      <div className="mt-0.5 truncate font-mono text-xs text-slate-500" title={m.local_path}>
                        {m.local_path}
                      </div>
                      {m.account_name && (
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          {m.provider === "onedrive" ? "OneDrive" : "Google Drive"} · {m.account_name}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 pl-12 text-xs text-slate-500 sm:pl-0 sm:text-right">
                    <div>
                      <span className="text-slate-400">PID </span>
                      <span className="font-mono text-slate-700 dark:text-slate-200">{m.pid || "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">时长 </span>
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        {formatDuration(m.uptime_seconds)}
                      </span>
                    </div>
                    {m.cache_size_bytes > 0 && (
                      <div>
                        <span className="text-slate-400">缓存 </span>
                        <span className="font-medium text-slate-700 dark:text-slate-200">
                          {formatBytes(m.cache_size_bytes)}
                        </span>
                      </div>
                    )}
                    {traffic?.mounts?.find((t) => t.mount_id === m.id) && (
                      <div>
                        <span className="text-slate-400">今日上传 </span>
                        <span className="font-medium text-violet-600 dark:text-violet-400">
                          {formatBytes(
                            traffic.mounts.find((t) => t.mount_id === m.id)?.today_bytes || 0
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
