import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  HardDrive,
  LayoutDashboard,
  FolderOpen,
  Activity,
  Settings,
  Database,
  LogOut,
  Moon,
  Sun,
  Menu,
  X,
  BookOpen,
  CloudUpload,
  User,
  Cloud,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { GdmLogo } from "./BrandIcons";
import PwaInstall from "./PwaInstall";
import clsx from "clsx";

const nav = [
  { to: "/", icon: LayoutDashboard, label: "总览" },
  { to: "/accounts", icon: Cloud, label: "云盘账号" },
  { to: "/mounts", icon: HardDrive, label: "挂载管理" },
  { to: "/files", icon: FolderOpen, label: "文件浏览" },
  { to: "/uploads", icon: CloudUpload, label: "上传进度" },
  { to: "/cache", icon: Database, label: "缓存管理" },
  { to: "/tasks", icon: Activity, label: "任务日志" },
  { to: "/settings", icon: Settings, label: "系统设置" },
  { to: "/help", icon: BookOpen, label: "使用帮助" },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const initial = (user?.username || "A").slice(0, 1).toUpperCase();

  return (
    <div className="flex min-h-screen">
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-[260px] transform flex-col border-r border-slate-200 bg-white transition-transform dark:border-slate-800 dark:bg-slate-900 lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-slate-200/80 px-5 dark:border-slate-800/80">
          <GdmLogo size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold tracking-tight">GDM</div>
            <div className="truncate text-[11px] text-slate-400">Cloud Drive Manager</div>
          </div>
          <button
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            导航
          </div>
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                clsx("nav-item", isActive ? "nav-item-active" : "nav-item-idle")
              }
            >
              <item.icon size={18} className="shrink-0 opacity-90" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-200/80 p-4 dark:border-slate-800/80">
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-slate-50/80 px-3 py-2.5 dark:bg-slate-800/50">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-indigo-600 text-sm font-semibold text-white shadow-sm">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{user?.username}</div>
              <div className="text-[11px] text-slate-400">管理员</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-ghost flex-1 !justify-center !px-2 !py-2 text-xs"
              onClick={() => {
                setOpen(false);
                navigate("/settings");
              }}
              title="账号设置"
            >
              <User size={15} /> 账号
            </button>
            <button
              className="btn-ghost flex-1 !justify-center !px-2 !py-2 text-xs text-rose-600 dark:text-rose-400"
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              <LogOut size={15} /> 退出
            </button>
          </div>
        </div>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-20 flex h-16 items-center gap-3 border-b px-4 md:px-6">
          <button className="btn-ghost !p-2 lg:hidden" onClick={() => setOpen(true)}>
            <Menu size={18} />
          </button>
          <div className="hidden min-w-0 sm:block">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
              云盘挂载管理面板
            </div>
            <div className="text-[11px] text-slate-400">Google Drive · OneDrive · rclone VFS</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              className="btn-ghost !p-2.5"
              onClick={toggle}
              title={theme === "dark" ? "切换浅色" : "切换深色"}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>
        <main className="page-shell flex-1 p-4 md:p-6 animate-fade-in">
          <Outlet />
        </main>
        <PwaInstall />
      </div>
    </div>
  );
}
