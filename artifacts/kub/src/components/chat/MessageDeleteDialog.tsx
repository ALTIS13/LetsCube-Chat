"use client";

import { useState } from "react";

import { KubIcon, KubModal } from "@/components/kub";
import { DISABLED_SINK_FILLED, DISABLED_TEXT, FOCUS_RING, PRESS_FILLED } from "@/lib/controlSurface";
import { deleteDialogTitle } from "@/lib/messageActions";
import { cn } from "@/lib/utils";

/**
 * The one «Удалить», for one message or several.
 *
 * It replaced two menu items and two bulk buttons — «Удалить у себя» and
 * «Удалить для всех» — with Telegram's single question: delete, and a single
 * choice of whether it goes for the other side too. The choice is offered only
 * where it means something (see `deleteDialogOption`), and it starts unchecked:
 * the dialog deletes for the reader unless they ask for more.
 */
export function MessageDeleteDialog({
  count,
  option,
  onCancel,
  onConfirm,
}: {
  count: number;
  /** The checkbox's label, or null when the dialog deletes for the reader only. */
  option: string | null;
  onCancel: () => void;
  /** Resolves once the deletion has been attempted; the dialog closes itself on the caller's word. */
  onConfirm: (forEveryone: boolean) => Promise<void> | void;
}) {
  const [forEveryone, setForEveryone] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm(Boolean(option) && forEveryone);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KubModal
      open
      onClose={() => {
        if (!busy) onCancel();
      }}
      title={deleteDialogTitle(count)}
      icon={<KubIcon name="delete" size={18} tone="danger" />}
      size="sm"
      mobileSheet={false}
      footer={(
        <>
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            disabled={busy}
            className={cn(
              "kub-button inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold text-[color:var(--kub-muted)] kub-raise-hover",
              FOCUS_RING,
              DISABLED_TEXT,
            )}
          >
            Отмена
          </button>
          <button
            type="button"
            data-testid="message-delete-confirm"
            onClick={() => void confirm()}
            disabled={busy}
            className={cn(
              "kub-button inline-flex h-9 items-center justify-center rounded-lg bg-[var(--kub-action-danger-background)] px-3 text-sm font-semibold text-[color:var(--kub-action-danger-foreground)] hover:bg-[var(--kub-action-danger-hover)]",
              PRESS_FILLED,
              FOCUS_RING,
              DISABLED_SINK_FILLED,
            )}
          >
            {busy ? "Удаляем…" : "Удалить"}
          </button>
        </>
      )}
    >
      <p className="text-sm leading-relaxed text-[color:var(--kub-muted)]">
        {count > 1 ? "Вы точно хотите удалить эти сообщения?" : "Вы точно хотите удалить это сообщение?"}
      </p>
      {option && (
        <label className="mt-2 flex cursor-pointer items-center gap-3 text-sm text-[color:var(--kub-text)]">
          <input
            type="checkbox"
            data-testid="message-delete-for-everyone"
            checked={forEveryone}
            disabled={busy}
            onChange={(event) => setForEveryone(event.target.checked)}
            className="h-4 w-4 shrink-0 accent-[var(--kub-cyan)]"
          />
          <span className="min-w-0">{option}</span>
        </label>
      )}
    </KubModal>
  );
}
