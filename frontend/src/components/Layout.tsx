import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  HardDrive,
  LayoutDashboard,
  Cloud,
  FolderOpen,
  Activity,
  Settings,
  Database,
  LogOut,
  Moon,
  Sun,
  Menu,
  X,
  Shield,
  BookOpen,
  CloudUpload,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import clsx from "clsx";

const nav = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/accounts", icon: Cloud, label: "Drive 账号" },
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

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Sidebar */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 w-64 transform border-r border-slate-200 bg-white transition-transform dark:border-slate-800 dark:bg-slate-900 lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-5 dark:border-slate-800">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-indigo-600 text-white shadow">
            <HardDrive size={18} />
          </div>
          <div>
            <div className="text-sm font-semibold">Drive Manager</div>
            <div className="text-[11px] text-slate-400">rclone · Emby / Plex</div>
          </div>
          <button className="ml-auto rounded-lg p-1 lg:hidden" onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <nav className="space-y-1 p-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  isActive
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                )
              }
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 border-t border-slate-200 p-4 dark:border-slate-800">
          <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
            <Shield size={14} />
            <span>{user?.username}</span>
          </div>
          <button
            className="btn-ghost w-full justify-start"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            <LogOut size={16} /> 退出登录
          </button>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
          <button className="btn-ghost lg:hidden" onClick={() => setOpen(true)}>
            <Menu size={18} />
          </button>
          <div className="text-sm font-medium text-slate-500 dark:text-slate-400">Google Drive 挂载管理平台</div>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn-ghost" onClick={toggle} title="切换主题">
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 animate-fade-in">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
