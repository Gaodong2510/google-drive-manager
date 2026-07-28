import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import { ThemeProvider } from "./lib/theme";
import "./index.css";

// Auto-update service worker when a new build is deployed
registerSW({
  immediate: true,
  onRegisteredSW(swUrl, registration) {
    if (!registration) return;
    // Check for updates periodically (admin panel, keep shell fresh)
    setInterval(() => {
      registration.update().catch(() => undefined);
    }, 60 * 60 * 1000);
    console.info("[PWA] service worker registered:", swUrl);
  },
  onOfflineReady() {
    console.info("[PWA] app shell ready for offline (API still needs network)");
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
