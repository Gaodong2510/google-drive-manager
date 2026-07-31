/** Brand SVGs: cloud providers + CloudBridge product mark. */

import clsx from "clsx";

type IconProps = {
  className?: string;
  size?: number;
};

/** Google Drive colored triangle logo */
export function GoogleDriveIcon({ className, size = 20 }: IconProps) {
  return (
    <svg viewBox="0 0 87.3 78" width={size} height={size} className={className} aria-hidden>
      <path
        d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z"
        fill="#0066da"
      />
      <path
        d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z"
        fill="#00ac47"
      />
      <path
        d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z"
        fill="#ea4335"
      />
      <path
        d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z"
        fill="#00832d"
      />
      <path
        d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"
        fill="#2684fc"
      />
      <path
        d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
        fill="#ffba00"
      />
    </svg>
  );
}

/** Microsoft OneDrive cloud logo */
export function OneDriveIcon({ className, size = 20 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden fill="none">
      <path
        d="M18.5 18.5H7.25C4.35 18.5 2 16.15 2 13.25c0-2.55 1.85-4.7 4.3-5.15C7.05 5.45 9.35 3.5 12.1 3.5c2.55 0 4.75 1.65 5.55 3.95 2.3.35 4.1 2.35 4.1 4.75 0 2.65-2.15 4.8-4.75 4.8z"
        fill="#0078D4"
      />
      <path
        d="M7.25 18.5h11.25c1.8 0 3.35-1 4.15-2.45-.55.2-1.15.3-1.75.3H7.4c-2.15 0-3.95-1.45-4.55-3.4-.35 1.55.15 3.2 1.3 4.35.8.85 1.9 1.2 3.1 1.2z"
        fill="#1490DF"
        opacity="0.9"
      />
      <path
        d="M17.65 7.45C16.85 5.15 14.65 3.5 12.1 3.5c-1.85 0-3.5.9-4.55 2.25 1.7.15 3.2.95 4.15 2.2 1.05-1.15 2.55-1.9 4.25-1.9.55 0 1.1.1 1.6.25.05-.05.05-.1.1-.15z"
        fill="#28A8EA"
      />
    </svg>
  );
}

/**
 * 123 云盘 mark — clean cloud + orange accent (no cramped digit glyphs).
 * WebView-safe pure shapes. Unique gradient ids per size instance.
 */
export function Pan123Icon({ className, size = 20 }: IconProps) {
  const gid = `p123-${size}`;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FF8A3D" />
          <stop offset="100%" stopColor="#FF5A00" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="6" fill={`url(#${gid})`} />
      <path
        d="M7.2 15.2h9.8c1.7 0 3-1.25 3-2.85 0-1.45-1.05-2.65-2.45-2.85C17.2 7.7 15.7 6.4 13.85 6.4c-1.55 0-2.9.85-3.55 2.1-.45-.3-1-.45-1.6-.45-1.55 0-2.8 1.2-2.8 2.7 0 .2.02.4.06.58C4.5 11.55 3.5 12.7 3.5 14.1c0 1.4 1.15 2.55 2.55 2.55.35 0 .7-.06 1.05-.2.05-.08.1-.16.1-.25z"
        fill="white"
        fillOpacity="0.95"
      />
      <circle cx="9" cy="13.6" r="1.15" fill="#FF6A00" />
      <circle cx="12" cy="13.6" r="1.15" fill="#FF6A00" />
      <circle cx="15" cy="13.6" r="1.15" fill="#FF6A00" />
    </svg>
  );
}

/** Normalize provider id for icon lookup (handle aliases / missing values). */
export function normalizeProvider(provider?: string | null, hint?: string | null): string {
  const p = (provider || "").trim().toLowerCase();
  if (p === "onedrive" || p === "one_drive" || p === "microsoft") return "onedrive";
  if (p === "123pan" || p === "webdav" || p === "123" || p === "pan123") return "123pan";
  if (p === "drive" || p === "gdrive" || p === "google" || p === "google_drive") return "drive";
  const h = (hint || "").toLowerCase();
  if (/123|webdav/.test(h)) return "123pan";
  if (/onedrive|one drive/.test(h)) return "onedrive";
  return p || "drive";
}

