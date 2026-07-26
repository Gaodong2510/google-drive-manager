import { useEffect, useState } from "react";
import {
  ArrowUp,
  Download,
  File,
  Folder,
  Grid3X3,
  List,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { api, formatBytes, getToken } from "../lib/api";
import type { FileEntry } from "../lib/types";
import { Alert, Empty, Loading, PageHeader } from "../components/ui";
import clsx from "clsx";

type Root = { id: number; name: string; path: string; status: string };

export default function FilesPage() {
  const [roots, setRoots] = useState<Root[]>([]);
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [sortBy, setSortBy] = useState("name");
  const [truncated, setTruncated] = useState(false);

  const loadRoots = async () => {
    const r = await api.get<Root[]>("/files/roots");
    setRoots(r);
    if (!path && r.length) setPath(r[0].path);
    if (!r.length) setLoading(false);
  };

  const browse = async (p: string) => {
    if (!p) return;
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({ path: p, sort_by: sortBy, sort_dir: "asc" });
      if (search) q.set("search", search);
      const res = await api.get<{ path: string; parent: string | null; entries: FileEntry[]; truncated: boolean }>(
        `/files/browse?${q}`
      );
      setPath(res.path);
      setParent(res.parent);
      setEntries(res.entries);
      setTruncated(res.truncated);
    } catch (e: any) {
      setError(e.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoots().catch((e) => setError(e.detail || e.message));
  }, []);

  useEffect(() => {
    if (path) browse(path);
  }, [path, sortBy]);

  const mkdir = async () => {
    const name = prompt("新文件夹名称");
    if (!name) return;
    try {
      await api.post(`/files/mkdir?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`);
      browse(path);
    } catch (e: any) {
      setError(e.detail || e.message);
    }
  };

  const remove = async (entry: FileEntry) => {
    if (!confirm(`删除 ${entry.name}？`)) return;
    try {
      await api.delete(`/files?path=${encodeURIComponent(entry.path)}`);
      browse(path);
    } catch (e: any) {
      setError(e.detail || e.message);
    }
  };

  const download = (entry: FileEntry) => {
    const token = getToken();
    const url = `/api/files/download?path=${encodeURIComponent(entry.path)}`;
    // open with token via fetch blob
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = entry.name;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((e) => setError(String(e)));
  };

  return (
    <div>
      <PageHeader
        title="文件浏览器"
        desc="直接读取服务器本地挂载目录（非 Drive API）"
        actions={
          <>
            <button className="btn-secondary" onClick={() => browse(path)}>
              <RefreshCw size={16} />
            </button>
            <button className="btn-secondary" onClick={mkdir} disabled={!path}>
              <Plus size={16} /> 新建文件夹
            </button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert type="error">{error}</Alert>
        </div>
      )}

      {roots.length === 0 ? (
        <Empty title="没有可用挂载目录" desc="请先创建并启动挂载" />
      ) : (
        <div className="card !p-0 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-800 sm:flex-row sm:items-center">
            <select
              className="input sm:max-w-xs"
              value={roots.find((r) => path.startsWith(r.path))?.path || roots[0]?.path}
              onChange={(e) => setPath(e.target.value)}
            >
              {roots.map((r) => (
                <option key={r.id} value={r.path}>
                  {r.name} — {r.path}
                </option>
              ))}
            </select>
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="input !pl-9"
                placeholder="搜索当前目录..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && browse(path)}
              />
            </div>
            <select className="input sm:w-36" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="name">按名称</option>
              <option value="size">按大小</option>
              <option value="mtime">按时间</option>
            </select>
            <div className="flex rounded-xl border border-slate-200 dark:border-slate-700">
              <button className={clsx("p-2", view === "list" && "bg-slate-100 dark:bg-slate-800")} onClick={() => setView("list")}>
                <List size={16} />
              </button>
              <button className={clsx("p-2", view === "grid" && "bg-slate-100 dark:bg-slate-800")} onClick={() => setView("grid")}>
                <Grid3X3 size={16} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 text-sm dark:border-slate-800">
            <button className="btn-ghost !px-2 !py-1" disabled={!parent} onClick={() => parent && setPath(parent)}>
              <ArrowUp size={16} /> 上级
            </button>
            <span className="truncate font-mono text-xs text-slate-500">{path}</span>
          </div>

          {loading ? (
            <Loading />
          ) : entries.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-500">空目录</div>
          ) : view === "list" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-400 dark:bg-slate-950">
                  <tr>
                    <th className="px-4 py-2 text-left">名称</th>
                    <th className="px-4 py-2 text-left">大小</th>
                    <th className="px-4 py-2 text-left">修改时间</th>
                    <th className="px-4 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {entries.map((e) => (
                    <tr key={e.path} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-2">
                        <button
                          className="flex items-center gap-2 text-left hover:text-brand-600"
                          onClick={() => (e.is_dir ? setPath(e.path) : undefined)}
                        >
                          {e.is_dir ? <Folder size={16} className="text-amber-500" /> : <File size={16} className="text-slate-400" />}
                          {e.name}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-slate-500">{e.is_dir ? "—" : formatBytes(e.size)}</td>
                      <td className="px-4 py-2 text-slate-500">
                        {e.mtime ? new Date(e.mtime * 1000).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {!e.is_dir && (
                          <button className="btn-ghost !p-1.5" onClick={() => download(e)}>
                            <Download size={14} />
                          </button>
                        )}
                        <button className="btn-ghost !p-1.5 text-rose-600" onClick={() => remove(e)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {entries.map((e) => (
                <button
                  key={e.path}
                  className="rounded-xl border border-slate-100 p-3 text-left hover:border-brand-300 hover:bg-brand-50/50 dark:border-slate-800 dark:hover:bg-slate-800"
                  onClick={() => e.is_dir && setPath(e.path)}
                  onDoubleClick={() => !e.is_dir && download(e)}
                >
                  <div className="mb-2 flex justify-center">
                    {e.is_dir ? <Folder size={36} className="text-amber-500" /> : <File size={36} className="text-slate-400" />}
                  </div>
                  <div className="truncate text-center text-xs font-medium">{e.name}</div>
                  <div className="mt-1 text-center text-[10px] text-slate-400">{e.is_dir ? "文件夹" : formatBytes(e.size)}</div>
                </button>
              ))}
            </div>
          )}
          {truncated && <div className="border-t p-3 text-center text-xs text-amber-600">目录条目过多，已截断显示</div>}
        </div>
      )}
    </div>
  );
}
