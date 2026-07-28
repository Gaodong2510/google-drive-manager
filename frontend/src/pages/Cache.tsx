import { useEffect, useState } from "react";
import { Database, HardDrive, RefreshCw, Trash2 } from "lucide-react";
import { api, formatBytes } from "../lib/api";
import { Alert, Loading, PageHeader, ProgressBar } from "../components/ui";
import clsx from "clsx";

type CacheInfo = {
  cache_root: string;
  total_size_bytes: number;
  file_count: number;
  mounts: { id: number; name: string; cache_dir: string; size_bytes: number }[];
  disk_percent: number;
  disk_free: number;
  disk_total: number;
  warnings: string[];
};

export default function CachePage() {
  const [data, setData] = useState<CacheInfo | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setData(await api.get<CacheInfo>("/cache"));
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

  const clear = async () => {
    if (!confirm("清理全部 VFS 缓存？运行中的挂载建议先停止或接受短暂卡顿。")) return;
    try {
      const res = await api.post<{ message: string; detail: any }>("/cache/clear");
      setMsg(`${res.message}：释放 ${formatBytes(res.detail?.freed_bytes)}`);
      await load();
    } catch (e: any) {
      setError(e.detail || e.message);
    }
  };

  if (loading) return <Loading />;
  if (!data) return <Alert type="error">{error || "加载失败"}</Alert>;

  const diskColor =
    data.disk_percent >= 90 ? "bg-rose-500" : data.disk_percent >= 80 ? "bg-amber-500" : "bg-emerald-500";
  const maxMount = Math.max(1, ...data.mounts.map((m) => m.size_bytes || 0));

  return (
    <div>
      <PageHeader
        title="缓存管理"
        desc="rclone VFS Cache · 避免占满系统盘影响 Emby / Plex"
        actions={
          <>
            <button className="btn-secondary" onClick={load}>
              <RefreshCw size={16} /> 刷新
            </button>
            <button className="btn-danger" onClick={clear}>
              <Trash2 size={16} /> 清理缓存
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
      {data.warnings.map((w, i) => (
        <div key={i} className="mb-2">
          <Alert type={data.disk_percent >= 90 ? "error" : "warning"}>{w}</Alert>
        </div>
      ))}

      <div className="card !p-0 overflow-hidden">
        {/* Summary strip */}
        <div className="grid divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-slate-800">
          <div className="px-5 py-4">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-500">
              <Database size={14} />
              缓存总用量
            </div>
            <div className="text-2xl font-bold tracking-tight">{formatBytes(data.total_size_bytes)}</div>
            <div className="mt-1 text-xs text-slate-400">{data.file_count.toLocaleString()} 个文件</div>
          </div>
          <div className="px-5 py-4">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-500">
              <HardDrive size={14} />
              系统磁盘
            </div>
            <div className="text-2xl font-bold tracking-tight">{data.disk_percent.toFixed(1)}%</div>
            <div className="mt-2">
              <ProgressBar value={data.disk_percent} color={diskColor} />
            </div>
            <div className="mt-1.5 text-xs text-slate-400">
              剩余 {formatBytes(data.disk_free)} / 共 {formatBytes(data.disk_total)}
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="mb-1 text-xs font-medium text-slate-500">缓存根目录</div>
            <div className="mt-1 break-all font-mono text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {data.cache_root}
            </div>
            <div className="mt-2 text-xs text-slate-400">{data.mounts.length} 个挂载缓存目录</div>
          </div>
        </div>

        {/* Mount breakdown */}
        <div className="border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between px-5 py-3">
            <h3 className="text-sm font-semibold">各挂载缓存</h3>
            <span className="text-xs text-slate-400">相对占比</span>
          </div>
          {data.mounts.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-slate-500">暂无挂载</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.mounts.map((m) => {
                const pct = Math.round(((m.size_bytes || 0) / maxMount) * 100);
                const share =
                  data.total_size_bytes > 0
                    ? (((m.size_bytes || 0) / data.total_size_bytes) * 100).toFixed(1)
                    : "0";
                return (
                  <div key={m.id} className="px-5 py-3.5 transition hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{m.name}</div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-slate-400" title={m.cache_dir}>
                          {m.cache_dir}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold tabular-nums">{formatBytes(m.size_bytes)}</div>
                        <div className="text-[11px] text-slate-400">占缓存 {share}%</div>
                      </div>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={clsx(
                          "h-full rounded-full transition-all",
                          pct > 80 ? "bg-amber-500" : "bg-brand-500"
                        )}
                        style={{ width: `${Math.max(pct, m.size_bytes ? 4 : 0)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
