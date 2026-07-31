import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronRight,
  Copy,
  Download,
  Eye,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  Grid3X3,
  Home,
  List,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { api, formatBytes, getToken } from "../lib/api";
import type { FileEntry } from "../lib/types";
import { Alert, Empty, Loading, Modal, PageHeader, ProgressBar, StatusBadge } from "../components/ui";
import { ProviderMark, providerLabel as providerLabelFn, normalizeProvider } from "../components/BrandIcons";
import clsx from "clsx";

type Root = {
  id: number;
  name: string;
  path: string;
  status: string;
  account_name?: string | null;
  provider?: string;
  remote_path?: string;
  team_drive?: boolean;
  remote_name?: string | null;
};

const VIDEO_EXT = new Set(["mkv", "mp4", "avi", "mov", "wmv", "flv", "webm", "m4v", "ts", "m2ts", "rmvb"]);
const AUDIO_EXT = new Set(["mp3", "flac", "aac", "wav", "ogg", "m4a", "wma", "opus"]);
const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico", "heic"]);
const ARCHIVE_EXT = new Set(["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso"]);
const CODE_EXT = new Set(["json", "xml", "yml", "yaml", "nfo", "srt", "ass", "vtt", "txt", "md", "log", "csv"]);
const DOC_EXT = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"]);

