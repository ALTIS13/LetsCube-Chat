"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { usePwaServiceWorker } from "@/hooks/usePwa";
import { isNativeAndroid, isNativeApp } from "@/lib/platform/capabilities";
import { isDesktopApp } from "@/lib/platform/desktop";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type ConnectionState = "hidden" | "offline" | "online";

export function PwaRuntime() {
  usePwaServiceWorker();
  useEffect(() => {
    if (isNativeApp() || isDesktopApp() || !("serviceWorker" in navigator)) return;
    let previousUserId: string | null = null;
    const { data: { subscription } } = createClient().auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user?.id ?? null;
      const accountExited = event === "SIGNED_OUT";
      const accountSwitched = event === "SIGNED_IN" && previousUserId !== null && nextUserId !== previousUserId;
      previousUserId = nextUserId;
      if (accountExited || accountSwitched) void clearBrowserPushForAccountExit();
    });
    return () => subscription.unsubscribe();
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    if (!root.hasAttribute("data-ios-standalone") || !viewport) return;

    // Every full-height page reads this token. In some iOS Home Screen builds,
    // 100vh reaches the physical screen while the WebKit paintable viewport
    // ends about 60pt earlier. innerHeight is that paintable edge at rest;
    // visualViewport may be shorter even when the canvas is not, so use it
    // only while the keyboard genuinely occupies the viewport.
    let restingHeight = viewport.height;
    let restingWidth = viewport.width;
    let keyboardWasVisible = false;
    const update = () => {
      const height = viewport.height;
      if (!Number.isFinite(height) || height <= 0) return;
      const active = document.activeElement;
      const editableFocused = active instanceof HTMLElement
        && (active.matches("input, textarea") || active.isContentEditable);
      if (Math.abs(viewport.width - restingWidth) > 1) {
        restingWidth = viewport.width;
        // A rotation can change width and the keyboard-shrunken heights in one
        // event. Do not learn that keyboard height as the new idle baseline.
        if (!keyboardWasVisible || !editableFocused) restingHeight = height;
      } else if ((keyboardWasVisible && !editableFocused) || height >= restingHeight - 80) {
        restingHeight = height;
      }

      const keyboardVisible = Math.max(window.innerHeight - height, restingHeight - height) > 80;
      keyboardWasVisible = keyboardVisible;
      const appHeight = keyboardVisible ? height : window.innerHeight;
      if (!Number.isFinite(appHeight) || appHeight <= 0) return;
      root.style.setProperty("--kub-app-height", `${Math.round(appHeight)}px`);
      const pageTop = Number.isFinite(viewport.pageTop) ? viewport.pageTop : 0;
      const bodyTop = document.body.getBoundingClientRect().top;
      const pan = keyboardVisible ? Math.max(0, Math.round(pageTop), Math.round(-bodyTop)) : 0;
      root.style.setProperty("--kub-app-top", `${pan}px`);
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      root.style.removeProperty("--kub-app-height");
      root.style.removeProperty("--kub-app-top");
    };
  }, []);
  return <ConnectionStatusBanner />;
}

async function clearBrowserPushForAccountExit(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    if (!registration) return;
    // Closing cards is best effort: a provider can still deliver an accepted
    // push afterward, so the server must send only neutral display content.
    try {
      (await registration.getNotifications()).forEach((card) => card.close());
    } catch {
      // Unsupported presentation cleanup must not prevent unsubscribing.
    }
    await (await registration.pushManager.getSubscription())?.unsubscribe();
  } catch {
    // Sign-out must succeed even when the push service is unavailable.
  }
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
