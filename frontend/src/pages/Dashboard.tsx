import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  Cloud,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  RefreshCw,
  Server,
} from "lucide-react";
import { api, formatBytes, formatDuration, formatSpeed } from "../lib/api";
import type { Dashboard } from "../lib/types";
import { Alert, Loading, PageHeader, ProgressBar, StatCard, StatusBadge } from "../components/ui";

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const d = await api.get<Dashboard>("/dashboard");
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
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (loading && !data) return <Loading />;
  if (!data) return <Alert type="error">{error || "无法加载"}</Alert>;

  const s = data.system;
  const memColor = s.memory_percent >= 90 ? "bg-rose-500" : s.memory_percent >= 80 ? "bg-amber-500" : "bg-brand-500";
  const diskColor = s.disk_percent >= 90 ? "bg-rose-500" : s.disk_percent >= 80 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div>
      <PageHeader
        title="Dashboard"
        desc="服务器与 Google Drive 挂载实时状态"
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

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="CPU" value={`${s.cpu_percent.toFixed(1)}%`} icon={<Cpu size={18} />} sub={<ProgressBar value={s.cpu_percent} />} />
        <StatCard
          title="内存"
          value={`${s.memory_percent.toFixed(1)}%`}
          icon={<MemoryStick size={18} />}
          sub={
            <>
              <ProgressBar value={s.memory_percent} color={memColor} />
              <div className="mt-1">
                {formatBytes(s.memory_used)} / {formatBytes(s.memory_total)}
              </div>
            </>
          }
        />
        <StatCard
          title="系统磁盘"
          value={`${s.disk_percent.toFixed(1)}%`}
          icon={<Server size={18} />}
          sub={
            <>
              <ProgressBar value={s.disk_percent} color={diskColor} />
              <div className="mt-1">
                {formatBytes(s.disk_used)} / {formatBytes(s.disk_total)}
              </div>
            </>
          }
        />
        <StatCard
          title="网络"
          value={
            <span className="text-lg">
              ↑ {formatSpeed(s.net_upload_speed)} · ↓ {formatSpeed(s.net_download_speed)}
            </span>
          }
          icon={<Network size={18} />}
          sub={`系统运行 ${formatDuration(s.uptime_seconds)}`}
        />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Drive 账号" value={data.accounts_total} icon={<Cloud size={18} />} accent="bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-300" />
        <StatCard title="挂载总数" value={data.mounts_total} icon={<HardDrive size={18} />} />
        <StatCard
          title="运行 / 异常"
          value={
            <span>
              <span className="text-emerald-600">{data.mounts_running}</span>
              <span className="mx-1 text-slate-300">/</span>
              <span className="text-rose-600">{data.mounts_error}</span>
            </span>
          }
          icon={<Activity size={18} />}
          sub={`已停止 ${data.mounts_stopped}`}
        />
        <StatCard title="总缓存" value={formatBytes(data.total_cache_bytes)} icon={<Server size={18} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-1">
          <h3 className="mb-4 font-semibold">rclone 状态</h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">安装状态</dt>
              <dd>{data.rclone_installed ? <StatusBadge status="connected" /> : <StatusBadge status="error" />}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">版本</dt>
              <dd className="font-mono">{data.rclone_version ? `v${data.rclone_version}` : "未安装"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">mount 进程</dt>
              <dd>{data.rclone_mount_processes}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Watchdog</dt>
              <dd>{data.watchdog_running ? <StatusBadge status="running" /> : <StatusBadge status="stopped" />}</dd>
            </div>
          </dl>
          {!data.rclone_installed && (
            <div className="mt-4">
              <Link to="/settings" className="btn-primary w-full">
                前往安装 rclone
              </Link>
            </div>
          )}
        </div>

        <div className="card lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">挂载一览</h3>
            <Link to="/mounts" className="text-sm text-brand-600 hover:underline">
              管理
            </Link>
          </div>
          {data.mounts.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">暂无挂载，请先添加账号并创建挂载点</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-400">
                  <tr>
                    <th className="pb-2 pr-3">名称</th>
                    <th className="pb-2 pr-3">状态</th>
                    <th className="pb-2 pr-3">路径</th>
                    <th className="pb-2 pr-3">PID</th>
                    <th className="pb-2">运行时长</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.mounts.map((m) => (
                    <tr key={m.id}>
                      <td className="py-2.5 pr-3 font-medium">{m.name}</td>
                      <td className="py-2.5 pr-3">
                        <StatusBadge status={m.status} />
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-xs text-slate-500">{m.local_path}</td>
                      <td className="py-2.5 pr-3 font-mono text-xs">{m.pid || "—"}</td>
                      <td className="py-2.5">{formatDuration(m.uptime_seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
