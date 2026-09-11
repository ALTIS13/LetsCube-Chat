"use client";

import { KubGlassLayer, KubIcon, type KubIconName } from "@/components/kub";
import { CAPSULE_GLASS } from "@/lib/chatChrome";
import { DISABLED_TEXT, FOCUS_RING, PRESS_SINK } from "@/lib/controlSurface";
import { selectionCountLabel } from "@/lib/messageActions";
import { cn } from "@/lib/utils";

/**
 * The bar that replaces the chat header while messages are selected.
 *
 * On a phone it is Telegram for Android's: «×», «Выделено: N» and three icons.
 * From 640px the icons carry their words and «Отмена» closes it, as in Telegram
 * Desktop. The same height as the header's control row, so the conversation
 * under it does not move when selection starts or ends.
 *
 * One capsule in that row, like the header's own capsules it stands in for:
 * the material is a leaf layer and the controls a positioned row over it,
 * because the actions here open dialogs, and a frosted box would lay a fixed
 * dialog out against itself (rule 3).
 */
export function ChatSelectionBar({
  count,
  canForward,
  canCopy,
  canDelete,
  onForward,
  onCopy,
  onDelete,
  onCancel,
}: {
  count: number;
  canForward: boolean;
  canCopy: boolean;
  canDelete: boolean;
  onForward: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="relative flex flex-shrink-0 flex-col pt-safe md:pt-0"
      data-testid="chat-selection-bar"
      role="toolbar"
      aria-label="Выделенные сообщения"
    >
      <div className="flex h-[var(--kub-control-row-height)] flex-shrink-0 items-center px-2 md:px-4">
        <div className="relative flex h-11 min-w-0 flex-1 items-center rounded-full">
          <KubGlassLayer className={CAPSULE_GLASS} />
          <div className="relative flex min-w-0 flex-1 items-center gap-1 px-1">
            <button
              type="button"
              onClick={onCancel}
              aria-label="Снять выделение"
              className={cn(
                "kub-icon-action kub-interactive rounded-full text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)] sm:hidden",
                FOCUS_RING,
                PRESS_SINK,
              )}
            >
              <KubIcon name="close" size={20} />
            </button>
            <span
              aria-live="polite"
              data-testid="chat-selection-count"
              className="min-w-0 flex-1 truncate px-2 text-sm font-semibold text-[color:var(--kub-text)]"
            >
              {selectionCountLabel(count)}
            </span>
            <SelectionAction icon="forward" label="Переслать" disabled={!canForward} onClick={onForward} />
            <SelectionAction icon="copy" label="Копировать" disabled={!canCopy} onClick={onCopy} />
            <SelectionAction icon="delete" label="Удалить" danger disabled={!canDelete} onClick={onDelete} />
            <button
              type="button"
              onClick={onCancel}
              className={cn(
                "kub-button hidden h-9 items-center justify-center rounded-full px-3 text-sm font-semibold text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)] sm:inline-flex",
                FOCUS_RING,
                PRESS_SINK,
              )}
            >
              Отмена
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectionAction({
  icon,
  label,
  danger = false,
  disabled,
  onClick,
}: {
  icon: KubIconName;
  label: string;
  danger?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "kub-icon-action kub-interactive h-9 gap-1.5 rounded-full px-2 text-sm font-semibold transition-colors kub-raise-hover sm:px-3",
        danger ? "text-[color:var(--kub-danger-text)]" : "text-[color:var(--kub-text)]",
        FOCUS_RING,
        PRESS_SINK,
        DISABLED_TEXT,
      )}
    >
      <KubIcon name={icon} size={18} tone={danger ? "currentColor" : "muted"} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
