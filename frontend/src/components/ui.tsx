import clsx from "clsx";
import { statusMeta, formatBytes } from "../lib/api";
import { Loader2, X } from "lucide-react";
import React from "react";

export function StatusBadge({ status }: { status: string }) {
  const m = statusMeta(status);
  return (
    <span className={clsx("badge", m.color)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

export function ProgressBar({
  value,
  color = "bg-brand-500",
}: {
  value: number;
  color?: string;
}) {
  const v = Math.min(100, Math.max(0, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div
        className={clsx("h-full rounded-full transition-all duration-500", color)}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

export function StatCard({
  title,
  value,
  sub,
  icon,
  accent,
}: {
  title: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="card animate-slide-up group">
      <div className="mb-3 flex items-start justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
        {icon && (
          <div
            className={clsx(
              "rounded-xl p-2.5 transition group-hover:scale-105",
              accent || "bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300"
            )}
          >
            {icon}
          </div>
        )}
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      {sub && <div className="mt-1.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function Loading({ label = "加载中..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-500">
      <div className="rounded-2xl bg-white/80 p-4 shadow-soft dark:bg-slate-900/80">
        <Loader2 className="animate-spin text-brand-500" size={22} />
      </div>
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function Empty({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="card py-16 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800">
        <span className="text-lg">∅</span>
      </div>
      <div className="text-lg font-semibold text-slate-700 dark:text-slate-200">{title}</div>
      {desc && <div className="mx-auto mt-2 max-w-md text-sm text-slate-500">{desc}</div>}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
  /** When true, clicking the dimmed backdrop closes the modal (default true). */
  closeOnBackdrop = true,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  closeOnBackdrop?: boolean;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Prevent background scroll while modal open (esp. App WebView)
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-slate-900/55 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onClick={() => {
        if (closeOnBackdrop) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          "flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-200/80 bg-white shadow-2xl animate-slide-up dark:border-slate-700 dark:bg-slate-900 sm:rounded-2xl",
          wide ? "max-w-3xl" : "max-w-lg"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
          <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
          <button
            type="button"
            className="btn-ghost !p-2"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Alert({
  type = "info",
  children,
}: {
  type?: "info" | "warning" | "error" | "success";
  children: React.ReactNode;
}) {
  const colors = {
    info: "bg-sky-50/90 text-sky-800 border-sky-200/80 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900",
    warning:
      "bg-amber-50/90 text-amber-800 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900",
    error:
      "bg-rose-50/90 text-rose-800 border-rose-200/80 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900",
    success:
      "bg-emerald-50/90 text-emerald-800 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900",
  };
  return <div className={clsx("rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed", colors[type])}>{children}</div>;
}

export function UsageBar({
  used,
  total,
  label,
}: {
  used?: number | null;
  total?: number | null;
  label?: string;
}) {
  const pct = used != null && total ? (used / total) * 100 : 0;
  const color = pct >= 90 ? "bg-rose-500" : pct >= 80 ? "bg-amber-500" : "bg-brand-500";
  return (
    <div>
      {label && (
        <div className="mb-1 flex justify-between text-xs text-slate-500">
          <span>{label}</span>
          <span>
            {formatBytes(used)} / {formatBytes(total)} ({pct.toFixed(0)}%)
          </span>
        </div>
      )}
      <ProgressBar value={pct} color={color} />
    </div>
  );
}

export function PageHeader({
  title,
  desc,
  actions,
}: {
  title: string;
  desc?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
        {desc && <p className="mt-1.5 max-w-2xl text-sm text-slate-500">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
