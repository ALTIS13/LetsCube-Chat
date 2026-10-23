import React from "react";
import { createRoot } from "react-dom/client";
import { OfflineHistoryStatus } from "../../artifacts/kub/src/components/chat/OfflineHistoryStatus";
import { applyResolvedTheme } from "../../artifacts/kub/src/lib/themeRuntime";
import "../../artifacts/kub/src/index.css";

const theme = new URL(location.href).searchParams.get("theme") === "light" ? "light" : "dark";
applyResolvedTheme(theme);
const root = document.getElementById("preview");
if (!root) throw Error("PREVIEW_ROOT_REQUIRED");
createRoot(root).render(
  <main className="chat-bg relative h-dvh w-full bg-[var(--kub-bg)] text-[var(--kub-text)]">
    <header className="h-16 border-b border-[var(--kub-border-color)] px-5 py-5 text-sm">LETSCUBE</header>
    <OfflineHistoryStatus topInset={64} />
  </main>,
);
