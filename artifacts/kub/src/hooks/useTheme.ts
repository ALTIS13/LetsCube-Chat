"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Theme = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

const STORAGE_KEY = "kub-theme";
const LEGACY_KEY = "kub:theme";

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

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyResolvedTheme(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  root.dataset.theme = resolved;
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

export const THEME_INIT_SCRIPT = `
(function(){
  try {
    var saved = localStorage.getItem("${STORAGE_KEY}");
    if (saved !== "system" && saved !== "dark" && saved !== "light") {
      var legacy = localStorage.getItem("${LEGACY_KEY}");
      saved = (legacy === "dark" || legacy === "light") ? legacy : "system";
    }
    var resolved = saved;
    if (saved === "system") {
      resolved = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }
    var c = document.documentElement.classList;
    c.remove("dark"); c.remove("light");
    c.add(resolved);
    document.documentElement.setAttribute("data-theme", resolved);
  } catch (e) {
    document.documentElement.classList.add("dark");
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
`.trim();
