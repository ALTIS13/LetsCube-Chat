"use client";

import { useCallback, useEffect, useState } from "react";
import { reportError } from "@/lib/monitoring";
import { getCurrentDistributionTarget, isNativeApp, supportsPwaInstall } from "@/lib/platform/capabilities";
import { isDesktopApp } from "@/lib/platform/desktop";
import { getPwaInstallCopy } from "@/lib/pwa/installCopy";
import {
  nextHandoffDelay,
  pageEntryPath,
  requestHandoff,
  shouldAnnounceWaitingWorker,
} from "@/lib/pwa/serviceWorkerHandoff";

export const KUB_SW_UPDATE_READY_EVENT = "kub:sw-update-ready";
export const KUB_SW_CONTROLLER_CHANGED_EVENT = "kub:sw-controller-changed";
export const KUB_SW_SKIP_WAITING_MESSAGE = "KUB_SKIP_WAITING";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

let registrationStarted = false;

export function usePwaServiceWorker() {
  useEffect(() => {
    if (registrationStarted) return;
    if (isNativeApp() || isDesktopApp()) {
      if (typeof window !== "undefined" && "serviceWorker" in navigator) {
        void navigator.serviceWorker.getRegistrations()
          .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
          .catch((error) => {
            reportError(error, { category: "packaged_service_worker_cleanup" });
          });
      }
      return;
    }
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (!window.isSecureContext && window.location.hostname !== "localhost") return;

    registrationStarted = true;
    const base = import.meta.env.BASE_URL || "/";
    const scope = base.endsWith("/") ? base : `${base}/`;
    const swUrl = `${scope}sw.js`;

    const handleControllerChange = () => {
      window.dispatchEvent(new Event(KUB_SW_CONTROLLER_CHANGED_EVENT));
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    navigator.serviceWorker
      .register(swUrl, { scope })
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          void settleWaitingWorker(registration);
        }

        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              void settleWaitingWorker(registration);
            }
          });
        });

        void registration.update().catch((error) => {
          reportError(error, { category: "pwa_update_check" });
        });
      })
      .catch((error) => {
        reportError(error, { category: "pwa_service_worker_registration" });
        if (import.meta.env.DEV) console.warn("[pwa] service worker registration failed", error);
      });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);
}

export function usePwaInstall() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isNativeApp() || isStandaloneDisplay());
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  useEffect(() => {
    if (!supportsPwaInstall()) return;
    if (typeof window === "undefined") return;

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setInstructionsOpen(false);
    };
    const handleDisplayModeChange = () => setInstalled(isNativeApp() || isStandaloneDisplay());

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    const standaloneQuery = window.matchMedia?.("(display-mode: standalone)");
    standaloneQuery?.addEventListener?.("change", handleDisplayModeChange);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      standaloneQuery?.removeEventListener?.("change", handleDisplayModeChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!installPrompt) {
      setInstructionsOpen(true);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  }, [installPrompt]);

  const canPromptInstall = supportsPwaInstall() && Boolean(installPrompt) && !installed;
  const showInstallButton = supportsPwaInstall() && !isNativeApp() && !installed;
  const installCopy = getPwaInstallCopy({
    platform: getCurrentDistributionTarget(),
    installed,
    isTablet: typeof navigator !== "undefined"
      && (/iPad/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)),
  });

  return {
    canInstall: canPromptInstall,
    canPromptInstall,
    showInstallButton,
    installed,
    installCopy,
    instructionsOpen,
    promptInstall,
    openInstallInstructions: () => setInstructionsOpen(true),
    closeInstallInstructions: () => setInstructionsOpen(false),
  };
}

export function requestPwaServiceWorkerUpdate(registration: ServiceWorkerRegistration | null) {
  registration?.waiting?.postMessage({ type: KUB_SW_SKIP_WAITING_MESSAGE });
}

/**
 * Every deploy now installs a new worker, and it waits while the previous one
 * controls a page. That page is often already running the new build — any
 * first launch after a deploy loads it from the network — and must not be
 * asked to update to what it already runs. So the waiting worker is asked
 * first; only a page on a different build, or one that gets no answer, is told
 * an update is ready. See `lib/pwa/serviceWorkerHandoff.ts`.
 */
async function settleWaitingWorker(registration: ServiceWorkerRegistration) {
  // The newest call owns the conversation; an older one still sleeping between
  // questions stops rather than asking a second time in parallel.
  const generation = ++settleGeneration;
  for (let attempt = 0; generation === settleGeneration; attempt += 1) {
    const waiting = registration.waiting;
    if (!waiting) return;
    const scripts = Array.from(
      document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'),
      (script) => script.src,
    );
    const entry = pageEntryPath(scripts, window.location.origin);
    const result = entry ? await requestHandoff(waiting, entry) : null;
    if (shouldAnnounceWaitingWorker(result)) {
      dispatchUpdateReady(registration);
      return;
    }
    const delay = nextHandoffDelay(result, attempt);
    if (delay === null) return;
    await new Promise((resolve) => window.setTimeout(resolve, delay));
  }
}

let settleGeneration = 0;

function dispatchUpdateReady(registration: ServiceWorkerRegistration) {
  window.dispatchEvent(
    new CustomEvent(KUB_SW_UPDATE_READY_EVENT, { detail: { registration } }),
  );
}

/**
 * Takes the waiting build now.
 *
 * Called from a press, and from one other place: `AppUpdateBanner` reloads the
 * session by itself where doing so costs nothing — no call, no conversation
 * open, and the tab hidden or untouched for long enough. Those conditions are
 * the whole argument, and they live in `lib/pwa/appUpdateNotice.ts`. Everywhere
 * else this still waits for a press, because `selectedChatId` is neither in the
 * URL nor persisted, so a reload lands on the chat list and a silent one would
 * trade a visible interruption for an invisible loss.
 *
 * `skipWaiting` first, so the new worker owns the caches before the document is
 * replaced; the reload follows either on `controllerchange` or on a timer,
 * because a page whose worker never answers still has to get its new build.
 */
export function restartOntoWaitingBuild(registration: ServiceWorkerRegistration | null): void {
  if (!registration?.waiting) {
    window.location.reload();
    return;
  }
  let reloaded = false;
  const reload = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };
  navigator.serviceWorker?.addEventListener("controllerchange", reload, { once: true });
  requestPwaServiceWorkerUpdate(registration);
  window.setTimeout(reload, 1500);
}

function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