/**
 * CloudBridge product mark — cloud linked to local mount (bridge).
 * Unique gradient ids so multiple instances on one page don't clash.
 */
export function AppLogo({ className, size = 28 }: IconProps) {
  const uid = `cb${size}`;
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={className} aria-hidden>
      <defs>
        <linearGradient id={`${uid}-bg`} x1="8%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="45%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
        <linearGradient id={`${uid}-shine`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id={`${uid}-soft`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="#0f172a" floodOpacity="0.18" />
        </filter>
      </defs>

      {/* App tile */}
      <rect width="48" height="48" rx="13" fill={`url(#${uid}-bg)`} />
      <rect width="48" height="48" rx="13" fill={`url(#${uid}-shine)`} />

      {/* Soft inner frame */}
      <rect
        x="1.25"
        y="1.25"
        width="45.5"
        height="45.5"
        rx="11.75"
        fill="none"
        stroke="white"
        strokeOpacity="0.18"
        strokeWidth="1"
      />

      {/* Cloud (top) */}
      <g filter={`url(#${uid}-soft)`} fill="white" fillOpacity="0.96">
        <ellipse cx="18.5" cy="18.5" rx="5.2" ry="4.6" />
        <ellipse cx="24.5" cy="16.2" rx="6.4" ry="5.5" />
        <ellipse cx="30.2" cy="18.8" rx="5" ry="4.4" />
        <rect x="14.2" y="18.2" width="19.6" height="6.2" rx="3.1" />
      </g>

      {/* Bridge arc: cloud → local */}
      <path
        d="M24 25.5 C24 29.5 24 31.5 24 34"
        fill="none"
        stroke="white"
        strokeOpacity="0.55"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="0.1 3.2"
      />

      {/* Local mount / disk stack */}
      <g fill="white">
        <ellipse cx="24" cy="35.2" rx="9.2" ry="2.6" fillOpacity="0.35" />
        <ellipse cx="24" cy="34.2" rx="9.2" ry="2.6" fillOpacity="0.55" />
        <ellipse cx="24" cy="33.2" rx="9.2" ry="2.6" fillOpacity="0.95" />
        {/* center hub */}
        <circle cx="24" cy="33.2" r="1.35" fill={`url(#${uid}-bg)`} fillOpacity="0.9" />
      </g>
    </svg>
  );
}

/** @deprecated use AppLogo */
export const GdmLogo = AppLogo;

export function ProviderIcon({
  provider,
  size = 20,
  className,
  hint,
}: {
  provider?: string | null;
  size?: number;
  className?: string;
  /** Optional name/path hint when provider field is missing or wrong */
  hint?: string | null;
}) {
  const p = normalizeProvider(provider, hint);
  if (p === "onedrive") {
    return <OneDriveIcon size={size} className={className} />;
  }
  if (p === "123pan") {
    return <Pan123Icon size={size} className={className} />;
  }
  return <GoogleDriveIcon size={size} className={className} />;
}

export function providerLabel(provider?: string | null, hint?: string | null): string {
  const p = normalizeProvider(provider, hint);
  if (p === "onedrive") return "OneDrive";
  if (p === "123pan") return "123云盘";
  return "Google Drive";
}

export function ProviderMark({
  provider,
  size = 36,
  className,
  hint,
}: {
  provider?: string | null;
  size?: number;
  className?: string;
  hint?: string | null;
}) {
  const p = normalizeProvider(provider, hint);
  const isOd = p === "onedrive";
  const is123 = p === "123pan";
  // 123 icon already has its own tile; render full-bleed without nested box tint
  if (is123) {
    return (
      <div
        className={clsx("flex shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-sm", className)}
        style={{ width: size, height: size }}
      >
        <ProviderIcon provider={p} size={size} />
      </div>
    );
  }
  return (
    <div
      className={clsx(
        "flex shrink-0 items-center justify-center rounded-xl border shadow-sm",
        isOd
          ? "border-sky-200 bg-sky-50 dark:border-sky-800 dark:bg-slate-800"
          : "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-slate-800",
        className
      )}
      style={{ width: size, height: size }}
    >
      <ProviderIcon provider={p} size={Math.round(size * 0.55)} />
    </div>
  );
}
