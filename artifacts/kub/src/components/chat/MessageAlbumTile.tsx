import React, { useState, useSyncExternalStore } from "react";
import { KubIcon } from "@/components/kub";
import { useMessageMediaSource } from "@/hooks/useMediaObjectUrl";
import { resolveOriginalPreviewUrl, type MessageMediaVariantUrls } from "@/hooks/useMediaVariants";
import { formatFullTime } from "@/lib/format";
import { inlineImageSource } from "@/lib/mediaInlineLoad";
import { cn } from "@/lib/utils";
import {
  getGroupReadReceiptAriaLabel,
  getGroupReadReceiptCompactLabel,
  type GroupReadReceiptInfo,
} from "@/lib/groupReadReceipts";
import { groupReactions } from "@/lib/messageReactions";
import { forwardOriginName } from "@/lib/messageForwardOrigin";
import { messageActorDisplayName } from "@/lib/messageActor";
import type { MessageDeliveryState } from "@/lib/messageDelivery";
import { signedMediaUrls } from "@/lib/media/mediaUrl";
import type { MessageWithSender } from "@/types/database";
import { getVisibleMediaCaption } from "./MessageBubble";

const subscribeToMediaUrls = (listener: () => void) => signedMediaUrls().subscribe(listener);

interface MessageAlbumTileProps {
  message: MessageWithSender;
  mediaVariant?: MessageMediaVariantUrls;
  userId: string | null;
  isSelectionMode: boolean;
  compact: boolean;
  replyTarget?: MessageWithSender;
  deliveryState: MessageDeliveryState | null;
  groupReadInfo: GroupReadReceiptInfo | null;
  onOpenMedia: (messageId: string) => void;
  onJumpToReply: (messageId: string) => void;
  onReaction: (messageId: string, emoji: string) => void;
  onOpenGroupReadReceipts: (messageId: string) => void;
}

