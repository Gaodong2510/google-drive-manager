import { useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import type { TaskLog } from "../lib/types";
import { Alert, Loading, PageHeader, StatusBadge } from "../components/ui";

export default function TasksPage() {
  const [list, setList] = useState<TaskLog[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (q) params.set("q", q);
      if (type) params.set("task_type", type);
      setList(await api.get<TaskLog[]>(`/tasks?${params}`));
      setError("");
    } catch (e: any) {
      setError(e.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const clear = async () => {
    if (!confirm("清空全部任务日志？")) return;
    await api.delete("/tasks");
    await load();
  };

  const statusMap = (s: string) => {
    if (s === "success") return "connected";
    if (s === "error") return "error";
    if (s === "warning") return "starting";
    return "stopped";
  };

  return (
    <div>
      <PageHeader
        title="任务与日志"
        desc="启动 / 停止 / Watchdog / OAuth 等操作记录"
        actions={
          <>
            <button className="btn-secondary" onClick={load}>
              <RefreshCw size={16} /> 刷新
            </button>
            <button className="btn-danger" onClick={clear}>
              <Trash2 size={16} /> 清空
            </button>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input className="input" placeholder="搜索消息..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        <select className="input sm:w-48" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">全部类型</option>
          {["start", "stop", "restart", "watchdog", "oauth", "system"].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button className="btn-primary" onClick={load}>
          查询
        </button>
      </div>
      {error && (
        <div className="mb-4">
          <Alert type="error">{error}</Alert>
        </div>
      )}
      {loading ? (
        <Loading />
      ) : (
        <div className="card !p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-400 dark:bg-slate-950">
                <tr>
                  <th className="px-4 py-2 text-left">时间</th>
                  <th className="px-4 py-2 text-left">类型</th>
                  <th className="px-4 py-2 text-left">状态</th>
                  <th className="px-4 py-2 text-left">消息</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {list.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">
                      {new Date(t.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{t.task_type}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={statusMap(t.status)} />
                    </td>
                    <td className="px-4 py-2">
                      <div>{t.message}</div>
                      {t.detail && <div className="mt-1 text-xs text-slate-400 line-clamp-2">{t.detail}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.length === 0 && <div className="py-12 text-center text-sm text-slate-500">暂无记录</div>}
        </div>
      )}
    </div>
  );
}
