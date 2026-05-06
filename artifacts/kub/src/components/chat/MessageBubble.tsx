"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { MessageWithSender } from "@/types/database";
import { formatFullTime } from "@/lib/format";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { AudioMessage } from "./AudioMessage";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";
import { FormattedText } from "@/lib/formatText";
import { KubIcon, type KubIconName } from "@/components/kub";
import type { MediaViewerItem } from "./MediaViewer";

const EMOJI_QUICK = ["👍", "❤️", "😂", "😮", "😢", "🔥", "👏", "🎉"];

interface ContextItem {
  icon: KubIconName;
  label: string;
  danger?: boolean;
  action: () => void;
}

interface MessageBubbleProps {
  message: MessageWithSender;
  isMe: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  onReply: () => void;
  onReaction: (emoji: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onTogglePin?: () => void;
  onForward?: () => void;
  onOpenMedia?: (media: MediaViewerItem) => void;
  usersMap?: Record<string, string>;
  messagesMap?: Record<string, MessageWithSender>;
  isRead?: boolean;
  myRole?: "owner" | "admin" | "member" | null;
}

export function MessageBubble({
  message, isMe, isFirstInGroup, isLastInGroup,
  onReply, onReaction, onEdit, onDelete, onTogglePin, onForward, onOpenMedia,
  usersMap = {}, messagesMap = {}, isRead, myRole,
}: MessageBubbleProps) {
  const canModerate = myRole === "owner" || myRole === "admin";
  const [showContext, setShowContext] = useState(false);
  const [showEmojiBar, setShowEmojiBar] = useState(false);
  const [contextPos, setContextPos] = useState({ x: 0, y: 0 });
  const [selected] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { currentUser } = useAppStore();

  // Belt-and-suspenders cleanup: if the bubble unmounts mid-touch (e.g. user
  // navigates away during a long-press), clear the pending timer so it
  // doesn't try to setShowContext on a torn-down component.
  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  const reactionGroups = (message.reactions ?? []).reduce<Record<string, { count: number; mine: boolean }>>(
    (acc, r) => {
      if (!acc[r.emoji]) acc[r.emoji] = { count: 0, mine: false };
      acc[r.emoji].count++;
      if (r.user_id === currentUser?.id) acc[r.emoji].mine = true;
      return acc;
    }, {}
  );

  const openContext = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 280);
    setContextPos({ x, y });
    setShowContext(true);
    setShowEmojiBar(false);
  }, []);

  const handleTouchStart = useCallback(() => {
    longPressTimer.current = setTimeout(() => setShowContext(true), 500);
  }, []);
  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  const contextItems: ContextItem[] = [
    { icon: "reply", label: "Ответить", action: () => { onReply(); setShowContext(false); } },
    { icon: "copy",  label: "Копировать", action: () => { navigator.clipboard.writeText(message.content ?? ""); setShowContext(false); } },
    ...(isMe && message.type === "text" && onEdit ? [
      { icon: "edit" as KubIconName, label: "Изменить", action: () => { onEdit(); setShowContext(false); } },
    ] : []),
    ...(onTogglePin ? [{
      icon: (message.pinned ? "pinOff" : "pin") as KubIconName,
      label: message.pinned ? "Открепить" : "Закрепить",
      action: () => { onTogglePin(); setShowContext(false); },
    }] : []),
    ...(onForward ? [
      { icon: "forward" as KubIconName, label: "Переслать", action: () => { onForward(); setShowContext(false); } },
    ] : []),
    ...((isMe || canModerate) && onDelete ? [
      { icon: "delete" as KubIconName, label: "Удалить", danger: true, action: () => {
          if (confirm("Удалить сообщение?")) onDelete();
          setShowContext(false);
        } },
    ] : []),
  ];

  const bubbleClass = isMe
    ? "bg-[color-mix(in_srgb,var(--kub-cyan)_22%,var(--kub-surface))] border border-[color:var(--kub-cyan)]/40 text-[color:var(--kub-text)]"
    : "bg-[var(--kub-message-in)] border border-[color:var(--kub-border-color)] text-[color:var(--kub-text)]";

  // Soft-delete: render an inert placeholder bubble in the same slot so the
  // surrounding date separators / scroll position stay stable.  No reply
  // tail, no context menu, no reactions — it's a stub, not a message.
  // Placed AFTER all hooks to keep the Rules of Hooks happy.
  if (message.deleted_at) {
    return (
      <div className={cn("flex gap-1.5 mb-0.5", isMe ? "justify-end" : "justify-start")}>
        {!isMe && <div className="flex-shrink-0 self-end mb-1 w-8" />}
        <div className={cn("flex max-w-[78%] sm:max-w-[72%] md:max-w-[65%]", isMe ? "items-end" : "items-start")}>
          <div
            className={cn(
              "px-3 py-2 rounded-2xl flex items-center gap-1.5 text-sm italic select-none",
              "bg-[var(--kub-surface-2)] border border-dashed border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)]",
              isMe ? "rounded-br-sm" : "rounded-bl-sm",
            )}
          >
            <KubIcon name="delete" size={13} tone="muted" />
            <span>Сообщение удалено</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {showContext && (
        <div className="fixed inset-0 z-50" onClick={() => setShowContext(false)}>
          <div
            className="absolute flex items-center gap-1 rounded-full px-3 py-2 shadow-2xl bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] kub-glow-soft"
            style={{
              left: Math.min(contextPos.x, window.innerWidth - 290),
              top: Math.max(contextPos.y - 56, 8),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {EMOJI_QUICK.map((emoji) => (
              <button
                key={emoji}
                onClick={() => { onReaction(emoji); setShowContext(false); }}
                className="text-xl w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--kub-surface-3)] transition-all hover:scale-125 active:scale-95"
              >
                {emoji}
              </button>
            ))}
          </div>

          <div
            className="absolute rounded-xl shadow-2xl z-50 w-48 py-1 overflow-hidden bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] kub-glow-soft"
            style={{
              left: Math.min(contextPos.x, window.innerWidth - 200),
              top: contextPos.y + 4,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextItems.map(({ icon, label, danger, action }) => (
              <button
                key={label}
                onClick={action}
                className={cn(
                  "flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors hover:bg-[var(--kub-surface-3)]",
                  danger ? "text-[color:var(--kub-danger)]" : "text-[color:var(--kub-text)]"
                )}
              >
                <KubIcon name={icon} size={16} tone={danger ? "danger" : "muted"} />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        className={cn(
          "flex gap-1.5 mb-0.5 group relative msg-appear",
          isMe ? "justify-end" : "justify-start",
          selected && "msg-selected rounded-lg"
        )}
        onContextMenu={openContext}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {!isMe && (
          <div className="flex-shrink-0 self-end mb-1 w-8">
            {isLastInGroup && message.sender && (
              <UserAvatar user={message.sender} size="sm" />
            )}
          </div>
        )}

        <div className={cn("flex flex-col max-w-[78%] sm:max-w-[72%] md:max-w-[65%] [overflow-wrap:anywhere]", isMe ? "items-end" : "items-start")}>

          {!isMe && isFirstInGroup && message.sender && (
            <span className="text-xs font-semibold ml-3 mb-0.5 text-[color:var(--kub-cyan)]">
              {message.sender.full_name}
            </span>
          )}

          {message.reply_to_id && (() => {
            const replyMsg = messagesMap[message.reply_to_id] ?? message.reply_to;
            if (!replyMsg) return null;
            const replyUserId = replyMsg.user_id;
            const replyName = replyUserId === currentUser?.id
              ? "Вы"
              : (replyUserId ? usersMap[replyUserId] : null) ?? replyMsg.sender?.full_name ?? "Без имени";
            return (
              <div
                className={cn(
                  "flex items-stretch gap-2 px-3 py-1.5 mb-px text-xs max-w-full rounded-t-2xl",
                  isMe ? "rounded-br-sm self-end" : "rounded-bl-sm self-start",
                  bubbleClass, "opacity-90"
                )}
              >
                <div className="w-0.5 rounded-full flex-shrink-0 self-stretch bg-[var(--kub-cyan)]" />
                <div className="min-w-0">
                  <div className="font-semibold truncate text-[color:var(--kub-cyan)]">
                    {replyName}
                  </div>
                  <div className="truncate opacity-70 text-[color:var(--kub-text)]">
                    {replyMsg.content}
                  </div>
                </div>
              </div>
            );
          })()}

          <div
            className={cn(
              "relative px-3 py-2 rounded-2xl transition-opacity",
              bubbleClass,
              isMe
                ? cn("rounded-br-sm", message.reply_to_id && "rounded-tr-none")
                : cn("rounded-bl-sm", message.reply_to_id && "rounded-tl-none"),
              isMe && isLastInGroup ? "bubble-out" : "",
              !isMe && isLastInGroup ? "bubble-in" : "",
              message.pending && "opacity-70",
              message.failed && "opacity-60",
            )}
          >
            <div
              className={cn(
                "absolute top-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10",
                isMe ? "-left-20" : "-right-20"
              )}
            >
              <button
                onClick={() => setShowEmojiBar(!showEmojiBar)}
                aria-label="Реакция"
                className="w-7 h-7 rounded-full flex items-center justify-center transition-colors bg-[var(--kub-surface-2)] hover:bg-[var(--kub-surface-3)] text-[color:var(--kub-muted)] border border-[color:var(--kub-border-color)]"
              >
                <KubIcon name="smile" size={14} />
              </button>
              <button
                onClick={onReply}
                aria-label="Ответить"
                className="w-7 h-7 rounded-full flex items-center justify-center transition-colors bg-[var(--kub-surface-2)] hover:bg-[var(--kub-surface-3)] text-[color:var(--kub-muted)] border border-[color:var(--kub-border-color)]"
              >
                <KubIcon name="reply" size={14} />
              </button>
            </div>

            {showEmojiBar && (
              <div
                className={cn(
                  "absolute -top-12 flex items-center gap-0.5 rounded-full px-2 py-1.5 shadow-2xl z-20 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] kub-glow-soft",
                  isMe ? "right-0" : "left-0"
                )}
              >
                {EMOJI_QUICK.slice(0, 6).map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => { onReaction(emoji); setShowEmojiBar(false); }}
                    className="text-lg w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--kub-surface-3)] transition-all hover:scale-125"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            {isVoiceMessage(message) ? (
              <AudioMessage url={message.media_url} duration={parseAudioDuration(message.content)} isMe={isMe} />
            ) : message.type === "image" && message.media_url ? (
              <MediaImage
                url={message.media_url}
                title={message.content ?? "Фото"}
                onOpen={() => onOpenMedia?.({ type: "image", url: message.media_url!, title: message.content ?? "Фото" })}
              />
            ) : message.type === "video" && message.media_url ? (
              <MediaVideo
                url={message.media_url}
                title={message.content ?? "Видео"}
                onOpen={() => onOpenMedia?.({ type: "video", url: message.media_url!, title: message.content ?? "Видео" })}
              />
            ) : message.type === "file" && message.media_url ? (
              <a
                href={message.media_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-sm hover:opacity-80 transition-opacity text-[color:var(--kub-cyan)]"
              >
                <KubIcon name="file" size={16} />
                <span className="truncate max-w-[200px]">{message.content ?? "File"}</span>
              </a>
            ) : (
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-[color:var(--kub-text)]">
                <FormattedText content={message.content ?? ""} />
              </p>
            )}

            <div className="flex items-center justify-end gap-1 mt-1 -mb-0.5">
              {message.edited_at && (
                <span className="text-[10px] text-[color:var(--kub-muted)]">изменено</span>
              )}
              <span className="text-[10px] leading-none text-[color:var(--kub-muted)]">
                {formatFullTime(message.created_at)}
              </span>
              {isMe && (
                message.failed ? (
                  <KubIcon name="alert" size={13} tone="danger" label="Не удалось отправить" />
                ) : message.pending ? (
                  <KubIcon name="clock" size={13} tone="muted" label="Отправляется" />
                ) : isRead ? (
                  <KubIcon name="doubleCheck" size={13} tone="accent" />
                ) : (
                  <KubIcon name="check" size={13} tone="muted" />
                )
              )}
            </div>
          </div>

          {Object.keys(reactionGroups).length > 0 && (
            <div className={cn("flex flex-wrap gap-1 mt-1", isMe ? "justify-end" : "justify-start")}>
              {Object.entries(reactionGroups).map(([emoji, { count, mine }]) => (
                <button
                  key={emoji}
                  onClick={() => onReaction(emoji)}
                  className={cn(
                    "flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs transition-all hover:scale-105 active:scale-95 border",
                    mine
                      ? "bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)] border-[color:var(--kub-cyan)] text-[color:var(--kub-cyan)]"
                      : "bg-[var(--kub-surface-2)] border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)]"
                  )}
                >
                  <span className="text-sm">{emoji}</span>
                  {count > 1 && <span>{count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function MediaImage({ url, title, onOpen }: { url: string; title: string; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex max-w-[260px] items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs text-[color:var(--kub-muted)]">
        <KubIcon name="warning" size={16} />
        <span className="min-w-0 flex-1">Не удалось загрузить изображение.</span>
        <a href={url} target="_blank" rel="noreferrer" className="text-[color:var(--kub-cyan)] hover:underline">
          Открыть
        </a>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block max-w-full overflow-hidden rounded-xl text-left focus:outline-none focus:ring-2 focus:ring-[color:var(--kub-cyan)]"
      aria-label="Открыть фото"
    >
      <img
        src={url}
        alt={title || "Фото"}
        loading="lazy"
        className="max-h-[320px] w-auto max-w-full object-cover transition-transform duration-200 group-hover:scale-[1.01] sm:max-h-[360px]"
        onError={() => setFailed(true)}
      />
    </button>
  );
}

function MediaVideo({ url, title, onOpen }: { url: string; title: string; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex max-w-[280px] items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs text-[color:var(--kub-muted)]">
        <KubIcon name="warning" size={16} />
        <span className="min-w-0 flex-1">Не удалось загрузить видео.</span>
        <a href={url} target="_blank" rel="noreferrer" className="text-[color:var(--kub-cyan)] hover:underline">
          Открыть
        </a>
      </div>
    );
  }

  return (
    <div className="relative w-[min(360px,72vw)] overflow-hidden rounded-xl bg-black">
      <video
        src={url}
        preload="metadata"
        controls
        playsInline
        className="block aspect-video w-full max-h-[320px] bg-black object-contain"
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        onClick={onOpen}
        className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-lg bg-black/65 px-2.5 py-1.5 text-xs text-white backdrop-blur transition-colors hover:bg-black/80"
        aria-label="Открыть видео в просмотрщике"
      >
        <KubIcon name="externalLink" size={14} />
        <span className="hidden sm:inline">Открыть</span>
      </button>
    </div>
  );
}

function parseAudioDuration(content: string | null | undefined): number {
  const match = content?.match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return 0;
  return minutes * 60 + seconds;
}

function isVoiceMessage(message: MessageWithSender): boolean {
  if (message.type === "audio") return true;
  const mediaUrl = message.media_url?.toLowerCase() ?? "";
  if (/\.(webm|ogg|oga|mp3|wav|m4a|aac)(\?|#|$)/.test(mediaUrl)) return true;
  const content = message.content?.toLowerCase() ?? "";
  return content.includes("голосовое") || content.includes("voice");
}
