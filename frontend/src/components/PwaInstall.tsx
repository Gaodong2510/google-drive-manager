import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Lightweight PWA install chip. Chrome/Android fire beforeinstallprompt;
 * iOS Safari users get a short tip instead.
 */
export default function PwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosTip, setIosTip] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("gdm_pwa_install_dismissed") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);

    const isIos =
      /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      !(window as unknown as { MSStream?: unknown }).MSStream;
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isIos && !isStandalone) setIosTip(true);

    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  if (hidden || (!deferred && !iosTip)) return null;
  if (window.matchMedia("(display-mode: standalone)").matches) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem("gdm_pwa_install_dismissed", "1");
    } catch {
      /* ignore */
    }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* ignore */
    }
    setDeferred(null);
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-md animate-slide-up sm:left-auto sm:right-6">
      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-indigo-600 text-white">
          <Download size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">安装 GDM 到主屏幕</div>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            {deferred
              ? "像 App 一样全屏使用，方便随时管理云盘挂载。"
              : "在 Safari 点分享 →「添加到主屏幕」即可安装。"}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {deferred && (
              <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={install}>
                安装
              </button>
            )}
            <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={dismiss}>
              稍后
            </button>
          </div>
        </div>
        <button
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
          onClick={dismiss}
          aria-label="关闭"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
