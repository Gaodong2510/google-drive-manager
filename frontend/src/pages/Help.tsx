import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Cloud,
  ExternalLink,
  HardDrive,
  HelpCircle,
  Settings,
  AlertTriangle,
} from "lucide-react";
import { PageHeader, Alert } from "../components/ui";
import clsx from "clsx";

function Section({
  id,
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  id: string;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section id={id} className="card !p-0 overflow-hidden scroll-mt-24">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
        onClick={() => setOpen((v) => !v)}
      >
        {icon && <span className="text-brand-600 dark:text-brand-400">{icon}</span>}
        <h2 className="flex-1 text-base font-semibold">{title}</h2>
        <ChevronDown size={18} className={clsx("text-slate-400 transition", open && "rotate-180")} />
      </button>
      {open && <div className="space-y-4 border-t border-slate-100 px-5 py-5 text-sm leading-relaxed text-slate-600 dark:border-slate-800 dark:text-slate-300">{children}</div>}
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
        {n}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-slate-800 dark:text-slate-100">{title}</div>
        <div className="mt-1 space-y-2">{children}</div>
      </div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800 dark:bg-slate-800 dark:text-emerald-300">
      {children}
    </code>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-slate-950 p-3 font-mono text-xs text-emerald-300 whitespace-pre-wrap">
      {children}
    </pre>
  );
}

