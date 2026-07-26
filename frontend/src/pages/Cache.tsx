import { useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { api, formatBytes } from "../lib/api";
import { Alert, Loading, PageHeader, ProgressBar } from "../components/ui";

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

  const diskColor = data.disk_percent >= 90 ? "bg-rose-500" : data.disk_percent >= 80 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div>
      <PageHeader
        title="缓存管理"
        desc="控制 rclone VFS Cache，避免占满系统盘导致 Emby/Plex 崩溃"
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

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="card">
          <div className="text-xs text-slate-400">缓存根目录</div>
          <div className="mt-2 break-all font-mono text-sm">{data.cache_root}</div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-400">缓存用量</div>
          <div className="mt-2 text-2xl font-semibold">{formatBytes(data.total_size_bytes)}</div>
          <div className="mt-1 text-xs text-slate-500">{data.file_count} 个文件</div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-400">磁盘使用率</div>
          <div className="mt-2 text-2xl font-semibold">{data.disk_percent.toFixed(1)}%</div>
          <div className="mt-2">
            <ProgressBar value={data.disk_percent} color={diskColor} />
          </div>
          <div className="mt-1 text-xs text-slate-500">
            剩余 {formatBytes(data.disk_free)} / 共 {formatBytes(data.disk_total)}
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="mb-4 font-semibold">各挂载缓存</h3>
        {data.mounts.length === 0 ? (
          <p className="text-sm text-slate-500">暂无挂载</p>
        ) : (
          <div className="space-y-3">
            {data.mounts.map((m) => (
              <div key={m.id} className="flex flex-col gap-1 rounded-xl border border-slate-100 p-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium">{m.name}</div>
                  <div className="font-mono text-xs text-slate-500">{m.cache_dir}</div>
                </div>
                <div className="text-sm font-semibold">{formatBytes(m.size_bytes)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
