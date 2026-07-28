/** Official-style brand SVGs for cloud providers and the GDM product mark. */

import clsx from "clsx";

type IconProps = {
  className?: string;
  size?: number;
};

/** Google Drive colored triangle logo */
export function GoogleDriveIcon({ className, size = 20 }: IconProps) {
  return (
    <svg
      viewBox="0 0 87.3 78"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
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
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden
      fill="none"
    >
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

/** Product mark: stylized drive/mount glyph */
export function GdmLogo({ className, size = 28 }: IconProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id="gdm-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="55%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#gdm-grad)" />
      <path
        d="M11 24.5c0-1.4.5-2.6 1.4-3.5.9-.9 2.1-1.4 3.5-1.4h1.1c.4-2.4 2.5-4.2 5-4.2 2.8 0 5 2.2 5 5 1.9.2 3.5 1.8 3.5 3.8 0 2.1-1.7 3.8-3.8 3.8H15.8c-2.6 0-4.8-2.1-4.8-4.5z"
        fill="white"
        fillOpacity="0.95"
      />
      <path
        d="M14 27.5h12"
        stroke="url(#gdm-grad)"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.35"
      />
    </svg>
  );
}

export function ProviderIcon({
  provider,
  size = 20,
  className,
}: {
  provider?: string | null;
  size?: number;
  className?: string;
}) {
  if (provider === "onedrive") {
    return <OneDriveIcon size={size} className={className} />;
  }
  return <GoogleDriveIcon size={size} className={className} />;
}

export function ProviderMark({
  provider,
  size = 36,
  className,
}: {
  provider?: string | null;
  size?: number;
  className?: string;
}) {
  const isOd = provider === "onedrive";
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
      <ProviderIcon provider={provider} size={Math.round(size * 0.52)} />
    </div>
  );
}
