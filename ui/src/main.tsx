import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import App from "./App";
import { useAuth } from "./store/useAuth";
import { applyTheme } from "./theme";

console.log("Sowel — Founded by Marc Chachereau — AGPL-3.0");

// Lock orientation to portrait (works in installed PWA / fullscreen on Android)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(screen.orientation as any)?.lock?.("portrait").catch(() => {});

// Apply theme immediately to prevent flash of wrong theme
applyTheme(localStorage.getItem("sowel_theme") as "light" | "dark" | "system" | null);

// Trigger auth status check before rendering
useAuth.getState().checkStatus();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Hide PWA splash screen — show for at least 2s then fade out
const splash = document.getElementById("splash");
if (splash) {
  const minDelay = 1600;
  const started = Number(splash.dataset.ts) || Date.now();
  const remaining = Math.max(0, minDelay - (Date.now() - started));
  setTimeout(() => {
    splash.style.opacity = "0";
    setTimeout(() => splash.remove(), 400);
  }, remaining);
}