export default function HelpPage() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const callback = useMemo(() => `${origin || "http://你的服务器IP:8787"}/api/oauth/callback`, [origin]);

  const toc = [
    { id: "connect", label: "连接 Google Drive" },
    { id: "mount", label: "创建与启动挂载" },
    { id: "emby", label: "Emby / Plex 使用" },
    { id: "faq", label: "常见问题" },
    { id: "ops", label: "运维与日志" },
    { id: "security", label: "安全建议" },
  ];

  return (
    <div>
      <PageHeader
        title="使用帮助"
        desc="从 Google OAuth 授权到挂载、媒体库接入的完整说明"
        actions={
          <a
            className="btn-secondary"
            href="https://console.cloud.google.com/"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={16} /> Google Cloud Console
          </a>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-[220px_1fr]">
        <aside className="card h-fit lg:sticky lg:top-20">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <BookOpen size={16} className="text-brand-600" />
            目录
          </div>
          <nav className="space-y-1 text-sm">
            {toc.map((t) => (
              <a
                key={t.id}
                href={`#${t.id}`}
                className="block rounded-lg px-2 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-brand-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {t.label}
              </a>
            ))}
          </nav>
          <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Link to="/settings" className="btn-secondary w-full !justify-start !text-xs">
              <Settings size={14} /> 系统设置
            </Link>
            <Link to="/accounts" className="btn-secondary w-full !justify-start !text-xs">
              <Cloud size={14} /> Drive 账号
            </Link>
            <Link to="/mounts" className="btn-secondary w-full !justify-start !text-xs">
              <HardDrive size={14} /> 挂载管理
            </Link>
          </div>
        </aside>

        <div className="space-y-4">
          <Alert type="info">
            Google Drive / OneDrive 都支持<strong>网页登录授权（Web OAuth）</strong>，体验类似 CloudDrive2：
            点按钮 → 浏览器登录 → 完成。回调地址：
            <div className="mt-2">
              <Code>{callback}</Code>
            </div>
            也可用「粘贴 Token」或「导入 rclone」，无需配置 OAuth 应用。
          </Alert>

          {/* 1. Connect */}
          <Section id="connect" title="一、如何连接 Google Drive / OneDrive" icon={<Cloud size={18} />}>
            <p className="text-slate-500">三种方式任选其一：</p>
            <Pre>{`方式 A  Web OAuth 网页登录（类似 CD2，推荐有域名时使用）
        Google → 系统设置填 Google Client
        OneDrive → 系统设置填 Azure 应用 Client
方式 B  本机 rclone authorize → 面板粘贴 Token
方式 C  粘贴 rclone.conf → 导入 remote
        ↓
「挂载管理」创建 → 启动`}</Pre>

            <h3 className="pt-2 font-semibold text-slate-800 dark:text-slate-100">
              OneDrive Web OAuth（Azure，约 3 分钟）
            </h3>
            <div className="space-y-4">
              <Step n={1} title="Azure 应用注册">
                <ol className="list-decimal space-y-1 pl-5">
                  <li>
                    打开{" "}
                    <a
                      className="text-brand-600 underline"
                      href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Azure 应用注册
                    </a>
                  </li>
                  <li>
                    新注册 → 支持账户类型选<strong>任何组织目录 + 个人 Microsoft 帐户</strong>
                  </li>
                  <li>
                    平台添加 <strong>Web</strong>，重定向 URI 填 <Code>{callback}</Code>
                  </li>
                  <li>
                    证书和密码 → 新建客户端密码，复制<strong>值</strong>（不是 Secret ID）
                  </li>
                  <li>
                    （可选）API 权限添加 Microsoft Graph 委托权限：
                    <code className="font-mono text-xs">Files.ReadWrite.All</code>、
                    <code className="font-mono text-xs">User.Read</code>、
                    <code className="font-mono text-xs">offline_access</code>、
                    <code className="font-mono text-xs">Sites.Read.All</code>
                  </li>
                </ol>
              </Step>
              <Step n={2} title="填入 GDM 系统设置">
                <p>
                  <Link className="text-brand-600 underline" to="/settings">
                    系统设置
                  </Link>{" "}
                  → Microsoft OAuth：填 Client ID、Secret、Redirect URI（Tenant 用 common）→ 保存
                </p>
              </Step>
              <Step n={3} title="账号页网页登录">
                <p>
                  <Link className="text-brand-600 underline" to="/accounts">
                    云盘账号
                  </Link>{" "}
                  → 添加 OneDrive 账号 → 点 <strong>Web OAuth</strong> → 微软登录同意 → 完成
                </p>
              </Step>
            </div>

            <h3 className="pt-4 font-semibold text-slate-800 dark:text-slate-100">
              方式 B：粘贴 Token（无需 Azure / Google Cloud）
            </h3>
            <div className="space-y-4">
              <Step n={1} title="在有浏览器的电脑安装 rclone">
                <p>
                  访问{" "}
                  <a className="text-brand-600 underline" href="https://rclone.org/downloads/" target="_blank" rel="noreferrer">
                    rclone.org/downloads
                  </a>
                  ，或：
                </p>
                <Pre>{"# Windows / macOS / Linux\ncurl https://rclone.org/install.sh | sudo bash"}</Pre>
              </Step>
              <Step n={2} title="本机授权">
                <Pre>{`# Google Drive\nrclone authorize "drive"\n\n# OneDrive\nrclone authorize "onedrive"`}</Pre>
                <p>浏览器打开登录页，同意后终端打印 JSON，整段粘贴到面板即可。</p>
              </Step>
              <Step n={3} title="粘贴到面板">
                <ol className="list-decimal space-y-1 pl-5">
                  <li>
                    打开 <Link className="text-brand-600 underline" to="/accounts">Drive 账号</Link> →{" "}
                    <strong>粘贴 Token</strong>
                  </li>
                  <li>填写显示名称，把 JSON 整段粘贴进去</li>
                  <li>点 <strong>保存并测试</strong></li>
                </ol>
                <Alert type="info">
                  可选：在高级选项里填自己的 Client ID / Secret（配额更稳）。留空则使用系统设置或
                  rclone 默认客户端。
                </Alert>
              </Step>
            </div>

            <h3 className="pt-2 font-semibold text-slate-800 dark:text-slate-100">
              方式 B：导入 rclone 配置
            </h3>
            <div className="space-y-4">
              <Step n={1} title="导出已有配置">
                <p>若你本机或其它服务器已配过 Drive：</p>
                <Pre>{"# 查看 remote 列表\nrclone listremotes\n\n# 打印配置（注意保密）\ncat ~/.config/rclone/rclone.conf\n# 或\nrclone config show 你的remote名"}</Pre>
              </Step>
              <Step n={2} title="导入到面板">
                <ol className="list-decimal space-y-1 pl-5">
                  <li>
                    <Link className="text-brand-600 underline" to="/accounts">Drive 账号</Link> →{" "}
                    <strong>导入 rclone</strong>
                  </li>
                  <li>粘贴完整 conf 或单个 <Code>[remote]</Code> 段</li>
                  <li>点 <strong>解析配置</strong>，勾选要导入的 drive remote</li>
                  <li>若 remote 名已存在，勾选「覆盖」后导入</li>
                </ol>
              </Step>
            </div>

            <h3 className="pt-2 font-semibold text-slate-800 dark:text-slate-100">
              方式 C：Web OAuth（需 Google Cloud）
            </h3>
            <div className="space-y-4">
              <Step n={1} title="打开 Google Cloud Console">
                <p>
                  访问{" "}
                  <a className="text-brand-600 underline" href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">
                    console.cloud.google.com
                  </a>
                  ，新建或选择一个项目。
                </p>
              </Step>
              <Step n={2} title="启用 Google Drive API">
                <p>
                  左侧 <strong>API 和服务 → 库</strong>，搜索并启用 <strong>Google Drive API</strong>。
                </p>
              </Step>
              <Step n={3} title="配置 OAuth 同意屏幕">
                <ul className="list-disc space-y-1 pl-5">
                  <li>用户类型选 <strong>外部</strong>（个人账号通常如此）</li>
                  <li>填写应用名称（如 Drive Manager）</li>
                  <li>测试阶段：把你的 Gmail 加到 <strong>测试用户</strong></li>
                </ul>
              </Step>
              <Step n={4} title="创建 OAuth 客户端 ID">
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    <strong>API 和服务 → 凭据 → 创建凭据 → OAuth 客户端 ID</strong>
                  </li>
                  <li>应用类型：<strong>Web 应用</strong></li>
                  <li>
                    <strong>已获授权的重定向 URI</strong> 添加（必须完全一致）：
                  </li>
                </ul>
                <Pre>{callback}</Pre>
                <Alert type="warning">
                  从公网访问面板时，不要用 <Code>127.0.0.1</Code> 作为回调地址，否则授权后会跳回你自己电脑而不是服务器。
                </Alert>
              </Step>
              <Step n={5} title="填到面板并授权">
                <ol className="list-decimal space-y-1 pl-5">
                  <li>
                    <Link className="text-brand-600 underline" to="/settings">系统设置</Link> 填写
                    Client ID / Secret / Redirect URI 并保存
                  </li>
                  <li>
                    <Link className="text-brand-600 underline" to="/accounts">Drive 账号</Link> →
                    添加账号 → <strong>Web OAuth</strong>
                  </li>
                  <li>
                    若提示「应用未验证」：点 <strong>高级 → 继续前往…</strong>
                  </li>
                </ol>
              </Step>
            </div>
          </Section>

          {/* 2. Mount */}
          <Section id="mount" title="二、创建与启动挂载" icon={<HardDrive size={18} />}>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                打开 <Link className="text-brand-600 underline" to="/mounts">挂载管理</Link> → <strong>创建挂载</strong>
              </li>
              <li>填写示例：</li>
            </ol>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-400 dark:bg-slate-950">
                  <tr>
                    <th className="px-3 py-2">项</th>
                    <th className="px-3 py-2">建议值</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  <tr>
                    <td className="px-3 py-2">名称</td>
                    <td className="px-3 py-2">
                      <Code>media_main</Code>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">账号</td>
                    <td className="px-3 py-2">刚授权成功的 Google Drive 账号</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">Remote 内路径</td>
                    <td className="px-3 py-2">空 = 整个盘；或填写文件夹如 Media</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">本地路径</td>
                    <td className="px-3 py-2">
                      <Code>/mnt/gdrive_media</Code>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">模式</td>
                    <td className="px-3 py-2">
                      <strong>媒体服务器模式</strong>（Emby/Plex 推荐）
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">开机自动恢复</td>
                    <td className="px-3 py-2">建议勾选</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ol className="list-decimal space-y-2 pl-5" start={3}>
              <li>
                创建后点击 <strong>启动</strong>
              </li>
              <li>
                状态变为 <strong>运行中</strong> 即挂载成功
              </li>
              <li>
                可在 <Link className="text-brand-600 underline" to="/files">文件浏览</Link> 中查看本地挂载目录
              </li>
            </ol>
            <Alert type="info">
              挂载路径需位于 <Code>/mnt</Code>、<Code>/media</Code>、<Code>/data</Code>、<Code>/opt</Code>、<Code>/srv</Code> 或{" "}
              <Code>/home</Code> 下，禁止挂到系统关键目录。
            </Alert>
          </Section>

          {/* 3. Emby */}
          <Section id="emby" title="三、Emby / Plex 如何使用" icon={<CheckCircle2 size={18} />}>
            <p>将媒体库路径指向挂载目录，例如：</p>
            <Pre>{`/mnt/gdrive_media/Movies
/mnt/gdrive_media/TV`}</Pre>
            <ul className="list-disc space-y-1 pl-5">
              <li>优先使用面板里的 <strong>媒体服务器模式</strong>（vfs-cache-mode full 等已优化）</li>
              <li>
                关注 <Link className="text-brand-600 underline" to="/cache">缓存管理</Link> 与 Dashboard 磁盘告警（80% / 90%）
              </li>
              <li>扫描间隔不要过密，减轻 API 与目录缓存压力</li>
              <li>保证缓存盘有足够空间，避免系统盘被 VFS Cache 写满</li>
            </ul>
          </Section>

          {/* 4. FAQ */}
          <Section id="faq" title="四、常见问题" icon={<HelpCircle size={18} />} defaultOpen={true}>
            <div className="space-y-3">
              {[
                {
                  q: "授权后跳转失败 / 无法连接？",
                  a: "Redirect URI 必须与 Google Cloud 控制台完全一致。公网访问请使用服务器 IP 或域名，不要用 127.0.0.1。",
                },
                {
                  q: "提示应用未验证？",
                  a: "测试阶段点「高级 → 继续」。或在 OAuth 同意屏幕把你的邮箱加为测试用户。",
                },
                {
                  q: "测试连接失败？",
                  a: "确认已启用 Google Drive API；重新执行 OAuth 授权；检查 Client ID/Secret 是否正确。",
                },
                {
                  q: "挂载启动失败？",
                  a: "打开挂载卡片「日志」查看 rclone 报错；确认 rclone 已安装（系统设置页可看版本）；确认账号已授权。",
                },
                {
                  q: "权限被拒？",
                  a: "Google 授权页需勾选 Drive 访问权限，并使用有该网盘权限的账号登录。",
                },
                {
                  q: "Watchdog 显示已暂停？",
                  a: "连续自动恢复失败达到上限。请检查网络与授权后，在挂载设置中取消暂停 / 手动重启挂载。",
                },
              ].map((item) => (
                <div key={item.q} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
                  <div className="flex items-start gap-2 font-medium text-slate-800 dark:text-slate-100">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
                    {item.q}
                  </div>
                  <p className="mt-1 pl-6 text-slate-500">{item.a}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* 5. Ops */}
          <Section id="ops" title="五、运维、日志与备份" icon={<BookOpen size={18} />} defaultOpen={false}>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">日志在哪里看？</h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                面板 <Link className="text-brand-600 underline" to="/tasks">任务日志</Link>：启停、Watchdog、OAuth 等
              </li>
              <li>挂载卡片 → 日志：单个 rclone mount 实时日志</li>
              <li>
                服务器：<Code>journalctl -u google-drive-manager -f</Code>
              </li>
              <li>
                文件：<Code>data/logs/mounts/mount_&lt;id&gt;.log</Code>
              </li>
            </ul>
            <h3 className="pt-2 font-semibold text-slate-800 dark:text-slate-100">备份与恢复</h3>
            <p>
              在 <Link className="text-brand-600 underline" to="/settings">系统设置</Link> 中可创建加密备份（账号、挂载、rclone 配置），并支持上传恢复。
            </p>
            <h3 className="pt-2 font-semibold text-slate-800 dark:text-slate-100">服务管理（SSH）</h3>
            <Pre>{`systemctl status google-drive-manager
systemctl restart google-drive-manager
systemctl stop google-drive-manager`}</Pre>
            <h3 className="pt-2 font-semibold text-slate-800 dark:text-slate-100">默认登录</h3>
            <p>
              用户名 <Code>admin</Code>，初始密码 <Code>admin123</Code>。登录后请尽快在系统设置中修改密码。
            </p>
          </Section>

          {/* 6. Security */}
          <Section id="security" title="六、安全建议" icon={<AlertTriangle size={18} />} defaultOpen={false}>
            <ul className="list-disc space-y-1 pl-5">
              <li>修改默认管理员密码</li>
              <li>生产环境建议 Nginx/Caddy 反代 + HTTPS</li>
              <li>面板端口尽量仅内网 / VPN 访问，或配合防火墙限制来源 IP</li>
              <li>Client Secret、Refresh Token 已加密存储，切勿把备份文件公开分享</li>
              <li>云厂商安全组需放行面板端口（默认 8787），仅对可信来源开放更佳</li>
            </ul>
          </Section>

          <div className="card text-center text-xs text-slate-400">
            Google Drive Manager 帮助文档 · 可在左侧菜单随时打开「使用帮助」
          </div>
        </div>
      </div>
    </div>
  );
}
