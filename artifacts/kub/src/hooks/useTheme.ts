"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  applyResolvedTheme,
  THEME_LEGACY_KEY,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
} from "@/lib/themeRuntime";

export type { ResolvedTheme } from "@/lib/themeRuntime";

export type Theme = "system" | "dark" | "light";

const STORAGE_KEY = THEME_STORAGE_KEY;
const LEGACY_KEY = THEME_LEGACY_KEY;

function isTheme(v: unknown): v is Theme {
  return v === "system" || v === "dark" || v === "light";
}

function readStoredTheme(): Theme {
  if (typeof localStorage === "undefined") return "system";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isTheme(v)) return v;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === "dark" || legacy === "light") return legacy;
  } catch {
    /* private mode etc. */
  }
  return "system";
}

/**
 * What "system" resolves to.
 *
 * On Android the media query is not trustworthy. Measured on two phones running
 * Android 15 with night mode ON, a DayNight activity theme whose `isLightTheme`
 * resolved to false, and algorithmic darkening allowed and confirmed applied,
 * the WebView still reported `prefers-color-scheme: dark` as false — so the app
 * rendered light on a dark phone. The shell knows the answer for certain, and
 * says so on `window.__letscubeNightMode`; the media query remains the source
 * everywhere else.
 */
function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  // The live value first, for a change made while the app is open.
  const shellNight = (window as unknown as { __letscubeNightMode?: unknown }).__letscubeNightMode;
  if (typeof shellNight === "boolean") return shellNight ? "dark" : "light";
  // Then the one the shell put in the user agent before anything loaded, which
  // is the same answer without the race.
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const marked = /letscube-night\/([01])/.exec(agent);
  if (marked) return marked[1] === "1" ? "dark" : "light";
  // And the value the shell recorded on a previous document, which survives the
  // navigation the other two do not.
  const stored = (() => {
    try {
      return localStorage.getItem("letscube:night");
    } catch {
      return null;
    }
  })();
  if (stored === "1") return "dark";
  if (stored === "0") return "light";

  if (typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let currentTheme: Theme = readStoredTheme();
let currentResolved: ResolvedTheme =
  currentTheme === "system" ? getSystemTheme() : currentTheme;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function commitTheme(next: Theme, persist: boolean) {
  const resolved: ResolvedTheme = next === "system" ? getSystemTheme() : next;
  if (next === currentTheme && resolved === currentResolved) return;
  currentTheme = next;
  currentResolved = resolved;
  applyResolvedTheme(resolved);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode etc. */
    }
  }
  emit();
}

let listenersInstalled = false;
function ensureGlobalListeners() {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  applyResolvedTheme(currentResolved);

  if (typeof window.matchMedia === "function") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMq = () => {
      if (currentTheme !== "system") return;
      const resolved: ResolvedTheme = mq.matches ? "dark" : "light";
      if (resolved === currentResolved) return;
      currentResolved = resolved;
      applyResolvedTheme(resolved);
      emit();
    };
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onMq);
    else mq.addListener(onMq);
  }

  // Re-resolve now. The shell publishes its answer as soon as it has a page,
  // which can be before this code runs — and then the event below has already
  // been and gone. Reading the flag here covers that order.
  const shellResolved = getSystemTheme();
  if (currentTheme === "system" && shellResolved !== currentResolved) {
    currentResolved = shellResolved;
    applyResolvedTheme(shellResolved);
    emit();
  }

  // And this covers the other order, plus the phone's setting changing while
  // the app is open.
  window.addEventListener("letscube:night-mode", () => {
    if (currentTheme !== "system") return;
    const resolved = getSystemTheme();
    if (resolved === currentResolved) return;
    currentResolved = resolved;
    applyResolvedTheme(resolved);
    emit();
  });

  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    const next: Theme = e.newValue && isTheme(e.newValue) ? e.newValue : "system";
    commitTheme(next, false);
  });
}

function subscribe(cb: () => void): () => void {
  ensureGlobalListeners();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const getTheme = (): Theme => currentTheme;
const getResolved = (): ResolvedTheme => currentResolved;
const getServerTheme = (): Theme => "system";
const getServerResolved = (): ResolvedTheme => "dark";

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);
  const resolvedTheme = useSyncExternalStore(subscribe, getResolved, getServerResolved);
  const setTheme = useCallback((next: Theme) => commitTheme(next, true), []);
  return { theme, resolvedTheme, setTheme };
}

export function ThemeSync(): null {
  useTheme();
  return null;
}
