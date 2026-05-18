"use client";

import { useCallback, useEffect, useState } from "react";

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
          dispatchUpdateReady(registration);
        }

        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              dispatchUpdateReady(registration);
            }
          });
        });

        void registration.update().catch(() => undefined);
      })
      .catch((error) => {
        if (import.meta.env.DEV) console.warn("[pwa] service worker registration failed", error);
      });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);
}

export function usePwaInstall() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandaloneDisplay());

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  }, [installPrompt]);

  return {
    canInstall: Boolean(installPrompt) && !installed,
    installed,
    promptInstall,
  };
}

export function requestPwaServiceWorkerUpdate(registration: ServiceWorkerRegistration | null) {
  registration?.waiting?.postMessage({ type: KUB_SW_SKIP_WAITING_MESSAGE });
}

function dispatchUpdateReady(registration: ServiceWorkerRegistration) {
  window.dispatchEvent(
    new CustomEvent(KUB_SW_UPDATE_READY_EVENT, { detail: { registration } }),
  );
}

function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
