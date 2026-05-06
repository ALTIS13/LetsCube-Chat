import { useCallback, useEffect, useMemo, useState } from "react";

const CHECK_INTERVAL_MS = 5 * 60_000;
const SNOOZE_MS = 15 * 60_000;

export function AppUpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const currentBundle = useMemo(() => getCurrentBundlePath(), []);

  const checkForUpdate = useCallback(async () => {
    if (!currentBundle) return;
    try {
      const base = import.meta.env.BASE_URL || "/";
      const indexUrl = `${base.endsWith("/") ? base : `${base}/`}index.html`;
      const response = await fetch(indexUrl, { cache: "no-store" });
      if (!response.ok) return;
      const html = await response.text();
      const nextBundle = getBundlePathFromHtml(html);
      if (nextBundle && normalizeAssetPath(nextBundle) !== normalizeAssetPath(currentBundle)) {
        setUpdateAvailable(true);
      }
    } catch {
      // Transient network failures during normal messaging are not deploy
      // signals. Only show the banner after index.html proves a new bundle.
    }
  }, [currentBundle]);

  useEffect(() => {
    void checkForUpdate();
    const timer = window.setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [checkForUpdate]);

  const updateSnoozed = Date.now() < snoozedUntil;
  const showUpdate = updateAvailable && !updateSnoozed;
  if (!showUpdate) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[80] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] p-3 shadow-2xl">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)] text-[color:var(--kub-cyan)]">
          ↻
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[color:var(--kub-text)]">
            {showUpdate ? "Доступна новая версия приложения" : "Соединение с сервером нестабильно"}
          </div>
          <div className="text-xs text-[color:var(--kub-muted)]">
            {showUpdate
              ? "Обновите страницу, чтобы получить последние исправления."
              : "Возможно, идёт обновление. KUB попробует восстановить соединение автоматически."}
          </div>
        </div>
        {showUpdate && (
          <>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-9 rounded-lg bg-[var(--kub-cyan)] px-3 text-xs font-semibold text-[color:var(--kub-bg)] hover:brightness-110"
            >
              Обновить
            </button>
            <button
              type="button"
              onClick={() => setSnoozedUntil(Date.now() + SNOOZE_MS)}
              className="h-9 rounded-lg px-2 text-xs font-semibold text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-2)]"
            >
              Напомнить позже
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function getCurrentBundlePath(): string | null {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'));
  const entry = scripts.find((script) => /\/assets\/index-[^/]+\.js(?:\?|$)/.test(script.src));
  return entry?.getAttribute("src") ?? entry?.src ?? null;
}

function getBundlePathFromHtml(html: string): string | null {
  const match = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']*\/assets\/index-[^"']+\.js)["']/);
  return match?.[1] ?? null;
}

function normalizeAssetPath(path: string): string {
  try {
    return new URL(path, window.location.origin).pathname;
  } catch {
    return path;
  }
}
