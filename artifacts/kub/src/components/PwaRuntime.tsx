"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { usePwaServiceWorker } from "@/hooks/usePwa";
import { isNativeAndroid } from "@/lib/platform/capabilities";
import { cn } from "@/lib/utils";

type ConnectionState = "hidden" | "offline" | "online";

export function PwaRuntime() {
  usePwaServiceWorker();
  return <ConnectionStatusBanner />;
}

function ConnectionStatusBanner() {
  const nativeAndroid = isNativeAndroid();
  const [state, setState] = useState<ConnectionState>(() =>
    typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "hidden",
  );

  useLayoutEffect(() => {
    if (!nativeAndroid) return;
    document.documentElement.classList.toggle("kub-android-connection-visible", state !== "hidden");
    return () => document.documentElement.classList.remove("kub-android-connection-visible");
  }, [nativeAndroid, state]);

  useEffect(() => {
    let hideTimer: number | undefined;
    const clearHideTimer = () => {
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      hideTimer = undefined;
    };

    const handleOffline = () => {
      clearHideTimer();
      setState("offline");
    };
    const handleOnline = () => {
      clearHideTimer();
      setState("online");
      hideTimer = window.setTimeout(() => setState("hidden"), 2800);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    if (navigator.onLine === false) handleOffline();

    return () => {
      clearHideTimer();
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (state === "hidden") return null;

  const offline = state === "offline";

  return (
    <div
      data-testid="connection-status-banner"
      data-state={state}
      role="status"
      aria-live="polite"
      className={cn(
        // Above the home indicator rather than on it: the offset is measured
        // from the top of the unsafe area, which is the screen edge wherever
        // there is none.
        "kub-connection-status-banner fixed left-1/2 z-[85] -translate-x-1/2 rounded-2xl border shadow-2xl",
        offline ? "kub-connection-status-offline" : "kub-connection-status-online",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full",
            offline ? "bg-[var(--kub-danger)]" : "bg-[var(--kub-cyan)]",
          )}
        />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[color:var(--kub-text)]">
            {offline ? "Нет подключения" : "Подключение восстановлено"}
          </div>
          <div className="kub-connection-status-detail mt-0.5 text-xs leading-relaxed text-[color:var(--kub-muted)]">
            {offline
              ? "Проверьте сеть. Черновики и подготовленные вложения останутся на месте."
              : "LETSCUBE снова синхронизируется с сервером."}
          </div>
        </div>
      </div>
    </div>
  );
}
