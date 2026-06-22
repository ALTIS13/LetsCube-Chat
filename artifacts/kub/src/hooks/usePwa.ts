"use client";

import { useCallback, useEffect, useState } from "react";
import { reportError } from "@/lib/monitoring";
import { getRuntimePlatform, isNativeApp, supportsPwaInstall } from "@/lib/platform/capabilities";

export const KUB_SW_UPDATE_READY_EVENT = "kub:sw-update-ready";
export const KUB_SW_CONTROLLER_CHANGED_EVENT = "kub:sw-controller-changed";
export const KUB_SW_SKIP_WAITING_MESSAGE = "KUB_SKIP_WAITING";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type PwaInstallPlatform = "native_android" | "ios_phone" | "ios_tablet" | "android" | "desktop" | "mobile";

export type PwaInstallCopy = {
  platform: PwaInstallPlatform;
  title: string;
  description: string;
  buttonLabel: string;
  variantLabel: string;
  modeLabel: string;
  instructionTitle: string;
  instructionSteps: string[];
};

let registrationStarted = false;

export function usePwaServiceWorker() {
  useEffect(() => {
    if (registrationStarted) return;
    if (isNativeApp()) {
      if (typeof window !== "undefined" && "serviceWorker" in navigator) {
        void navigator.serviceWorker.getRegistrations()
          .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
          .catch((error) => {
            reportError(error, { category: "native_service_worker_cleanup" });
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
    platform: detectPwaInstallPlatform(),
    installed,
    canPromptInstall,
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

function detectPwaInstallPlatform(): PwaInstallPlatform {
  if (isNativeApp() && getRuntimePlatform() === "android") return "native_android";
  if (typeof navigator === "undefined") return "desktop";

  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const maxTouchPoints = navigator.maxTouchPoints || 0;
  const isIpad = /iPad/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  const isIphone = /iPhone|iPod/i.test(userAgent);
  if (isIpad) return "ios_tablet";
  if (isIphone) return "ios_phone";
  if (/Android/i.test(userAgent)) return "android";
  if (/Mobile|Tablet/i.test(userAgent)) return "mobile";
  return "desktop";
}

function getPwaInstallCopy({
  platform,
  installed,
  canPromptInstall,
}: {
  platform: PwaInstallPlatform;
  installed: boolean;
  canPromptInstall: boolean;
}): PwaInstallCopy {
  if (platform === "native_android") {
    return {
      platform,
      title: "Android-приложение LETSCUBE",
      description: "Приложение уже запущено как Android APK. Установка через браузер здесь не нужна.",
      buttonLabel: "Установлено",
      variantLabel: "Android APK",
      modeLabel: "Native",
      instructionTitle: "Установка не требуется",
      instructionSteps: ["LETSCUBE уже открыт как Android-приложение."],
    };
  }

  const installedPrefix = installed ? "LETSCUBE установлен" : "Установить LETSCUBE";

  if (platform === "ios_phone" || platform === "ios_tablet") {
    const device = platform === "ios_phone" ? "iPhone" : "iPad";
    return {
      platform,
      title: installed ? `${installedPrefix} на ${device}` : `${installedPrefix} на ${device}`,
      description: installed
        ? "Приложение уже открывается с экрана Домой без обычной вкладки браузера."
        : "На iOS установка выполняется через Safari: кнопка ниже покажет точные шаги.",
      buttonLabel: "Установить",
      variantLabel: `${device} / iOS PWA`,
      modeLabel: installed ? "Установлено" : "Safari",
      instructionTitle: `Установка на ${device}`,
      instructionSteps: [
        "Откройте LETSCUBE в Safari.",
        "Нажмите кнопку «Поделиться» внизу экрана.",
        "Выберите «На экран Домой», затем нажмите «Добавить».",
      ],
    };
  }

  if (platform === "android") {
    return {
      platform,
      title: installed ? `${installedPrefix} на Android` : `${installedPrefix} на Android`,
      description: installed
        ? "Приложение уже открывается в standalone-режиме."
        : canPromptInstall
          ? "Установите LETSCUBE как отдельное приложение без вкладки браузера."
          : "Если системное окно установки недоступно, используйте меню браузера.",
      buttonLabel: "Установить",
      variantLabel: "Android Web/PWA",
      modeLabel: installed ? "Установлено" : "Браузер",
      instructionTitle: "Установка на Android",
      instructionSteps: [
        "Откройте меню браузера.",
        "Выберите «Установить приложение» или «Добавить на главный экран».",
        "Подтвердите установку LETSCUBE.",
      ],
    };
  }

  if (platform === "mobile") {
    return {
      platform,
      title: installed ? `${installedPrefix} на телефоне` : `${installedPrefix} на телефоне`,
      description: installed
        ? "Приложение уже открывается в standalone-режиме."
        : "Если системное окно установки недоступно, используйте меню браузера.",
      buttonLabel: "Установить",
      variantLabel: "Мобильный Web/PWA",
      modeLabel: installed ? "Установлено" : "Браузер",
      instructionTitle: "Установка на телефоне",
      instructionSteps: [
        "Откройте меню браузера.",
        "Выберите установку приложения или добавление на главный экран.",
        "Подтвердите установку LETSCUBE.",
      ],
    };
  }

  return {
    platform,
    title: installed ? `${installedPrefix} на ПК` : `${installedPrefix} на ПК`,
    description: installed
      ? "Приложение уже открывается в отдельном окне без обычной вкладки браузера."
      : canPromptInstall
        ? "Установите LETSCUBE как отдельное окно без обычной вкладки браузера."
        : "Если системное окно установки недоступно, используйте кнопку установки в адресной строке или меню браузера.",
    buttonLabel: "Установить",
    variantLabel: "ПК Web/PWA",
    modeLabel: installed ? "Установлено" : "Браузер",
    instructionTitle: "Установка на ПК",
    instructionSteps: [
      "Откройте LETSCUBE в Chrome, Edge или другом PWA-совместимом браузере.",
      "Нажмите кнопку установки в адресной строке или откройте меню браузера.",
      "Выберите «Установить LETSCUBE».",
    ],
  };
}