export const MessageAlbumTile = React.memo(function MessageAlbumTile({
  message,
  mediaVariant,
  userId,
  isSelectionMode,
  compact,
  replyTarget,
  deliveryState,
  groupReadInfo,
  onOpenMedia,
  onJumpToReply,
  onReaction,
  onOpenGroupReadReceipts,
}: MessageAlbumTileProps) {
  const { url: originalUrl, settled } = useMessageMediaSource(message);
  const uploadedPreviewUrl = useSyncExternalStore(
    subscribeToMediaUrls,
    () => message.type === "image" ? resolveOriginalPreviewUrl(message)?.url ?? null : null,
    () => null,
  );
  const previewUrl = message.type === "image"
    ? inlineImageSource(mediaVariant?.previewUrl ?? uploadedPreviewUrl ?? mediaVariant?.thumbUrl, originalUrl, message.media_metadata)
    : mediaVariant?.videoPosterUrl;
  const [failedImageUrls, setFailedImageUrls] = useState<ReadonlySet<string>>(() => new Set());
  const fallbackUrl = message.type === "image" && previewUrl && failedImageUrls.has(previewUrl)
    ? inlineImageSource(null, originalUrl, message.media_metadata)
    : null;
  const displayUrl = previewUrl && !failedImageUrls.has(previewUrl)
    ? previewUrl
    : fallbackUrl && !failedImageUrls.has(fallbackUrl)
      ? fallbackUrl
      : null;
  const failedPreview = Boolean(previewUrl && failedImageUrls.has(previewUrl));
  const caption = getVisibleMediaCaption(message);
  const reactions = groupReactions(message.reactions, userId);
  const forwardedFrom = forwardOriginName({
    forwardedFromId: message.forwarded_from_id,
    explicit: message.forward_origin,
    source: message.forwarded_from,
    originName: message.forward_origin_name,
    originHidden: message.forward_origin_hidden,
  });
  const label = `${message.type === "video" ? "Открыть видео" : "Открыть фото"}: ${caption ?? message.content ?? "Медиа"}`;
  const readLabel = groupReadInfo && groupReadInfo.readCount > 0
    ? getGroupReadReceiptCompactLabel(groupReadInfo)
    : null;

  return (
    <div
      data-message-bubble="true"
      data-message-album-tile="true"
      className={cn(
        "relative h-full min-h-0 w-full min-w-0 overflow-hidden rounded-md border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] text-white",
        message.pending && "opacity-70",
      )}
    >
      <button
        type="button"
        aria-label={label}
        aria-disabled={!originalUrl || undefined}
        tabIndex={isSelectionMode ? -1 : 0}
        onClick={() => { if (originalUrl && !isSelectionMode) onOpenMedia(message.id); }}
        className="absolute inset-0 block h-full w-full overflow-hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
      >
        {displayUrl ? (
          <img
            src={displayUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailedImageUrls((current) => new Set(current).add(displayUrl))}
            className="h-full w-full object-cover transition-transform duration-200 hover:scale-[1.02]"
          />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)]">
            <KubIcon name={message.type === "video" ? "video" : settled && !originalUrl ? "warning" : "image"} size={compact ? 22 : 28} />
            <span className="text-[11px]">{failedPreview ? "Превью недоступно" : message.type === "video" ? "Видео" : "Фото"}</span>
          </span>
        )}
        {message.type === "video" && (
          <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-white">
            <KubIcon name="play" size={20} />
          </span>
        )}
      </button>

      {(message.forwarded_from_id || message.reply_to_id) && (
        <div className="absolute inset-x-1 top-1 flex min-w-0 flex-wrap gap-1">
          {message.forwarded_from_id && (
            <span className="max-w-full truncate rounded-sm bg-black/70 px-1.5 py-0.5 text-[11px] text-white">
              {forwardedFrom ? `Переслано от ${forwardedFrom}` : "Переслано"}
            </span>
          )}
          {message.reply_to_id && (
            <button
              type="button"
              tabIndex={isSelectionMode ? -1 : 0}
              onClick={(event) => { event.stopPropagation(); if (!isSelectionMode) onJumpToReply(message.reply_to_id!); }}
              className="max-w-full truncate rounded-sm bg-black/70 px-1.5 py-0.5 text-left text-[11px] text-white focus-visible:outline-2 focus-visible:outline-[color:var(--kub-cyan)]"
              aria-label="Перейти к исходному сообщению"
            >
              Ответ: {replyTarget ? messageActorDisplayName(replyTarget) : "сообщение"}
            </button>
          )}
        </div>
      )}

      {reactions.length > 0 && (
        <div data-message-reactions-row="true" className="absolute right-1 top-1 flex max-w-[75%] flex-wrap justify-end gap-1">
          {reactions.slice(0, compact ? 2 : 3).map((reaction) => (
            <button
              key={reaction.emoji}
              type="button"
              tabIndex={isSelectionMode ? -1 : 0}
              aria-label={`${reaction.emoji}: ${reaction.count}`}
              aria-pressed={reaction.mine}
              onClick={(event) => { event.stopPropagation(); if (!isSelectionMode) onReaction(message.id, reaction.emoji); }}
              className="rounded-sm bg-black/75 px-1.5 py-0.5 text-[11px] text-white focus-visible:outline-2 focus-visible:outline-[color:var(--kub-cyan)]"
            >
              {reaction.emoji} {reaction.count}
            </button>
          ))}
          {reactions.length > (compact ? 2 : 3) && (
            <span className="rounded-sm bg-black/75 px-1.5 py-0.5 text-[11px] text-white">+{reactions.length - (compact ? 2 : 3)}</span>
          )}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/70 px-2 pb-1 pt-1.5 text-white">
        {caption && <div className={`overflow-hidden text-ellipsis text-[12px] leading-tight ${compact ? "whitespace-nowrap" : "line-clamp-2"}`} title={caption}>{caption}</div>}
        <div className="flex min-h-[14px] items-center justify-end gap-1 text-[11px] leading-none tabular-nums">
          {message.pinned && <KubIcon name="pin" size={11} label="Закреплено" />}
          {message.edited_at && <span title="изменено">изм.</span>}
          <span>{formatFullTime(message.created_at)}</span>
          {deliveryState?.isOwnMessage && !readLabel && (
            <span data-message-delivery-slot="true" title={deliveryState.label}>
              <KubIcon name={deliveryState.icon} size={12} label={deliveryState.label} />
            </span>
          )}
        </div>
      </div>
      {readLabel && (
        <button
          type="button"
          tabIndex={isSelectionMode ? -1 : 0}
          aria-label={getGroupReadReceiptAriaLabel(groupReadInfo!)}
          onClick={(event) => { event.stopPropagation(); if (!isSelectionMode) onOpenGroupReadReceipts(message.id); }}
          className="absolute bottom-1 left-1 rounded-sm bg-black/75 px-1 text-[11px] text-white focus-visible:outline-2 focus-visible:outline-[color:var(--kub-cyan)]"
        >
          {readLabel}
        </button>
      )}
    </div>
  );
});
