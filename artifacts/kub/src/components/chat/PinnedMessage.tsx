"use client";

import { KubIcon } from "@/components/kub";
import { requestAppConfirm } from "@/lib/appDialogs";
import { nextPinnedIndex, pinnedLine, pinnedTitle } from "@/lib/chatTopCard";
import { formatFullTime } from "@/lib/format";
import { messageActorDisplayName, resolveMessageActor } from "@/lib/messageActor";
import { cn } from "@/lib/utils";
import type { MessageWithSender } from "@/types/database";
import { memo, useEffect, useState, type CSSProperties } from "react";

interface PinnedMessageProps {
  /** Pinned and not deleted, newest first: what `ChatTopCard` hands over. */
  messages: MessageWithSender[];
  onJump?: (message: MessageWithSender) => void;
  onUnpin?: (message: MessageWithSender) => void;
  /** Which of the card's corners are this row's: the top two when the player is under it. */
  rounding: "top" | "all";
}

const ROUNDING = { top: "rounded-t-[1.375rem]", all: "rounded-[1.375rem]" } as const;

const ROW_CONTROL =
  "relative flex h-10 w-9 flex-shrink-0 items-center justify-center rounded-full text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]";

/**
 * The pinned message, as a row of the conversation's top card (tracker item
 * 70).
 *
 * Telegram's pinned bar, read off `ChatActivity.java` and `PinnedLineView.java`
 * (DrKLO/Telegram, master, 2026-09-28): 48 high; a line down the left with a
 * segment per pin and the one shown lit; «Закреплённое сообщение» in the accent
 * over the message's words; and one control at the right — the list of pins
 * when there is more than one, a cross when there is one. A tap on the bar
 * goes to the message and moves the bar to the next older pin, so a tap at a
 * time walks every pin and comes round again.
 *
 * The cross unpins, after asking, as Telegram's does for anyone who may pin —
 * and here that is every member: `unpin_message` checks membership and nothing
 * else (read on production, 2026-09-28). The «Скрыть» it replaces hid the bar
 * only until the next render brought it back.
 */