function fileIconMeta(entry: FileEntry) {
  if (entry.is_dir) {
    return { Icon: Folder, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/40", label: "文件夹" };
  }
  const ext = (entry.ext || "").toLowerCase();
  if (VIDEO_EXT.has(ext))
    return { Icon: FileVideo, color: "text-violet-500", bg: "bg-violet-50 dark:bg-violet-950/40", label: "视频" };
  if (AUDIO_EXT.has(ext))
    return { Icon: FileAudio, color: "text-pink-500", bg: "bg-pink-50 dark:bg-pink-950/40", label: "音频" };
  if (IMAGE_EXT.has(ext))
    return { Icon: FileImage, color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-950/40", label: "图片" };
  if (ARCHIVE_EXT.has(ext))
    return { Icon: FileArchive, color: "text-orange-500", bg: "bg-orange-50 dark:bg-orange-950/40", label: "压缩包" };
  if (CODE_EXT.has(ext))
    return { Icon: FileCode, color: "text-sky-500", bg: "bg-sky-50 dark:bg-sky-950/40", label: "文本" };
  if (DOC_EXT.has(ext))
    return { Icon: FileText, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-950/40", label: "文档" };
  return { Icon: File, color: "text-slate-400", bg: "bg-slate-50 dark:bg-slate-800", label: "文件" };
}

function formatMtime(ts?: number | null) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return d.toLocaleString();
}

function providerLabel(p?: string, hint?: string) {
  return providerLabelFn(p, hint);
}

type TransferJob = {
  id: string;
  status: string;
  mode: string;
  percent: number;
  transferred: string;
  total: string;
  speed: string;
  eta: string;
  message: string;
  error: string;
  items_done: number;
  items_total: number;
  files_total?: number;
  files_done?: number;
  size_bytes?: number;
  can_close?: boolean;
};

function mediaKind(entry: FileEntry): "image" | "video" | "audio" | null {
  if (entry.is_dir) return null;
  const ext = (entry.ext || "").toLowerCase();
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return null;
}

/** Auth via query token so <img>/<video> can stream with Range support. */
function mediaUrl(path: string) {
  const token = getToken() || "";
  return `/api/files/download?path=${encodeURIComponent(path)}&inline=1&token=${encodeURIComponent(token)}`;
}

export default function FilesPage() {
  const [roots, setRoots] = useState<Root[]>([]);
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "grid">(() => {
    try {
      return (localStorage.getItem("gdm_files_view") as "list" | "grid") || "list";
    } catch {
      return "list";
    }
  });
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [copyOpen, setCopyOpen] = useState(false);
  /** Selected target mount root local path */
  const [copyRootPath, setCopyRootPath] = useState("");
  /** Optional subdir under the mount, e.g. 电影/2024 */
  const [copySubPath, setCopySubPath] = useState("");
  const [copyMsg, setCopyMsg] = useState("");
  const [copyJob, setCopyJob] = useState<TransferJob | null>(null);
  const [copyJobId, setCopyJobId] = useState<string | null>(null);
  const [preview, setPreview] = useState<FileEntry | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const checkedPaths = useMemo(
    () => Object.entries(checked).filter(([, v]) => v).map(([k]) => k),
    [checked]
  );

  const copyDest = useMemo(() => {
    const root = (copyRootPath || "").replace(/\/+$/, "");
    const sub = (copySubPath || "").replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
    if (!root) return "";
    return sub ? `${root}/${sub}` : root;
  }, [copyRootPath, copySubPath]);

  const pickDefaultCopyRoot = (list: Root[], from?: Root | null) => {
    // Prefer other mounts: 共享盘/团队盘 first, never default to source mount
    const others = list.filter((r) => r.path !== from?.path);
    const pool = others.length ? others : list;
    const shared =
      pool.find((r) => r.team_drive) ||
      pool.find((r) => /共享|团队|shared|team/i.test(r.name + (r.path || ""))) ||
      pool.find((r) => r.status === "running") ||
      pool[0];
    return shared?.path || "";
  };

  const activeRoot = useMemo(
    () => roots.find((r) => path === r.path || path.startsWith(r.path + "/")) || roots[0],
    [roots, path]
  );

  const breadcrumbs = useMemo(() => {
    if (!path || !activeRoot) return [];
    const rootPath = activeRoot.path.replace(/\/+$/, "");
    if (!path.startsWith(rootPath)) return [{ label: path, full: path }];
    const rel = path.slice(rootPath.length).replace(/^\/+/, "");
    const parts = rel ? rel.split("/").filter(Boolean) : [];
    const crumbs: { label: string; full: string }[] = [{ label: activeRoot.name, full: rootPath }];
    let cur = rootPath;
    for (const part of parts) {
      cur = `${cur}/${part}`;
      crumbs.push({ label: part, full: cur });
    }
    return crumbs;
  }, [path, activeRoot]);

  const stats = useMemo(() => {
    const dirs = entries.filter((e) => e.is_dir).length;
    const files = entries.length - dirs;
    const size = entries.reduce((s, e) => s + (e.is_dir ? 0 : e.size || 0), 0);
    return { dirs, files, size };
  }, [entries]);

  /** Selection summary for multi-select copy/move UI */
  const selectionStats = useMemo(() => {
    const paths = checkedPaths.length ? checkedPaths : selected ? [selected] : [];
    if (!paths.length) return null;
    let files = 0;
    let dirs = 0;
    let size = 0;
    for (const p of paths) {
      const e = entries.find((x) => x.path === p);
      if (!e) {
        // still count path even if not in current listing
        files += 1;
        continue;
      }
      if (e.is_dir) dirs += 1;
      else {
        files += 1;
        size += e.size || 0;
      }
    }
    return { count: paths.length, files, dirs, size };
  }, [checkedPaths, selected, entries]);

  const loadRoots = async () => {
    const r = await api.get<Root[]>("/files/roots");
    setRoots(r);
    if (!path && r.length) setPath(r[0].path);
    if (!r.length) setLoading(false);
  };

  const browse = async (p: string, searchTerm = search) => {
    if (!p) return;
    setLoading(true);
    setError("");
    setSelected(null);
    setChecked({});
    try {
      const q = new URLSearchParams({ path: p, sort_by: sortBy, sort_dir: sortDir });
      if (searchTerm) q.set("search", searchTerm);
      const res = await api.get<{
        path: string;
        parent: string | null;
        entries: FileEntry[];
        truncated: boolean;
      }>(`/files/browse?${q}`);
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

  const toggleCheck = (p: string) => {
    setChecked((prev) => ({ ...prev, [p]: !prev[p] }));
  };

  const openCopyModal = () => {
    const paths = checkedPaths.length
      ? checkedPaths
      : selected
        ? [selected]
        : [];
    if (!paths.length) {
      setError("请先勾选要复制的文件或文件夹");
      return;
    }
    // Prefer 共享盘 / team drive — do NOT default to personal (first by id)
    setCopyRootPath(pickDefaultCopyRoot(roots, activeRoot));
    setCopySubPath("");
    setCopyMsg("");
    setCopyJob(null);
    if (!copyJobId) setBusy(false);
    setError("");
    setCopyOpen(true);
  };

  const closeCopyModal = () => {
    // Always allowed: job keeps running in background
    setCopyOpen(false);
  };

  const submitCopy = async () => {
    const paths = checkedPaths.length ? checkedPaths : selected ? [selected] : [];
    if (!paths.length || !copyDest || !copyRootPath) {
      setError("请选择源与目标挂载");
      return;
    }
    // Ensure dest is under a known mount root
    const rootOk = roots.some(
      (r) => copyDest === r.path || copyDest.startsWith(r.path.replace(/\/+$/, "") + "/")
    );
    if (!rootOk) {
      setError("目标路径必须位于某个挂载根目录下");
      return;
    }
    if (paths.some((p) => p === copyDest || copyDest.startsWith(p + "/") || p.startsWith(copyDest + "/"))) {
      setError("不能复制到自身或其子目录");
      return;
    }
    setBusy(true);
    setError("");
    setCopyMsg("");
    setCopyJob(null);
    try {
      const res = await api.post<{
        message: string;
        mode: string;
        job_id?: string | null;
        async_job?: boolean;
        detail?: TransferJob;
      }>(`/files/copy`, {
        src_paths: paths,
        dest_dir: copyDest,
        prefer_rclone: true,
        async_job: true,
      });
      setCopyMsg(res.message);
      setChecked({});
      if (res.job_id) {
        setCopyJobId(res.job_id);
        if (res.detail) setCopyJob(res.detail as TransferJob);
      } else {
        setBusy(false);
      }
    } catch (e: any) {
      setError(e.detail || e.message);
      setCopyMsg("");
      setBusy(false);
    }
  };

  const cancelCopyJob = async () => {
    if (!copyJobId) return;
    try {
      const j = await api.post<TransferJob>(`/files/copy/${copyJobId}/cancel`);
      setCopyJob(j);
      setBusy(false);
      setCopyMsg("已请求取消");
    } catch (e: any) {
      setError(e.detail || e.message);
    }
  };

  // Poll transfer job progress
  useEffect(() => {
    if (!copyJobId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const j = await api.get<TransferJob>(`/files/copy/${copyJobId}`);
        if (stopped) return;
        setCopyJob(j);
        if (j.status === "success") {
          setBusy(false);
          setCopyMsg(j.message || "复制完成");
          setCopyJobId(null);
        } else if (j.status === "error" || j.status === "cancelled") {
          setBusy(false);
          if (j.status === "error") setError(j.error || j.message || "复制失败");
          else setCopyMsg(j.message || "已取消");
          setCopyJobId(null);
        }
      } catch {
        /* ignore transient poll errors */
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [copyJobId]);

  useEffect(() => {
    loadRoots().catch((e) => setError(e.detail || e.message));
  }, []);

  useEffect(() => {
    if (path) browse(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, sortBy, sortDir]);

  useEffect(() => {
    try {
      localStorage.setItem("gdm_files_view", view);
    } catch {
      /* ignore */
    }
  }, [view]);

  const mkdir = async () => {
    const name = prompt("新文件夹名称");
    if (!name) return;
    setBusy(true);
    try {
      await api.post(`/files/mkdir?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`);
      await browse(path);
    } catch (e: any) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: FileEntry) => {
    if (!confirm(`删除「${entry.name}」？此操作不可撤销。`)) return;
    setBusy(true);
    try {
      await api.delete(`/files?path=${encodeURIComponent(entry.path)}`);
      await browse(path);
    } catch (e: any) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const download = (entry: FileEntry) => {
    const token = getToken();
    const url = `/api/files/download?path=${encodeURIComponent(entry.path)}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new Error("下载失败");
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = entry.name;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((e) => setError(String(e)));
  };

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("复制路径失败");
    }
  };

  const toggleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col) return <ArrowUpDown size={12} className="opacity-40" />;
    return sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  const openEntry = (e: FileEntry) => {
    if (e.is_dir) {
      setPath(e.path);
      return;
    }
    setSelected(e.path);
    const kind = mediaKind(e);
    if (kind) {
      setPreview(e);
    }
  };

  const previewKind = preview ? mediaKind(preview) : null;

  return (
    <div>
      <PageHeader
        title="文件浏览器"
        desc="浏览挂载目录 · Google / OneDrive / 123云盘 · 可跨盘复制（优先 rclone 云对云）"
        actions={
          <>
            <button className="btn-secondary" onClick={() => browse(path)} disabled={!path || loading} title="刷新">
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              刷新
            </button>
            <button
              className="btn-secondary"
              onClick={openCopyModal}
              disabled={busy || (!checkedPaths.length && !selected)}
              title="勾选文件后复制到其他挂载（123→团队盘）"
            >
              <Copy size={16} /> 复制到…
              {checkedPaths.length > 0 ? ` (${checkedPaths.length})` : ""}
            </button>
            <button className="btn-primary" onClick={mkdir} disabled={!path || busy}>
              <Plus size={16} /> 新建文件夹
            </button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert type="error">
            <div className="flex items-start justify-between gap-2">
              <span>{error}</span>
              <button className="shrink-0 opacity-60 hover:opacity-100" onClick={() => setError("")}>
                <X size={14} />
              </button>
            </div>
          </Alert>
        </div>
      )}

      {roots.length === 0 ? (
        <Empty title="没有可用挂载目录" desc="请先在「挂载管理」中创建并启动挂载，再回到这里浏览文件" />
      ) : (
        <div className="card !p-0 overflow-hidden shadow-soft">
          {/* Top toolbar */}
          <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              {/* Mount roots as chips */}
              <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                {roots.map((r) => {
                  const active = activeRoot?.id === r.id;
                  return (
                    <button
                      key={r.id}
                      onClick={() => setPath(r.path)}
                      className={clsx(
                        "group flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition",
                        active
                          ? "border-brand-400 bg-brand-50 shadow-sm dark:border-brand-600 dark:bg-slate-800"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800/80 dark:hover:bg-slate-800"
                      )}
                    >
                      <ProviderMark
                        provider={r.provider}
                        hint={`${r.name} ${r.account_name || ""} ${r.remote_name || ""}`}
                        size={32}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{r.name}</span>
                          <StatusBadge status={r.status} />
                        </div>
                        <div className="truncate text-[11px] text-slate-400">
                          {providerLabel(r.provider, `${r.name} ${r.account_name || ""}`)}
                          {r.account_name ? ` · ${r.account_name}` : ""}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1 sm:w-56 sm:flex-none">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    className="input !pl-9 !pr-8"
                    placeholder="搜索当前目录…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && browse(path, search)}
                  />
                  {search && (
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      onClick={() => {
                        setSearch("");
                        browse(path, "");
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800">
                  <button
                    className={clsx(
                      "flex items-center gap-1 px-3 py-2 text-sm transition",
                      view === "list"
                        ? "bg-brand-50 text-brand-700 dark:bg-slate-700 dark:text-brand-300"
                        : "hover:bg-slate-50 dark:hover:bg-slate-700"
                    )}
                    onClick={() => setView("list")}
                    title="列表视图"
                  >
                    <List size={16} />
                  </button>
                  <button
                    className={clsx(
                      "flex items-center gap-1 border-l border-slate-200 px-3 py-2 text-sm transition dark:border-slate-600",
                      view === "grid"
                        ? "bg-brand-50 text-brand-700 dark:bg-slate-700 dark:text-brand-300"
                        : "hover:bg-slate-50 dark:hover:bg-slate-700"
                    )}
                    onClick={() => setView("grid")}
                    title="网格视图"
                  >
                    <Grid3X3 size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Breadcrumb bar */}
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
            <button
              className="btn-ghost !rounded-lg !px-2 !py-1.5"
              disabled={!parent}
              onClick={() => parent && setPath(parent)}
              title="上级目录"
            >
              <ArrowUp size={15} />
            </button>
            <button
              className="btn-ghost !rounded-lg !px-2 !py-1.5"
              onClick={() => activeRoot && setPath(activeRoot.path)}
              title="挂载根目录"
            >
              <Home size={15} />
            </button>
            <div className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-700" />
            <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm">
              {breadcrumbs.map((c, i) => {
                const isLast = i === breadcrumbs.length - 1;
                return (
                  <div key={c.full} className="flex shrink-0 items-center gap-0.5">
                    {i > 0 && <ChevronRight size={14} className="text-slate-300 dark:text-slate-600" />}
                    <button
                      className={clsx(
                        "max-w-[180px] truncate rounded-lg px-2 py-1 transition",
                        isLast
                          ? "bg-slate-100 font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                          : "text-slate-500 hover:bg-slate-50 hover:text-brand-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-brand-300"
                      )}
                      onClick={() => setPath(c.full)}
                      title={c.full}
                    >
                      {i === 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <FolderOpen size={13} className="text-amber-500" />
                          {c.label}
                        </span>
                      ) : (
                        c.label
                      )}
                    </button>
                  </div>
                );
              })}
            </nav>
            <button
              className="btn-ghost !rounded-lg !px-2 !py-1.5 text-xs"
              onClick={copyPath}
              title="复制完整路径"
            >
              {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
              <span className="hidden sm:inline">{copied ? "已复制" : "复制路径"}</span>
            </button>
          </div>

          {/* Stats strip */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 bg-white px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <span className="font-mono text-[11px] text-slate-400 truncate max-w-full">{path}</span>
            <span className="ml-auto flex flex-wrap gap-3">
              {selectionStats ? (
                <span className="font-medium text-brand-600 dark:text-brand-400">
                  已选 <strong>{selectionStats.count}</strong> 项
                  {selectionStats.dirs > 0 ? ` · ${selectionStats.dirs} 文件夹` : ""}
                  {selectionStats.files > 0 ? ` · ${selectionStats.files} 文件` : ""}
                  {selectionStats.size > 0 ? ` · 共 ${formatBytes(selectionStats.size)}` : selectionStats.dirs > 0 ? " · 文件夹大小待扫描" : ""}
                </span>
              ) : (
                <>
                  <span>
                    <strong className="text-slate-700 dark:text-slate-200">{stats.dirs}</strong> 文件夹
                  </span>
                  <span>
                    <strong className="text-slate-700 dark:text-slate-200">{stats.files}</strong> 文件
                  </span>
                  <span>
                    共 <strong className="text-slate-700 dark:text-slate-200">{formatBytes(stats.size)}</strong>
                  </span>
                </>
              )}
            </span>
          </div>

          {loading ? (
            <Loading label="读取目录…" />
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
                <FolderOpen size={28} className="text-slate-400" />
              </div>
              <div className="text-sm font-medium text-slate-600 dark:text-slate-300">
                {search ? "没有匹配的文件" : "空目录"}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {search ? "试试其他关键词，或清空搜索" : "可以新建文件夹，或从媒体库写入文件"}
              </div>
            </div>
          ) : view === "list" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-400 dark:bg-slate-900 dark:text-slate-500">
                  <tr>
                    <th className="w-10 px-3 py-2.5 text-left font-medium">
                      <span className="sr-only">选择</span>
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">
                      <button className="inline-flex items-center gap-1 hover:text-slate-600" onClick={() => toggleSort("name")}>
                        名称 <SortIcon col="name" />
                      </button>
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">
                      <button className="inline-flex items-center gap-1 hover:text-slate-600" onClick={() => toggleSort("size")}>
                        大小 <SortIcon col="size" />
                      </button>
                    </th>
                    <th className="hidden px-4 py-2.5 text-left font-medium md:table-cell">
                      <button className="inline-flex items-center gap-1 hover:text-slate-600" onClick={() => toggleSort("mtime")}>
                        修改时间 <SortIcon col="mtime" />
                      </button>
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {entries.map((e) => {
                    const meta = fileIconMeta(e);
                    const Icon = meta.Icon;
                    const isSel = selected === e.path;
                    const isChecked = !!checked[e.path];
                    return (
                      <tr
                        key={e.path}
                        className={clsx(
                          "group transition-colors",
                          isChecked || isSel
                            ? "bg-brand-50/70 dark:bg-brand-950/30"
                            : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                        )}
                        onClick={() => setSelected(e.path)}
                        onDoubleClick={() => openEntry(e)}
                      >
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            checked={isChecked}
                            onChange={() => toggleCheck(e.path)}
                            onClick={(ev) => ev.stopPropagation()}
                            title="勾选后可批量复制到其他挂载"
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <button
                            className="flex max-w-full items-center gap-3 text-left"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              openEntry(e);
                            }}
                          >
                            <span className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", meta.bg)}>
                              <Icon size={18} className={meta.color} />
                            </span>
                            <span className="min-w-0">
                              <span
                                className={clsx(
                                  "block truncate font-medium",
                                  e.is_dir ? "text-slate-800 hover:text-brand-600 dark:text-slate-100" : "text-slate-700 dark:text-slate-200"
                                )}
                              >
                                {e.name}
                              </span>
                              <span className="text-[11px] text-slate-400 md:hidden">
                                {e.is_dir ? "文件夹" : formatBytes(e.size)} · {formatMtime(e.mtime)}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-slate-500">
                          {e.is_dir ? "—" : formatBytes(e.size)}
                        </td>
                        <td className="hidden px-4 py-2.5 text-slate-500 md:table-cell" title={e.mtime ? new Date(e.mtime * 1000).toLocaleString() : ""}>
                          {formatMtime(e.mtime)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex items-center gap-0.5 opacity-70 transition group-hover:opacity-100">
                            {!e.is_dir && mediaKind(e) && (
                              <button
                                className="btn-ghost !rounded-lg !p-1.5"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  setSelected(e.path);
                                  setPreview(e);
                                }}
                                title="预览"
                              >
                                <Eye size={15} />
                              </button>
                            )}
                            {!e.is_dir && (
                              <button
                                className="btn-ghost !rounded-lg !p-1.5"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  download(e);
                                }}
                                title="下载"
                              >
                                <Download size={15} />
                              </button>
                            )}
                            <button
                              className="btn-ghost !rounded-lg !p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                remove(e);
                              }}
                              title="删除"
                              disabled={busy}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {entries.map((e) => {
                const meta = fileIconMeta(e);
                const Icon = meta.Icon;
                const isSel = selected === e.path;
                return (
                  <div
                    key={e.path}
                    className={clsx(
                      "group relative flex flex-col rounded-2xl border p-3 transition",
                      isSel
                        ? "border-brand-400 bg-brand-50 shadow-sm dark:border-brand-600 dark:bg-slate-800"
                        : "border-slate-100 bg-slate-50 hover:border-brand-200 hover:shadow-soft dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-brand-700"
                    )}
                    onClick={() => setSelected(e.path)}
                    onDoubleClick={() => openEntry(e)}
                  >
                    <button
                      className="flex flex-1 flex-col items-center text-center"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        openEntry(e);
                      }}
                    >
                      <div className={clsx("mb-3 flex h-14 w-14 items-center justify-center rounded-2xl", meta.bg)}>
                        <Icon size={28} className={meta.color} />
                      </div>
                      <div className="line-clamp-2 w-full text-xs font-medium leading-snug text-slate-700 dark:text-slate-200" title={e.name}>
                        {e.name}
                      </div>
                      <div className="mt-1.5 text-[10px] text-slate-400">
                        {e.is_dir ? "文件夹" : formatBytes(e.size)}
                        {!e.is_dir && mediaKind(e) ? " · 可预览" : ""}
                      </div>
                    </button>
                    <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 transition group-hover:opacity-100">
                      {!e.is_dir && mediaKind(e) && (
                        <button
                          className="rounded-lg bg-white p-1.5 shadow-sm hover:bg-brand-50 dark:bg-slate-700 dark:hover:bg-slate-600"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setPreview(e);
                          }}
                          title="预览"
                        >
                          <Eye size={13} />
                        </button>
                      )}
                      {!e.is_dir && (
                        <button
                          className="rounded-lg bg-white p-1.5 shadow-sm hover:bg-brand-50 dark:bg-slate-700 dark:hover:bg-slate-600"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            download(e);
                          }}
                          title="下载"
                        >
                          <Download size={13} />
                        </button>
                      )}
                      <button
                        className="rounded-lg bg-white p-1.5 text-rose-600 shadow-sm hover:bg-rose-50 dark:bg-slate-700 dark:text-rose-400 dark:hover:bg-slate-600"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          remove(e);
                        }}
                        title="删除"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {truncated && (
            <div className="border-t border-amber-100 bg-amber-50/80 px-4 py-2.5 text-center text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              目录条目过多，已截断显示。可使用搜索缩小范围。
            </div>
          )}
        </div>
      )}

      <Modal open={copyOpen} title="复制到其他挂载" onClose={closeCopyModal}>
        <div className="space-y-4">
          <Alert type="info">
            任务在<strong>服务器后台</strong>运行：可以随时关闭弹窗/离开页面，复制不会中断。
            需要看进度时再打开此对话框（或保持打开看进度条）。
          </Alert>
          <div>
            <div className="label">源（已选 {checkedPaths.length || (selected ? 1 : 0)} 项）</div>
            <ul className="mt-1 max-h-28 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-800">
              {(checkedPaths.length ? checkedPaths : selected ? [selected] : []).map((p) => (
                <li key={p} className="truncate py-0.5">
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <label className="label">目标挂载（先选盘）</label>
            <select
              className="input"
              value={copyRootPath}
              disabled={!!copyJobId}
              onChange={(e) => setCopyRootPath(e.target.value)}
            >
              {roots.map((r) => {
                const p = normalizeProvider(r.provider, `${r.name} ${r.account_name || ""}`);
                const tag = r.team_drive
                  ? "共享/团队盘"
                  : p === "123pan"
                    ? "123云盘"
                    : p === "onedrive"
                      ? "OneDrive"
                      : "个人盘";
                return (
                  <option key={r.id} value={r.path}>
                    {r.name} · {tag}
                    {r.status !== "running" ? " [未运行]" : ""}
                  </option>
                );
              })}
            </select>
            {copyRootPath && (
              <p className="mt-1 font-mono text-[11px] text-slate-400">根路径：{copyRootPath}</p>
            )}
          </div>
          <div>
            <label className="label">
              子目录（可选）
              <span className="ml-1 font-normal text-slate-400">相对挂载根，不要填整段 /mnt/…</span>
            </label>
            <input
              className="input font-mono text-xs"
              value={copySubPath}
              disabled={!!copyJobId}
              onChange={(e) => setCopySubPath(e.target.value)}
              placeholder="例如：电影 或 媒体库/国产剧"
              spellCheck={false}
            />
            <p className="mt-1.5 text-[11px] text-slate-500">
              最终目标：
              <code className="ml-1 rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800">
                {copyDest || "—"}
              </code>
            </p>
          </div>

          {(copyJob || copyJobId) && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {copyJob?.message || "准备中…"}
                </span>
                <span className="tabular-nums text-slate-500">
                  {copyJob ? `${copyJob.percent.toFixed(0)}%` : "…"}
                </span>
              </div>
              <ProgressBar
                value={copyJob?.percent ?? 0}
                color={
                  copyJob?.status === "error"
                    ? "bg-rose-500"
                    : copyJob?.status === "success"
                      ? "bg-emerald-500"
                      : "bg-brand-500"
                }
              />
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                {copyJob?.transferred && (
                  <span>
                    已传 {copyJob.transferred}
                    {copyJob.total ? ` / ${copyJob.total}` : ""}
                  </span>
                )}
                {!copyJob?.transferred && (copyJob?.size_bytes ?? 0) > 0 && (
                  <span>
                    {(copyJob?.files_total ?? 0) > 0
                      ? `${copyJob?.files_total} 个文件 · 共 ${formatBytes(copyJob?.size_bytes || 0)}`
                      : `共 ${formatBytes(copyJob?.size_bytes || 0)}`}
                  </span>
                )}
                {copyJob?.speed && <span>{copyJob.speed}</span>}
                {copyJob?.eta && <span>ETA {copyJob.eta}</span>}
                {copyJob && copyJob.items_total > 0 && (
                  <span>
                    项目 {copyJob.items_done}/{copyJob.items_total}
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                关闭后仍可在「上传进度」页查看复制进度与事件
              </p>
            </div>
          )}

          {error && copyOpen && <Alert type="error">{error}</Alert>}
          {copyMsg && !error && (
            <Alert type={copyJob?.status === "error" ? "error" : "success"}>{copyMsg}</Alert>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            {copyJobId && (
              <button type="button" className="btn-ghost text-rose-600" onClick={cancelCopyJob}>
                取消任务
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={closeCopyModal}>
              {copyJobId ? "关闭（后台继续）" : "关闭"}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !copyRootPath || !!copyJobId}
              onClick={submitCopy}
            >
              {copyJobId ? "复制进行中…" : busy ? "提交中…" : "开始复制"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Floating progress chip when modal closed but job running */}
      {!copyOpen && copyJobId && copyJob && (
        <button
          type="button"
          onClick={() => setCopyOpen(true)}
          className="fixed bottom-20 right-4 z-[150] max-w-xs rounded-2xl border border-brand-200 bg-white p-3 text-left shadow-lg dark:border-brand-800 dark:bg-slate-900 sm:bottom-6"
        >
          <div className="mb-1 text-xs font-semibold text-brand-700 dark:text-brand-300">
            后台复制 {copyJob.percent.toFixed(0)}%
          </div>
          <ProgressBar value={copyJob.percent} />
          <div className="mt-1 truncate text-[11px] text-slate-500">{copyJob.message}</div>
          <div className="mt-0.5 text-[10px] text-slate-400">点按查看详情</div>
        </button>
      )}

      {/* Media preview lightbox */}
      {preview && previewKind && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6"
          onClick={() => setPreview(null)}
          onKeyDown={(e) => e.key === "Escape" && setPreview(null)}
          role="dialog"
          aria-modal
        >
          <div
            className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">{preview.name}</div>
                <div className="truncate text-[11px] text-slate-400">
                  {formatBytes(preview.size)}
                  {preview.mtime ? ` · ${new Date(preview.mtime * 1000).toLocaleString()}` : ""}
                </div>
              </div>
              <button
                className="btn-secondary !py-1.5 text-xs"
                onClick={() => download(preview)}
              >
                <Download size={14} /> 下载
              </button>
              <button
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                onClick={() => setPreview(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-black/40 p-3 sm:p-6">
              {previewKind === "image" && (
                <img
                  src={mediaUrl(preview.path)}
                  alt={preview.name}
                  className="max-h-[75vh] max-w-full rounded-lg object-contain shadow-lg"
                />
              )}
              {previewKind === "video" && (
                <video
                  key={preview.path}
                  src={mediaUrl(preview.path)}
                  controls
                  autoPlay
                  className="max-h-[75vh] max-w-full rounded-lg shadow-lg"
                  style={{ width: "100%" }}
                >
                  您的浏览器不支持视频播放
                </video>
              )}
              {previewKind === "audio" && (
                <div className="w-full max-w-md space-y-4 py-8 text-center">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-pink-500/20 text-pink-400">
                    <FileAudio size={36} />
                  </div>
                  <div className="text-sm text-slate-300">{preview.name}</div>
                  <audio key={preview.path} src={mediaUrl(preview.path)} controls autoPlay className="w-full" />
                </div>
              )}
            </div>
            <div className="border-t border-slate-800 px-4 py-2 font-mono text-[10px] text-slate-500 truncate">
              {preview.path}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
