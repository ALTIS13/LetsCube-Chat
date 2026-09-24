"use client";

import { useCallback, useEffect, useState } from "react";
import { KubIcon } from "@/components/kub";
import { PUSH_STATE_CHANGED_EVENT, usePush } from "@/hooks/usePush";
import { DISABLED_SINK_FILLED, FOCUS_RING } from "@/lib/controlSurface";
import { getCurrentDistributionTarget } from "@/lib/platform/capabilities";
import { pushNudgeSnoozeUntil, pushNudgeVariant } from "@/lib/pwa/pushNudge";
import { useAppStore } from "@/store/app.store";

const storageKey = (userId: string) => `letscube:pwa-push-nudge:${userId}`;

function savedSnooze(userId: string | null): number {
  if (!userId) return 0;
  try {
    const value = Number(localStorage.getItem(storageKey(userId)));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/** Non-modal invitation: the OS prompt is requested only from an explicit tap. */
export function PwaPushNudge() {
  const installed = typeof window !== "undefined" && (
    window.matchMedia?.("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
  if (!installed || getCurrentDistributionTarget() !== "ios_pwa") return null;
  return <InstalledIphonePushNudge />;
}

function InstalledIphonePushNudge() {
  const userId = useAppStore((state) => state.currentUser?.id ?? null);
  const { status, readyForPrompt, message, enable } = usePush();
  const [snoozedUntil, setSnoozedUntil] = useState(() => savedSnooze(userId));
  const [busy, setBusy] = useState(false);

  useEffect(() => setSnoozedUntil(savedSnooze(userId)), [userId]);

  const dismiss = useCallback(() => {
    if (!userId) return;
    const until = pushNudgeSnoozeUntil(Date.now());
    setSnoozedUntil(until);
    try { localStorage.setItem(storageKey(userId), String(until)); } catch { /* optional local preference */ }
  }, [userId]);

  // Settings and this card have separate hook instances. A deliberate change
  // in either place should dismiss the invitation in both places.
  useEffect(() => {
    window.addEventListener(PUSH_STATE_CHANGED_EVENT, dismiss);
    return () => window.removeEventListener(PUSH_STATE_CHANGED_EVENT, dismiss);
  }, [dismiss]);

  const variant = pushNudgeVariant({
    installed: true,
    ios: true,
    userId,
    ready: readyForPrompt,
    status,
    snoozedUntil,
    now: Date.now(),
  });
  if (!variant) return null;

  return (
    <aside
      data-testid="pwa-push-nudge"
      className="mx-2 my-2 shrink-0 rounded-2xl bg-[var(--kub-surface)] px-3 py-3 text-[color:var(--kub-text)] kub-raise kub-glow-soft"
      aria-label="Уведомления на iPhone"
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--kub-cyan-rgb)/0.14)] text-[color:var(--kub-accent-text)]">
          <KubIcon name={variant === "settings" ? "notificationsOff" : "notifications"} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{variant === "settings" ? "Уведомления выключены на iPhone" : "Не пропускайте сообщения"}</p>
          <p className="mt-0.5 text-xs leading-4 text-[color:var(--kub-muted)]">
            {variant === "settings"
              ? "Откройте «Настройки» iPhone → «Уведомления» → LETSCUBE и разрешите уведомления."
              : "Получайте сообщения, когда приложение свёрнуто. Пока вы в мессенджере, лишние push не нужны."}
          </p>
          {variant === "enable" && message && <p className="mt-1 text-xs text-[color:var(--kub-danger-text)]">{message}</p>}
          <div className="mt-2 flex items-center gap-2">
            {variant === "enable" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void enable().finally(() => setBusy(false));
                }}
                className={`inline-flex min-h-9 items-center rounded-lg bg-[color:var(--kub-cyan)] px-3 text-xs font-semibold text-[color:var(--kub-bg)] ${DISABLED_SINK_FILLED} ${FOCUS_RING}`}
              >
                {busy ? "Включаем…" : "Включить"}
              </button>
            )}
            <button type="button" onClick={dismiss} className="inline-flex min-h-9 items-center rounded-lg px-3 text-xs font-medium text-[color:var(--kub-muted)] kub-raise-hover">
              {variant === "settings" ? "Понятно" : "Позже"}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