export const PinnedMessage = memo(function PinnedMessage({ messages, onJump, onUnpin, rounding }: PinnedMessageProps) {
  const [open, setOpen] = useState(false);
  const [shownId, setShownId] = useState<string | null>(null);

  const total = messages.length;
  const found = shownId ? messages.findIndex((message) => message.id === shownId) : -1;
  const index = found >= 0 ? found : 0;
  const shown = messages[index] ?? null;

  // A pin arriving puts the bar back on the newest: that is the one somebody
  // just asked everyone to see.
  const newestId = messages[0]?.id ?? null;
  useEffect(() => {
    setShownId(null);
  }, [newestId]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  if (!shown) return null;

  const jumpTo = (message: MessageWithSender) => {
    setOpen(false);
    onJump?.(message);
  };

  const pressRow = () => {
    jumpTo(shown);
    // Telegram's `forceNextPinnedMessageId`: once the bar has taken you to a
    // pin, it offers the one before it, and after the oldest the newest.
    if (total > 1) setShownId(messages[nextPinnedIndex(index, total)]?.id ?? null);
  };

  const askToUnpin = async (message: MessageWithSender) => {
    if (!onUnpin) return;
    const confirmed = await requestAppConfirm({
      title: "Открепить сообщение?",
      description: "Оно открепится у всех участников чата.",
      confirmLabel: "Открепить",
      cancelLabel: "Отмена",
      icon: "pinOff",
    });
    if (confirmed) onUnpin(message);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        data-testid="pinned-message-bar"
        data-pinned-index={index}
        aria-label={`${pinnedTitle(index, total)}: ${getPinnedPreview(shown)}`}
        onClick={pressRow}
        onKeyDown={(event) => {
          // The controls inside answer their own keys.
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            pressRow();
          }
        }}
        className={cn(
          "relative flex h-12 min-w-0 cursor-pointer items-center gap-2 pl-6 pr-1.5 transition-colors kub-raise-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
          ROUNDING[rounding],
        )}
      >
        <PinnedLine index={index} total={total} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold leading-[18px] text-[color:var(--kub-accent-text)]">
            {pinnedTitle(index, total)}
          </div>
          <div className="truncate text-[14px] leading-[18px] text-[color:var(--kub-text)]">
            {getPinnedPreview(shown)}
          </div>
        </div>

        {total > 1 ? (
          <button
            type="button"
            data-testid="pinned-message-list-toggle"
            onClick={(event) => {
              event.stopPropagation();
              setOpen((value) => !value);
            }}
            aria-expanded={open}
            className={ROW_CONTROL}
            aria-label="Показать список закреплённых сообщений"
            title="Список закреплённых"
          >
            <KubIcon name="pinnedList" size={20} />
          </button>
        ) : onUnpin ? (
          <button
            type="button"
            data-testid="pinned-message-unpin"
            onClick={(event) => {
              event.stopPropagation();
              void askToUnpin(shown);
            }}
            className={ROW_CONTROL}
            aria-label="Открепить сообщение"
            title="Открепить"
          >
            <KubIcon name="close" size={16} />
          </button>
        ) : null}
      </div>

      {open && (
        <div
          data-testid="pinned-message-list"
          className="kub-glass-strong absolute left-3 right-3 top-[calc(100%+6px)] z-30 max-h-[min(340px,60vh)] overflow-y-auto rounded-xl border border-[color:var(--kub-border-color)] p-2"
        >
          <div className="px-2 pb-2 text-[12px] font-semibold uppercase tracking-wider text-[color:var(--kub-muted)]">
            Закреплённые сообщения
          </div>
          <div className="space-y-1">
            {messages.map((message) => (
              <div
                key={message.id}
                className="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 transition-colors kub-raise-hover"
              >
                <button
                  type="button"
                  onClick={() => jumpTo(message)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="mb-0.5 flex min-w-0 items-center gap-2 text-[12px] text-[color:var(--kub-muted)]">
                    <span className="truncate font-medium text-[color:var(--kub-text)]">
                      {getSenderName(message)}
                    </span>
                    <span className="flex-shrink-0">{formatFullTime(message.created_at)}</span>
                  </div>
                  <div className="truncate text-xs text-[color:var(--kub-muted)]">
                    {getPinnedPreview(message)}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => jumpTo(message)}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)]"
                  aria-label="Перейти к сообщению"
                  title="Перейти к сообщению"
                >
                  <KubIcon name="externalLink" size={14} />
                </button>
                {onUnpin && (
                  <button
                    type="button"
                    onClick={() => void askToUnpin(message)}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)]"
                    aria-label="Открепить"
                    title="Открепить"
                  >
                    <KubIcon name="pinOff" size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
});

/**
 * Telegram's `PinnedLineView`: 3 wide, inset 8 from the top and the foot of the
 * 48-high bar, a segment per pin with 0.7 of a gap either side, the one shown
 * in the accent and the rest at 30% of it (alpha 76 of 255), and a 6-high fade
 * at either end once there are more than three to scroll through.
 */
function PinnedLine({ index, total }: { index: number; total: number }) {
  const line = pinnedLine(index, total);
  const column: CSSProperties = {
    height: `${(line.total / line.visible) * 100}%`,
    transform: `translateY(-${(line.offset / line.total) * 100}%)`,
  };
  return (
    <span
      aria-hidden="true"
      data-testid="pinned-message-line"
      data-lit={line.position}
      data-segments={line.total}
      className={cn(
        "pointer-events-none absolute bottom-2 left-3 top-2 w-[3px] overflow-hidden",
        line.total > 3 && "[mask-image:linear-gradient(to_bottom,transparent,#000_6px,#000_calc(100%-6px),transparent)]",
      )}
    >
      <span
        className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={column}
      >
        {Array.from({ length: line.total }, (_, segment) => (
          <span key={segment} className="min-h-0 flex-1 py-[0.7px]">
            <span
              className={cn(
                "block h-full rounded-full",
                segment === line.position
                  ? "bg-[var(--kub-cyan)]"
                  : "bg-[color-mix(in_srgb,var(--kub-cyan)_30%,transparent)]",
              )}
            />
          </span>
        ))}
      </span>
    </span>
  );
}

function getPinnedPreview(message: MessageWithSender): string {
  if (message.deleted_at) return "Сообщение удалено";
  if (message.type === "image") return "Фото";
  if (message.type === "audio") return "Голосовое сообщение";
  if (message.type === "video") return "Видео";
  if (message.type === "file") return "Файл";
  return message.content?.trim() || "Сообщение без текста";
}

function getSenderName(message: MessageWithSender): string {
  return messageActorDisplayName(resolveMessageActor(message));
}
