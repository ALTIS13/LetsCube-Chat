"use client";

import { KubGlassLayer, KubIcon } from "@/components/kub";
import { formatFullTime } from "@/lib/format";
import type { MessageWithSender } from "@/types/database";
import { useEffect, useMemo, useState } from "react";
import { messageActorDisplayName, resolveMessageActor } from "@/lib/messageActor";

interface PinnedMessageProps {
  messages: MessageWithSender[];
  onJump?: (message: MessageWithSender) => void;
  onUnpin?: (message: MessageWithSender) => void;
}

export function PinnedMessage({ messages, onJump, onUnpin }: PinnedMessageProps) {
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.pinned && !message.deleted_at),
    [messages],
  );
  const selectedMessage =
    visibleMessages.find((message) => message.id === selectedId) ?? visibleMessages[0] ?? null;

  useEffect(() => {
    if (visibleMessages.length > 0) setDismissed(false);
    if (selectedMessage) setSelectedId(selectedMessage.id);
    else setSelectedId(null);
  }, [selectedMessage, visibleMessages.length]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  if (dismissed || !selectedMessage) return null;

  const isMultiple = visibleMessages.length > 1;
  const selectedIndex = Math.max(
    0,
    visibleMessages.findIndex((message) => message.id === selectedMessage.id),
  );

  const jumpToMessage = (message: MessageWithSender) => {
    setSelectedId(message.id);
    setOpen(false);
    onJump?.(message);
  };

  const unpinMessage = (message: MessageWithSender) => {
    onUnpin?.(message);
  };

  return (
    <div className="relative flex-shrink-0 border-b border-[color:var(--kub-border-color)]">
      <KubGlassLayer />
      <div
        role="button"
        tabIndex={0}
        onClick={() => jumpToMessage(selectedMessage)}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && onJump) {
            event.preventDefault();
            jumpToMessage(selectedMessage);
          }
        }}
        className="relative flex min-w-0 cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors kub-raise-hover"
      >
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-[var(--kub-cyan)]" />
        <KubIcon name="pin" size={14} className="flex-shrink-0 text-[color:var(--kub-accent-text)]" />
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex min-w-0 items-center gap-2">
            <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-[color:var(--kub-accent-text)]">
              {isMultiple ? `Закреплено: ${visibleMessages.length}` : "Закреплённое сообщение"}
            </span>
            {isMultiple && (
              <span className="flex-shrink-0 text-[10px] text-[color:var(--kub-muted)]">
                {selectedIndex + 1} из {visibleMessages.length}
              </span>
            )}
          </div>
          <div className="truncate text-xs text-[color:var(--kub-muted)]">
            {getPinnedPreview(selectedMessage)}
          </div>
        </div>

        {isMultiple && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOpen((value) => !value);
            }}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)]"
            aria-label="Показать список закреплённых сообщений"
            title="Список закреплённых"
          >
            <KubIcon name={open ? "chevronUp" : "chevronDown"} size={15} />
          </button>
        )}

        {onUnpin && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              unpinMessage(selectedMessage);
            }}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)]"
            aria-label="Открепить сообщение"
            title="Открепить"
          >
            <KubIcon name="pinOff" size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setDismissed(true);
            setOpen(false);
          }}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)]"
          aria-label="Скрыть закреплённые сообщения"
          title="Скрыть"
        >
          <KubIcon name="close" size={14} />
        </button>
      </div>

      {open && (
        <div className="kub-glass-strong absolute left-3 right-3 top-[calc(100%+6px)] z-30 max-h-[min(340px,60vh)] overflow-y-auto rounded-xl border border-[color:var(--kub-border-color)] p-2">
          <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--kub-muted)]">
            Закреплённые сообщения
          </div>
          <div className="space-y-1">
            {visibleMessages.map((message) => (
              <div
                key={message.id}
                className="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 transition-colors kub-raise-hover"
              >
                <button
                  type="button"
                  onClick={() => jumpToMessage(message)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="mb-0.5 flex min-w-0 items-center gap-2 text-[11px] text-[color:var(--kub-muted)]">
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
                  onClick={() => jumpToMessage(message)}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)]"
                  aria-label="Перейти к сообщению"
                  title="Перейти к сообщению"
                >
                  <KubIcon name="externalLink" size={14} />
                </button>
                {onUnpin && (
                  <button
                    type="button"
                    onClick={() => unpinMessage(message)}
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
    </div>
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
