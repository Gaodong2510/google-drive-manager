import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  CheckCircle2,
  ClipboardPaste,
  FileUp,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { api, formatBytes } from "../lib/api";
import type { CloudProvider, DriveAccount } from "../lib/types";
import { Alert, Empty, Loading, Modal, PageHeader, StatusBadge, UsageBar } from "../components/ui";
import { GoogleDriveIcon, OneDriveIcon, ProviderMark } from "../components/BrandIcons";
import clsx from "clsx";

type RcloneRemotePreview = {
  remote_name: string;
  type: string;
  has_token: boolean;
  has_client_id: boolean;
  has_client_secret: boolean;
  root_folder_id?: string | null;
  team_drive?: string | null;
  scope?: string | null;
  drive_id?: string | null;
  drive_type?: string | null;
};

type AuthMode = "create" | "token" | "import" | "token_existing" | null;

function providerLabel(p?: string) {
  return p === "onedrive" ? "OneDrive" : "Google Drive";
}

function providerBadgeClass(p?: string) {
  return p === "onedrive"
    ? "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"
    : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300";
}

export default function AccountsPage() {
  const [list, setList] = useState<DriveAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<AuthMode>(null);
  const [targetId, setTargetId] = useState<number | null>(null);

  // create empty account
  const [name, setName] = useState("");
  const [remote, setRemote] = useState("");
  const [createProvider, setCreateProvider] = useState<CloudProvider>("drive");

  // paste token
  const [tokenText, setTokenText] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [tokenRemote, setTokenRemote] = useState("");
  const [tokenProvider, setTokenProvider] = useState<CloudProvider>("drive");
  const [tokenClientId, setTokenClientId] = useState("");
  const [tokenClientSecret, setTokenClientSecret] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // import rclone
  const [configText, setConfigText] = useState("");
  const [preview, setPreview] = useState<RcloneRemotePreview[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [overwrite, setOverwrite] = useState(false);

  const load = async () => {
    try {
      setList(await api.get<DriveAccount[]>("/accounts"));
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

  const closeModal = () => {
    setMode(null);
    setTargetId(null);
    setName("");
    setRemote("");
    setCreateProvider("drive");
    setTokenText("");
    setTokenName("");
    setTokenRemote("");
    setTokenProvider("drive");
    setTokenClientId("");
    setTokenClientSecret("");
    setShowAdvanced(false);
    setConfigText("");
    setPreview([]);
    setSelected({});
    setOverwrite(false);
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.post("/accounts", {
        name: name.trim(),
        remote_name: remote.trim() || undefined,
        provider: createProvider,
      });
      closeModal();
      await load();
      setMsg("账号已创建，请点击「Web OAuth」网页登录授权（也可粘贴 Token / 导入 rclone）");
    } catch (e: any) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const startOAuth = async (id: number, provider?: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await api.post<{ authorize_url: string }>(`/accounts/${id}/oauth/start`);
      window.open(res.authorize_url, "gdm_oauth", "width=600,height=720");
      const label = provider === "onedrive" ? "Microsoft / OneDrive" : "Google";
      setMsg(`已打开 ${label} 授权窗口，登录完成后返回此页刷新列表（与 CD2 类似的网页授权）`);
      // Listen for popup success then refresh
      const onMsg = (ev: MessageEvent) => {
        if (ev.data?.type === "gdm-oauth") {
          window.removeEventListener("message", onMsg);
          load();
          if (ev.data.ok) setMsg("授权成功，列表已刷新");
        }
      };
      window.addEventListener("message", onMsg);
      setTimeout(() => window.removeEventListener("message", onMsg), 15 * 60 * 1000);
    } catch (e: any) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const submitToken = async () => {
    if (!tokenText.trim()) {
      setError("请粘贴 Token JSON");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        token: tokenText.trim(),
        provider: tokenProvider,
        test_connection: true,
      };
      if (tokenClientId.trim()) body.client_id = tokenClientId.trim();
      if (tokenClientSecret.trim()) body.client_secret = tokenClientSecret.trim();

      let acc: DriveAccount;
      if (mode === "token_existing" && targetId != null) {
        acc = await api.post<DriveAccount>(`/accounts/${targetId}/auth/token`, body);
      } else {
        if (!tokenName.trim()) {
          setError("请填写显示名称");
          setBusy(false);
          return;
        }
        body.name = tokenName.trim();
        if (tokenRemote.trim()) body.remote_name = tokenRemote.trim();
        acc = await api.post<DriveAccount>("/accounts/auth/token", body);
      }
      closeModal();
      await load();
      setMsg(
        acc.status === "connected"
          ? `授权成功：${acc.name}${acc.email ? ` (${acc.email})` : ""}`
          : `Token 已保存，但连接检测异常：${acc.last_error || acc.name}`,
      );
    } catch (e: any) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const previewImport = async () => {
    if (!configText.trim()) {
      setError("请粘贴 rclone 配置内容");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api.post<{ remotes: RcloneRemotePreview[]; count: number }>(
        "/accounts/import-rclone/preview",
        { config_text: configText },
      );
      setPreview(res.remotes);
      const sel: Record<string, boolean> = {};
      res.remotes.forEach((r) => {
        sel[r.remote_name] = r.has_token;
      });
      setSelected(sel);
      setMsg(`解析到 ${res.count} 个云盘 remote（Google Drive / OneDrive）`);
    } catch (e: any) {
      setPreview([]);
      setSelected({});
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const submitImport = async () => {
    const picked = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (!picked.length) {
      setError("请至少选择一个 remote");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api.post<{ count: number; message: string }>("/accounts/import-rclone", {
        config_text: configText,
        selected_remotes: picked,
        overwrite,
        test_connection: true,
      });
      closeModal();
      await load();
      setMsg(res.message || `成功导入 ${res.count} 个账号`);
    } catch (e: any) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const test = async (id: number) => {
    setBusy(true);
    try {
      const res = await api.post<{ message: string }>(`/accounts/${id}/test`);
      setMsg(res.message);
      await load();
    } catch (e: any) {
      setError(e.detail || e.message);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number, n: string) => {
    if (!confirm(`确定删除账号「${n}」？关联挂载将一并删除。`)) return;
    await api.delete(`/accounts/${id}`);
    await load();
  };

  const openPasteFor = (a: DriveAccount) => {
    setTargetId(a.id);
    setTokenName(a.name);
    setTokenRemote(a.remote_name);
    setTokenProvider((a.provider === "onedrive" ? "onedrive" : "drive") as CloudProvider);
    setMode("token_existing");
  };

  if (loading) return <Loading />;

  const modalTitle =
    mode === "create"
      ? "添加账号（稍后授权）"
      : mode === "token"
        ? "粘贴 Token 授权"
        : mode === "token_existing"
          ? "粘贴 Token 重新授权"
          : mode === "import"
            ? "导入 rclone 配置"
            : "";

  return (
    <div>
      <PageHeader
        title="云盘账号"
        desc="Google Drive / OneDrive · 网页登录授权（Web OAuth）、粘贴 Token、导入 rclone"
        actions={
          <>
            <Link to="/help#connect" className="btn-secondary">
              <BookOpen size={16} /> 连接教程
            </Link>
            <button className="btn-secondary" onClick={load}>
              <RefreshCw size={16} /> 刷新
            </button>
            <button className="btn-secondary" onClick={() => setMode("import")}>
              <FileUp size={16} /> 导入 rclone
            </button>
            <button className="btn-secondary" onClick={() => setMode("token")}>
              <ClipboardPaste size={16} /> 粘贴 Token
            </button>
            <button className="btn-primary" onClick={() => setMode("create")}>
              <Plus size={16} /> 添加账号
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

      {list.length === 0 ? (
        <Empty
          title="还没有云盘账号"
          desc="支持 Google Drive 与 OneDrive：可直接「粘贴 Token」或「导入 rclone」"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => (
            <div
              key={a.id}
              className="card group flex flex-col !p-0 overflow-hidden transition hover:shadow-md"
            >
              <div
                className={clsx(
                  "h-1 w-full",
                  a.provider === "onedrive"
                    ? "bg-gradient-to-r from-sky-400 to-blue-600"
                    : "bg-gradient-to-r from-emerald-400 via-blue-500 to-amber-400"
                )}
              />
              <div className="flex flex-1 flex-col p-5">
                <div className="mb-4 flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3">
                    <ProviderMark provider={a.provider} size={48} />
                    <div>
                      <div className="text-base font-semibold tracking-tight">{a.name}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{a.email || "未授权"}</div>
                      <span className={clsx("badge mt-1.5", providerBadgeClass(a.provider))}>
                        {a.provider === "onedrive" ? (
                          <OneDriveIcon size={12} />
                        ) : (
                          <GoogleDriveIcon size={12} />
                        )}
                        {providerLabel(a.provider)}
                      </span>
                    </div>
                  </div>
                  <StatusBadge status={a.status} />
                </div>

                <div className="mb-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                    <div className="text-[11px] text-slate-400">Remote</div>
                    <div className="mt-0.5 truncate font-mono text-xs font-medium text-slate-700 dark:text-slate-200">
                      {a.remote_name}
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                    <div className="text-[11px] text-slate-400">挂载</div>
                    <div className="mt-0.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                      {a.running_mounts}/{a.mount_count} 运行中
                    </div>
                  </div>
                  {a.provider === "onedrive" && a.onedrive_drive_type && (
                    <div className="col-span-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                      <div className="text-[11px] text-slate-400">Drive 类型</div>
                      <div className="mt-0.5 text-xs font-medium">{a.onedrive_drive_type}</div>
                    </div>
                  )}
                  {a.last_check_at && (
                    <div className="col-span-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                      <div className="text-[11px] text-slate-400">上次检测</div>
                      <div className="mt-0.5 text-xs font-medium">
                        {new Date(a.last_check_at).toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>

                {a.total_bytes != null && (
                  <div className="mb-4">
                    <UsageBar used={a.used_bytes} total={a.total_bytes} label="容量" />
                    <div className="mt-1 text-xs text-slate-500">剩余 {formatBytes(a.free_bytes)}</div>
                  </div>
                )}
                {a.last_error && (
                  <div className="mb-3">
                    <Alert type="error">{a.last_error}</Alert>
                  </div>
                )}
                <div className="mt-auto flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <button
                    className="btn-primary !px-3 !py-1.5 text-xs"
                    disabled={busy}
                    onClick={() => startOAuth(a.id, a.provider)}
                    title={
                      a.provider === "onedrive"
                        ? "打开 Microsoft 登录页授权（类似 CD2）"
                        : "打开 Google 登录页授权"
                    }
                  >
                    <Link2 size={14} /> Web OAuth
                  </button>
                  <button
                    className="btn-secondary !px-3 !py-1.5 text-xs"
                    disabled={busy}
                    onClick={() => openPasteFor(a)}
                    title="本机 rclone authorize 后粘贴"
                  >
                    <ClipboardPaste size={14} /> 粘贴 Token
                  </button>
                  <button
                    className="btn-secondary !px-3 !py-1.5 text-xs"
                    disabled={busy || !a.has_token}
                    onClick={() => test(a.id)}
                  >
                    <CheckCircle2 size={14} /> 测试
                  </button>
                  <button
                    className="btn-ghost !px-3 !py-1.5 text-xs text-rose-600"
                    onClick={() => remove(a.id, a.name)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {list.length > 0 && (
        <p className="mt-4 text-center text-xs text-slate-400">
          推荐本机{" "}
          <code className="rounded bg-slate-100 px-1 font-mono dark:bg-slate-800">rclone authorize</code>{" "}
          后粘贴 Token，或导入 rclone.conf ·{" "}
          <Link to="/help#connect" className="text-brand-600 hover:underline">
            连接教程
          </Link>
        </p>
      )}

      <Modal open={mode !== null} title={modalTitle} onClose={closeModal}>
        {mode === "create" && (
          <div className="space-y-4">
            <Alert type="info">
              创建后点「Web OAuth」即可网页登录授权（Google 或 Microsoft / OneDrive，体验类似
              CloudDrive2）。也可改用粘贴 Token 或导入 rclone。
            </Alert>
            <div>
              <label className="label">云盘类型</label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: "drive" as const, title: "Google Drive", desc: "含 Team Drive" },
                    { id: "onedrive" as const, title: "OneDrive", desc: "个人 / 商业" },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={clsx(
                      "rounded-xl border px-3 py-2.5 text-left transition",
                      createProvider === p.id
                        ? "border-brand-400 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/40"
                        : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
                    )}
                    onClick={() => setCreateProvider(p.id)}
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      {p.id === "onedrive" ? <OneDriveIcon size={20} /> : <GoogleDriveIcon size={20} />}
                      <div className="text-sm font-medium">{p.title}</div>
                    </div>
                    <div className="text-[11px] text-slate-500">{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">显示名称</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={createProvider === "onedrive" ? "例如：我的 OneDrive" : "例如：我的媒体库"}
              />
            </div>
            <div>
              <label className="label">rclone Remote 名称（可选）</label>
              <input
                className="input"
                value={remote}
                onChange={(e) => setRemote(e.target.value)}
                placeholder={createProvider === "onedrive" ? "例如：od_media" : "例如：media_drive"}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={closeModal}>
                取消
              </button>
              <button className="btn-primary" disabled={busy || !name.trim()} onClick={create}>
                创建
              </button>
            </div>
          </div>
        )}

        {(mode === "token" || mode === "token_existing") && (
          <div className="space-y-4">
            {mode === "token" && (
              <div>
                <label className="label">云盘类型</label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: "drive" as const, title: "Google Drive" },
                      { id: "onedrive" as const, title: "OneDrive" },
                    ] as const
                  ).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={clsx(
                        "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition",
                        tokenProvider === p.id
                          ? "border-brand-400 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/40"
                          : "border-slate-200 dark:border-slate-700"
                      )}
                      onClick={() => setTokenProvider(p.id)}
                    >
                      {p.id === "onedrive" ? <OneDriveIcon size={18} /> : <GoogleDriveIcon size={18} />}
                      {p.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Alert type="info">
              在本机执行：
              <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-2 font-mono text-xs text-emerald-300">
                {tokenProvider === "onedrive"
                  ? 'rclone authorize "onedrive"'
                  : 'rclone authorize "drive"'}
              </pre>
              浏览器登录后，把终端输出的 JSON（或整段粘贴文本）填到下方。
              {tokenProvider === "onedrive" && (
                <span className="mt-1 block text-xs">
                  OneDrive 更稳妥的方式：本机 <code className="font-mono">rclone config</code> 完成后，用「导入
                  rclone」粘贴完整 [remote] 段（含 drive_id）。
                </span>
              )}
            </Alert>
            {mode === "token" && (
              <>
                <div>
                  <label className="label">显示名称</label>
                  <input
                    className="input"
                    value={tokenName}
                    onChange={(e) => setTokenName(e.target.value)}
                    placeholder={tokenProvider === "onedrive" ? "例如：我的 OneDrive" : "例如：我的媒体库"}
                  />
                </div>
                <div>
                  <label className="label">rclone Remote 名称（可选）</label>
                  <input
                    className="input"
                    value={tokenRemote}
                    onChange={(e) => setTokenRemote(e.target.value)}
                    placeholder={tokenProvider === "onedrive" ? "例如：od_media" : "例如：media_drive"}
                  />
                </div>
              </>
            )}
            {mode === "token_existing" && (
              <div className="text-sm text-slate-500">
                账号：<span className="font-medium text-slate-800 dark:text-slate-200">{tokenName}</span>{" "}
                · {providerLabel(tokenProvider)} · remote{" "}
                <span className="font-mono text-xs">{tokenRemote}</span>
              </div>
            )}
            <div>
              <label className="label">Token JSON</label>
              <textarea
                className="input min-h-[140px] font-mono text-xs"
                value={tokenText}
                onChange={(e) => setTokenText(e.target.value)}
                placeholder='{"access_token":"...","token_type":"Bearer","refresh_token":"...","expiry":"..."}'
                spellCheck={false}
              />
            </div>
            <button
              type="button"
              className="text-xs text-brand-600 underline"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "收起" : "高级：自定义 Client ID / Secret（可选）"}
            </button>
            {showAdvanced && (
              <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-xs text-slate-500">
                  留空则使用系统设置中的 Client，或 rclone 默认客户端。生产环境建议使用自己的 Client
                  ID。
                </p>
                <div>
                  <label className="label">Client ID</label>
                  <input
                    className="input font-mono text-xs"
                    value={tokenClientId}
                    onChange={(e) => setTokenClientId(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Client Secret</label>
                  <input
                    className="input font-mono text-xs"
                    type="password"
                    value={tokenClientSecret}
                    onChange={(e) => setTokenClientSecret(e.target.value)}
                  />
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={closeModal}>
                取消
              </button>
              <button
                className="btn-primary"
                disabled={
                  busy || !tokenText.trim() || (mode === "token" && !tokenName.trim())
                }
                onClick={submitToken}
              >
                {busy ? "提交中…" : "保存并测试"}
              </button>
            </div>
          </div>
        )}

        {mode === "import" && (
          <div className="space-y-4">
            <Alert type="info">
              粘贴完整 <code className="font-mono text-xs">rclone.conf</code>，或单个{" "}
              <code className="font-mono text-xs">[remote]</code> 段。支持{" "}
              <code className="font-mono text-xs">type = drive</code> 与{" "}
              <code className="font-mono text-xs">type = onedrive</code>。
            </Alert>
            <div>
              <label className="label">rclone 配置内容</label>
              <textarea
                className="input min-h-[160px] font-mono text-xs"
                value={configText}
                onChange={(e) => {
                  setConfigText(e.target.value);
                  setPreview([]);
                  setSelected({});
                }}
                placeholder={`[gdrive]\ntype = drive\ntoken = {...}\n\n[onedrive]\ntype = onedrive\ntoken = {...}\ndrive_id = ...\ndrive_type = personal`}
                spellCheck={false}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-secondary"
                disabled={busy || !configText.trim()}
                onClick={previewImport}
              >
                解析配置
              </button>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                />
                覆盖已存在同名 remote
              </label>
            </div>
            {preview.length > 0 && (
              <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="text-sm font-medium">选择要导入的 remote</div>
                {preview.map((r) => (
                  <label
                    key={r.remote_name}
                    className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={!!selected[r.remote_name]}
                      onChange={(e) =>
                        setSelected((s) => ({ ...s, [r.remote_name]: e.target.checked }))
                      }
                    />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-medium">{r.remote_name}</span>
                        <span className={clsx("badge", providerBadgeClass(r.type))}>
                          {providerLabel(r.type)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        token: {r.has_token ? "有" : "无"} · client_id:{" "}
                        {r.has_client_id ? "有" : "无"}
                        {r.root_folder_id ? ` · root: ${r.root_folder_id}` : ""}
                        {r.drive_id ? ` · drive_id: ${r.drive_id.slice(0, 12)}…` : ""}
                        {r.drive_type ? ` · ${r.drive_type}` : ""}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={closeModal}>
                取消
              </button>
              <button
                className="btn-primary"
                disabled={busy || preview.length === 0 || !Object.values(selected).some(Boolean)}
                onClick={submitImport}
              >
                {busy ? "导入中…" : "导入所选"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
