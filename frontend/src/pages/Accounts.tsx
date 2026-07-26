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
import type { DriveAccount } from "../lib/types";
import { Alert, Empty, Loading, Modal, PageHeader, StatusBadge, UsageBar } from "../components/ui";

type RcloneRemotePreview = {
  remote_name: string;
  type: string;
  has_token: boolean;
  has_client_id: boolean;
  has_client_secret: boolean;
  root_folder_id?: string | null;
  team_drive?: string | null;
  scope?: string | null;
};

type AuthMode = "create" | "token" | "import" | "token_existing" | null;

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

  // paste token
  const [tokenText, setTokenText] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [tokenRemote, setTokenRemote] = useState("");
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
    setTokenText("");
    setTokenName("");
    setTokenRemote("");
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
      await api.post("/accounts", { name: name.trim(), remote_name: remote.trim() || undefined });
      closeModal();
      await load();
      setMsg("账号已创建，请用「粘贴 Token」或「OAuth 授权」完成授权");
    } catch (e: any) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const startOAuth = async (id: number) => {
    setBusy(true);
    setError("");
    try {
      const res = await api.post<{ authorize_url: string }>(`/accounts/${id}/oauth/start`);
      window.open(res.authorize_url, "gdm_oauth", "width=600,height=720");
      setMsg("已打开 Google 授权窗口，完成后请刷新列表");
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
      setMsg(`解析到 ${res.count} 个 Drive remote`);
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
        title="Google Drive 账号"
        desc="支持粘贴 Token、导入 rclone 配置，或 Web OAuth 授权"
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

      <div className="mb-4">
        <Alert type="info">
          <strong>推荐</strong>：在有浏览器的电脑运行{" "}
          <code className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-slate-800">
            rclone authorize &quot;drive&quot;
          </code>
          ，把输出的 JSON 粘贴到「粘贴 Token」；或直接粘贴已有{" "}
          <code className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-slate-800">rclone.conf</code>{" "}
          导入。无需配置公网回调地址。详见{" "}
          <Link to="/help#connect" className="font-medium underline">
            使用帮助
          </Link>
          。
        </Alert>
      </div>

      {list.length === 0 ? (
        <Empty
          title="还没有 Google Drive 账号"
          desc="可直接「粘贴 Token」或「导入 rclone」，无需先创建空账号"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => (
            <div key={a.id} className="card flex flex-col">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{a.name}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{a.email || "未授权"}</div>
                </div>
                <StatusBadge status={a.status} />
              </div>
              <div className="mb-3 space-y-1 text-xs text-slate-500">
                <div>
                  Remote:{" "}
                  <span className="font-mono text-slate-700 dark:text-slate-300">{a.remote_name}</span>
                </div>
                <div>
                  挂载: {a.running_mounts}/{a.mount_count} 运行中
                </div>
                {a.last_check_at && <div>检测: {new Date(a.last_check_at).toLocaleString()}</div>}
              </div>
              {a.total_bytes != null && (
                <div className="mb-4">
                  <UsageBar used={a.used_bytes} total={a.total_bytes} label="容量" />
                  <div className="mt-1 text-xs text-slate-500">剩余 {formatBytes(a.free_bytes)}</div>
                </div>
              )}
              {a.last_error && <Alert type="error">{a.last_error}</Alert>}
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                <button
                  className="btn-primary !px-3 !py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => openPasteFor(a)}
                  title="推荐：本机 rclone authorize 后粘贴"
                >
                  <ClipboardPaste size={14} /> {a.has_token ? "粘贴 Token" : "粘贴 Token"}
                </button>
                <button
                  className="btn-secondary !px-3 !py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => startOAuth(a.id)}
                >
                  <Link2 size={14} /> {a.has_token ? "Web OAuth" : "Web OAuth"}
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
          ))}
        </div>
      )}

      <Modal open={mode !== null} title={modalTitle} onClose={closeModal}>
        {mode === "create" && (
          <div className="space-y-4">
            <Alert type="info">
              创建空账号后可用「粘贴 Token」或「Web OAuth」授权。若已有 Token，建议直接用右上角「粘贴
              Token」。
            </Alert>
            <div>
              <label className="label">显示名称</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：我的媒体库"
              />
            </div>
            <div>
              <label className="label">rclone Remote 名称（可选）</label>
              <input
                className="input"
                value={remote}
                onChange={(e) => setRemote(e.target.value)}
                placeholder="例如：media_drive"
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
            <Alert type="info">
              在本机执行：
              <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-2 font-mono text-xs text-emerald-300">
                rclone authorize &quot;drive&quot;
              </pre>
              浏览器登录后，把终端输出的 JSON（或整段粘贴文本）填到下方。
            </Alert>
            {mode === "token" && (
              <>
                <div>
                  <label className="label">显示名称</label>
                  <input
                    className="input"
                    value={tokenName}
                    onChange={(e) => setTokenName(e.target.value)}
                    placeholder="例如：我的媒体库"
                  />
                </div>
                <div>
                  <label className="label">rclone Remote 名称（可选）</label>
                  <input
                    className="input"
                    value={tokenRemote}
                    onChange={(e) => setTokenRemote(e.target.value)}
                    placeholder="例如：media_drive"
                  />
                </div>
              </>
            )}
            {mode === "token_existing" && (
              <div className="text-sm text-slate-500">
                账号：<span className="font-medium text-slate-800 dark:text-slate-200">{tokenName}</span>{" "}
                · remote{" "}
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
              <code className="font-mono text-xs">[remote]</code> 段。仅导入{" "}
              <code className="font-mono text-xs">type = drive</code> 的配置。
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
                placeholder={`[gdrive]\ntype = drive\nscope = drive\ntoken = {"access_token":"...","refresh_token":"..."}\nclient_id = ...\nclient_secret = ...`}
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
                <div className="text-sm font-medium">选择要导入的 Drive remote</div>
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
                      <div className="font-mono font-medium">{r.remote_name}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        token: {r.has_token ? "有" : "无"} · client_id:{" "}
                        {r.has_client_id ? "有" : "无"}
                        {r.root_folder_id ? ` · root: ${r.root_folder_id}` : ""}
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
