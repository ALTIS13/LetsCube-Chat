import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { initMonitoring } from "@/lib/monitoring";
import { applyDesktopShellAttribute } from "@/lib/platform/desktop";
import "./index.css";

initMonitoring();
// Before the first render: the Windows shell's own buttons take the top 2rem of
// the window, and every surface pinned to that edge reads it from CSS.
applyDesktopShellAttribute();

const rootElement = document.getElementById("root")!;
rootElement.dataset.kubBootId = createBootId();

createRoot(rootElement).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);

function createBootId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
