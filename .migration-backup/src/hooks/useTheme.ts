"use client";

import { useEffect, useState, useCallback } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "kub:theme";

/**
 * Theme state synchronised with localStorage and the `<html>` element class.
 *
 * The actual class is applied BEFORE React hydration via an inline script
 * (see `RootLayout` in `app/layout.tsx`) — this prevents a dark/light flash
 * on page load.  This hook exposes a setter that writes both to the DOM and
 * to localStorage, plus reads the initial value from the DOM (which the
 * inline script has already populated).
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document === "undefined") return "dark";
    return document.documentElement.classList.contains("light") ? "light" : "dark";
  });

  // Stay in sync if another tab toggles the theme.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      const next = e.newValue === "light" ? "light" : "dark";
      applyTheme(next);
      setThemeState(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode etc. */ }
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, setTheme, toggle };
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "light") root.classList.add("light");
  else root.classList.remove("light");
}

/**
 * Inline script source that runs before React hydration to set the theme
 * class on `<html>` from localStorage.  Embed via `dangerouslySetInnerHTML`.
 */
export const THEME_INIT_SCRIPT = `
try {
  var t = localStorage.getItem("${STORAGE_KEY}");
  if (t === "light") document.documentElement.classList.add("light");
} catch (e) {}
`.trim();
