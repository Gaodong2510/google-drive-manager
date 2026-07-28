import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

const Ctx = createContext<{ theme: Theme; toggle: () => void } | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("gdm_theme") as Theme | null;
    if (saved) return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("gdm_theme", theme);
    // Keep body/WebView backdrop in sync (inline FOUC styles + Android WebView)
    document.body.style.backgroundColor = theme === "dark" ? "#0b1220" : "#f1f5f9";
    document.body.style.color = theme === "dark" ? "#e2e8f0" : "#1e293b";
    const meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0f172a" : "#f1f5f9");
    // Notify Android WebView shell to recolor chrome (status/nav/WebView bg)
    try {
      const bridge = (window as unknown as { CB?: { setNativeChrome?: (n: number) => void } }).CB;
      bridge?.setNativeChrome?.(theme === "dark" ? 1 : 0);
    } catch {
      /* ignore */
    }
  }, [theme]);

  return (
    <Ctx.Provider value={{ theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme outside provider");
  return ctx;
}
