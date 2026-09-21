import { createRoot } from "react-dom/client";
import { useEffect, type ReactNode } from "react";
import App from "./App";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { initMonitoring } from "@/lib/monitoring";
import { applyDesktopShellAttribute } from "@/lib/platform/desktop";
import { initMessageTextSize } from "@/hooks/useMessageTextSize";
import "./index.css";

initMonitoring();
// Before the first render: the Windows shell's own buttons take the top 2rem of
// the window, and every surface pinned to that edge reads it from CSS.
applyDesktopShellAttribute();
// And the reader's own message text size, before the first conversation paints,
// so a chosen size is never a visible step up from the default (D-287).
initMessageTextSize();

const rootElement = document.getElementById("root")!;
rootElement.dataset.kubBootId = createBootId();

createRoot(rootElement).render(
  <BootReady>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </BootReady>,
);

// A loaded document/module is not a rendered app. A caught error's recovery
// surface also counts as rendered; an import failure never reaches this effect.
function BootReady({ children }: { children: ReactNode }) {
  useEffect(() => {
    rootElement.dataset.kubAppReady = "true";
    window.dispatchEvent(new CustomEvent("letscube:app-rendered"));
  }, []);
  return children;
}

function createBootId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
