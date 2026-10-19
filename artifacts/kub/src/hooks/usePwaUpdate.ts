import { useEffect, useSyncExternalStore } from "react";
import { isNativeApp } from "@/lib/platform/capabilities";
import { isDesktopApp } from "@/lib/platform/desktop";
import { reloadWouldLose } from "@/lib/reloadGuard";
import { markVoiceResumeInterrupted } from "@/lib/voiceResumeStorage";
import { createPwaUpdateState } from "@/lib/pwa/pwaUpdateState";
import { pageEntryPath, requestHandoff, shouldAnnounceWaitingWorker } from "@/lib/pwa/serviceWorkerHandoff";
import { voiceCallSnapshot } from "@/hooks/useVoiceCall";
import { voiceRingsSnapshot } from "@/hooks/useVoiceRing";
import { KUB_SW_UPDATE_READY_EVENT, restartOntoWaitingBuild } from "./usePwa";

const CHECK_INTERVAL_MS = 5 * 60_000;
let shared: ReturnType<typeof createPwaUpdateState> | null = null;
let users = 0;
let stop: (() => void) | null = null;
const noSubscribe = () => () => {};
const noSnapshot = () => null;

function ownEntry(scripts: readonly string[]): string | null {
  const path = pageEntryPath(scripts, window.location.origin);
  return path && /\/assets\/index-[^/]+\.js$/.test(path) ? path : null;
}

function controller() {
  if (shared) return shared;
  const entry = ownEntry(Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'), script => script.src));
  let storage: Storage | null = null;
  try { storage = window.sessionStorage; } catch { /* Storage may be unavailable. */ }
  const base = import.meta.env.BASE_URL || "/";
  const scope = base.endsWith("/") ? base : `${base}/`;
  shared = createPwaUpdateState({
    entry, storage,
    async check(signal) {
      if (!entry) throw new Error("PWA_ENTRY_UNAVAILABLE");
      const response = await fetch(`${scope}index.html`, { cache: "no-store", signal });
      if (!response.ok) throw new Error("PWA_INDEX_UNAVAILABLE");
      const html = new DOMParser().parseFromString(await response.text(), "text/html");
      const next = ownEntry(Array.from(html.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'), script => script.getAttribute("src")!));
      if (!next) throw new Error("PWA_ENTRY_UNAVAILABLE");
      const candidate = await navigator.serviceWorker?.getRegistration(scope);
      const registration = candidate?.scope === new URL(scope, location.origin).href ? candidate : null;
      if (registration) await registration.update();
      const waiting = registration?.waiting;
      const pending = waiting ? shouldAnnounceWaitingWorker(await requestHandoff(waiting, entry)) : false;
      return { entry: next, registration, waiting: pending };
    },
    restart: restartOntoWaitingBuild,
    guard(confirmedCall) {
      if (reloadWouldLose().length || voiceRingsSnapshot().length) return "blocked";
      const call = voiceCallSnapshot();
      return confirmedCall !== call && ["connected", "joining", "reconnecting"].includes(call.phase) ? "call" : null;
    },
    beforeRestart: markVoiceResumeInterrupted,
  });
  return shared;
}

/** Shared by the root notice and Settings: one detector, one in-flight action. */
export function usePwaUpdate() {
  const enabled = typeof window !== "undefined" && !isNativeApp() && !isDesktopApp();
  const update = enabled ? controller() : null;
  const snapshot = useSyncExternalStore(update?.subscribe ?? noSubscribe, update?.getSnapshot ?? noSnapshot, noSnapshot);
  useEffect(() => {
    if (!update) return;
    if (users++ === 0) {
      const onReady = (event: Event) => {
        const registration = (event as CustomEvent<{ registration?: ServiceWorkerRegistration }>).detail?.registration;
        if (registration?.scope === new URL(import.meta.env.BASE_URL || "/", location.origin).href) update.announce(registration);
      };
      const onVisibility = () => { if (document.visibilityState === "visible") void update.check(false); };
      window.addEventListener(KUB_SW_UPDATE_READY_EVENT, onReady);
      document.addEventListener("visibilitychange", onVisibility);
      const timer = window.setInterval(() => void update.check(false), CHECK_INTERVAL_MS);
      void update.check(false);
      stop = () => {
        window.clearInterval(timer);
        window.removeEventListener(KUB_SW_UPDATE_READY_EVENT, onReady);
        document.removeEventListener("visibilitychange", onVisibility);
        update.dispose();
      };
    }
    return () => { if (--users === 0) { stop?.(); stop = null; } };
  }, [update]);
  return update && snapshot ? { ...snapshot, check: update.check, apply: update.apply } : null;
}

export type PwaUpdateController = NonNullable<ReturnType<typeof usePwaUpdate>>;
