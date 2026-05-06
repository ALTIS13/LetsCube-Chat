"use client";

import { useCallback, useEffect, useState } from "react";
import { KubIcon, KubModal } from "@/components/kub";
import { KUB_APP_DIALOG_EVENT, type AppDialogRequest } from "@/lib/appDialogs";

export function AppDialogs() {
  const [queue, setQueue] = useState<AppDialogRequest[]>([]);
  const current = queue[0] ?? null;

  useEffect(() => {
    const handleDialog = (event: Event) => {
      const request = (event as CustomEvent<AppDialogRequest>).detail;
      if (!request) return;
      setQueue((items) => [...items, request]);
    };
    window.addEventListener(KUB_APP_DIALOG_EVENT, handleDialog);
    return () => window.removeEventListener(KUB_APP_DIALOG_EVENT, handleDialog);
  }, []);

  const finish = useCallback((confirmed: boolean) => {
    if (!current) return;
    current.resolve(confirmed);
    setQueue((items) => items[0]?.id === current.id ? items.slice(1) : items.filter((item) => item.id !== current.id));
  }, [current]);

  if (!current) return null;

  const tone = current.tone ?? "default";
  const isDanger = tone === "danger";

  return (
    <KubModal
      open
      onClose={() => finish(false)}
      title={current.title}
      icon={<KubIcon name={current.icon ?? (isDanger ? "delete" : "alert")} size={18} tone={isDanger ? "danger" : "accent"} />}
      size="sm"
      mobileSheet={false}
      footer={(
        <>
          {current.kind === "confirm" && (
            <button
              type="button"
              onClick={() => finish(false)}
              className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-2)]"
            >
              {current.cancelLabel ?? "Отмена"}
            </button>
          )}
          <button
            type="button"
            onClick={() => finish(true)}
            className={
              isDanger
                ? "inline-flex h-9 items-center justify-center rounded-lg bg-[color:var(--kub-danger)] px-3 text-sm font-semibold text-white hover:opacity-90"
                : "inline-flex h-9 items-center justify-center rounded-lg bg-[var(--kub-cyan)] px-3 text-sm font-semibold text-[color:var(--kub-bg)] hover:brightness-110"
            }
          >
            {current.confirmLabel ?? (current.kind === "alert" ? "Понятно" : "Подтвердить")}
          </button>
        </>
      )}
    >
      <p className="text-sm leading-relaxed text-[color:var(--kub-muted)]">
        {current.description}
      </p>
    </KubModal>
  );
}
