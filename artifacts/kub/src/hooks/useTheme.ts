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

/**
 * The page background per theme, as literal values.
 *
 * The pre-paint bootstrap runs before any stylesheet is applied, so it cannot
 * read `--kub-bg`. `tests/unit/theme-bootstrap-parity.test.mjs` asserts these
 * stay equal to the stylesheet's own values.
 */
export const THEME_SURFACE_COLORS: Record<ResolvedTheme, string> = {
  dark: "#050B18",
  light: "#F4F8FC",
};

function applyResolvedTheme(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  root.dataset.theme = resolved;
  // Tells the user agent which palette its own controls, scrollbars and form
  // widgets should use, so they stop rendering dark-on-dark.
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_SURFACE_COLORS[resolved]);
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
    var saved = localStorage.getItem("kub-theme");
    if (saved !== "system" && saved !== "dark" && saved !== "light") {
      var legacy = localStorage.getItem("kub:theme");
      saved = (legacy === "dark" || legacy === "light") ? legacy : "system";
    }
    var resolved = saved;
    if (saved === "system") {
      resolved = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }
    apply(resolved);
  } catch (e) {
    apply("dark");
  }
  function apply(resolved) {
    var root = document.documentElement;
    root.classList.remove("dark");
    root.classList.remove("light");
    root.classList.add(resolved);
    root.setAttribute("data-theme", resolved);
    root.style.colorScheme = resolved;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", resolved === "light" ? "#F4F8FC" : "#050B18");
  }
})();
`.trim();
