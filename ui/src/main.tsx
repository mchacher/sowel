import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import App from "./App";
import { useAuth } from "./store/useAuth";

console.log("Winch — Founded by Marc Chachereau — AGPL-3.0");

// Trigger auth status check before rendering
useAuth.getState().checkStatus();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
