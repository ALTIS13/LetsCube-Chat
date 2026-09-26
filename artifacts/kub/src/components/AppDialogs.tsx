"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KubIcon, KubModal } from "@/components/kub";
import { KUB_APP_DIALOG_EVENT, type AppDialogRequest } from "@/lib/appDialogs";
import { createClient } from "@/lib/supabase/client";

export function AppDialogs() {
  const [queue, setQueue] = useState<AppDialogRequest[]>([]);
  const current = queue[0] ?? null;
  /** «Отмена» on a question, «Понятно» on a statement: the button that changes nothing. */
  const dismissRef = useRef<HTMLButtonElement | null>(null);
  /** Whatever held focus before the first of a run of dialogs opened. */
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const currentId = current?.id ?? null;

  useEffect(() => {
    const handleDialog = (event: Event) => {
      const request = (event as CustomEvent<AppDialogRequest>).detail;
      if (!request) return;
      setQueue((items) => [...items, request]);
    };
    window.addEventListener(KUB_APP_DIALOG_EVENT, handleDialog);
    return () => window.removeEventListener(KUB_APP_DIALOG_EVENT, handleDialog);
  }, []);

  useEffect(() => {
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      const userId = session?.user.id ?? null;
      setQueue((items) => {
        const next = items.filter((item) => !item.ownerUserId || item.ownerUserId === userId);
        if (next.length === items.length) return items;
        for (const item of items) {
          if (item.ownerUserId && item.ownerUserId !== userId) item.resolve(false);
        }
        return next;
      });
    });
    return () => subscription.unsubscribe();
  }, []);

  /**
   * The dialog takes focus, and «Отмена» is what it takes it to (D-133).
   *
   * This is the one clause of that entry's own proposal — «a title, one line
   * saying what will stop working, a red confirm, and focus on «Отмена»» —
   * that was never built, and it is the clause that decides whether the other
   * three can be answered at all. Measured on 2026-09-19 over «Удалить фото
   * профиля?»: focus stayed on the button that raised the question, outside the
   * dialog; the first control inside it was **nineteen** Tab presses away, past
   * the whole settings column, because the modal is portalled to the end of
   * `document.body` while focus sat in the middle of the page; and Enter — the
   * reflex answer to a box that has just appeared — re-fired «Удалить фото»
   * instead, queueing the same question a second time.
   *
   * So the confirmation asked people to read it and gave a keyboard no way to
   * reply, which is the register's recurring shape: a control that cannot
   * change its own outcome.
   *
   * Focus goes to the button that changes nothing, on purpose. A destructive
   * default is answered correctly by a stray Enter only by luck, and both
   * platform conventions and the `AlertDialog` already used on the bot panel
   * put it on the way out.
   *
   * Focus is also given back. Moving it and not restoring it would trade this
   * defect for a quieter one: the next Tab after a dismissed dialog would start
   * from the top of the document rather than from the control the person was
   * working with. The element is checked for `isConnected` first, because a
   * confirmed action often removes the very control it was raised from.
   *
   * The dialog is *not* trapped here. Tab still leaves it, and that is true of
   * every `KubModal` in the product — a trap belongs to the modal, not to this
   * one caller, and building it here would leave forty other dialogs open while
   * implying the class was closed.
   */
  useEffect(() => {
    if (currentId === null) {
      const back = returnFocusRef.current;
      returnFocusRef.current = null;
      if (back?.isConnected) back.focus();
      return;
    }
    if (!returnFocusRef.current) {
      const active = document.activeElement;
      returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    dismissRef.current?.focus();
  }, [currentId]);

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
      tone={tone}
      size="sm"
      mobileSheet={false}
      footer={(
        <>
          {current.kind === "confirm" && (
            <button
              ref={dismissRef}
              type="button"
              onClick={() => finish(false)}
              className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-2)]"
            >
              {current.cancelLabel ?? "Отмена"}
            </button>
          )}
          <button
            // A statement has only this button, so this is the one to reach.
            ref={current.kind === "alert" ? dismissRef : undefined}
            type="button"
            onClick={() => finish(true)}
            className={
              isDanger
                ? "inline-flex h-9 items-center justify-center rounded-lg bg-[var(--kub-action-danger-background)] px-3 text-sm font-semibold text-[color:var(--kub-action-danger-foreground)] hover:bg-[var(--kub-action-danger-hover)] active:brightness-95"
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
