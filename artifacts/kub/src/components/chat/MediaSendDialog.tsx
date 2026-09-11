"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { KubButton, KubIcon, KubInput, KubModal, KubNotice } from "@/components/kub";
import { FOCUS_RING } from "@/lib/controlSurface";
import {
  MAX_ORIGINAL_ATTACHMENT_SIZE_LABEL,
  exceedsOriginalLimit,
  formatSizeRoundedUp,
  isCompressibleMediaType,
  mediaSendDialogTitle,
  originalLimitMessage,
} from "@/lib/mediaCompression";
import { formatAttachmentSize } from "@/lib/stagedAttachments";
import { cn } from "@/lib/utils";

export interface MediaSendChoice {
  files: File[];
  compress: boolean;
  caption: string;
}

interface MediaSendDialogProps {
  files: File[];
  onCancel: () => void;
  onSend: (choice: MediaSendChoice) => void;
}

type Item = { id: number; file: File };

/**
 * The desktop's send dialog: what is about to go, and whether it goes compressed.
 *
 * Opened for every batch with a photo or a video in it, however it arrived. It
 * lists the files, carries «Сжать изображение» — checked, because compressed is
 * the default the owner kept — and a caption, and sends from its own button, as
 * Telegram's does. The upload itself runs in the composer's tray, which already
 * shows progress, cancel and retry.
 *
 * An original over the limit is not sent and not silently dropped either: its
 * tile is marked, a notice says what to do, and «Отправить» waits until the box
 * is ticked again or the file is taken out.
 */
export function MediaSendDialog({ files, onCancel, onSend }: MediaSendDialogProps) {
  const [items, setItems] = useState<Item[]>(() => files.map((file, id) => ({ id, file })));
  const [compress, setCompress] = useState(true);
  const [caption, setCaption] = useState("");

  const offersCompression = items.some((item) => isCompressibleMediaType(item.file.type));
  const blocked = compress
    ? []
    : items.filter((item) => isCompressibleMediaType(item.file.type) && exceedsOriginalLimit(item.file.size));
  const canSend = items.length > 0 && blocked.length === 0;

  // Taking out the last file leaves nothing to send, so the dialog goes with it.
  useEffect(() => {
    if (items.length === 0) onCancel();
  }, [items.length, onCancel]);

  const send = () => {
    if (!canSend) return;
    onSend({ files: items.map((item) => item.file), compress, caption: caption.trim() });
  };

  const handleCaptionKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  return (
    <KubModal
      open
      onClose={onCancel}
      title={mediaSendDialogTitle(items.map((item) => item.file))}
      icon={<KubIcon name="image" size={18} />}
      size="md"
      footer={(
        <>
          <KubButton variant="secondary" onClick={onCancel}>
            Отмена
          </KubButton>
          <KubButton variant="primary" onClick={send} disabled={!canSend} leftIcon={<KubIcon name="send" size={16} />}>
            Отправить
          </KubButton>
        </>
      )}
    >
      <div data-testid="media-send-dialog" className="flex flex-col gap-3">
        <ul
          aria-label="Файлы к отправке"
          className={cn("grid gap-2", items.length > 1 ? "grid-cols-2" : "grid-cols-1")}
        >
          {items.map((item) => (
            <MediaSendTile
              key={item.id}
              file={item.file}
              over={blocked.includes(item)}
              onRemove={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))}
            />
          ))}
        </ul>

        {offersCompression && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 kub-raise">
            <input
              type="checkbox"
              checked={compress}
              onChange={(event) => setCompress(event.target.checked)}
              className={cn("mt-0.5 h-4 w-4 shrink-0 accent-[var(--kub-cyan)]", FOCUS_RING)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[color:var(--kub-text)]">Сжать изображение</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-[color:var(--kub-muted)]">
                {compress
                  ? "Фото и видео станут легче и отправятся быстрее."
                  : `Отправятся оригиналы без потери качества\u00a0— до\u00a0${MAX_ORIGINAL_ATTACHMENT_SIZE_LABEL} каждый.`}
              </span>
            </span>
          </label>
        )}

        {blocked.length > 0 && (
          <KubNotice tone="danger" role="alert" data-testid="media-send-limit-notice">
            {blocked.map((item) => originalLimitMessage(item.file, "desktop")).join(" ")}
          </KubNotice>
        )}

        {/* The product's own field. A field is aimed at and keeps its edge (rule
            11 of the interface material), and that edge is written once, in
            KubInput, so this dialog adds no perimeter of its own. */}
        <KubInput
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          onKeyDown={handleCaptionKeyDown}
          placeholder="Подпись"
          aria-label="Подпись"
          enterKeyHint="send"
          autoFocus
        />

      </div>
    </KubModal>
  );
}

function MediaSendTile({ file, over, onRemove }: { file: File; over: boolean; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const image = file.type.startsWith("image/");
  const video = file.type.startsWith("video/");

  useEffect(() => {
    if (!image && !video) return undefined;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, image, video]);

  return (
    <li
      data-testid="media-send-item"
      className={cn(
        "relative min-w-0 overflow-hidden rounded-xl bg-[var(--kub-inset)]",
        over && "outline-2 -outline-offset-2 outline-[color:var(--kub-danger)] [outline-style:solid]",
      )}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--kub-surface-3)]">
        {url && image && !broken ? (
          <img src={url} alt="" draggable={false} className="h-full w-full object-cover" onError={() => setBroken(true)} />
        ) : url && video && !broken ? (
          <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" onError={() => setBroken(true)} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[color:var(--kub-muted)]">
            <KubIcon name={video ? "video" : image ? "image" : "file"} size={28} />
          </div>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Убрать ${file.name}`}
          title="Убрать"
          className={cn(
            "kub-icon-action kub-interactive absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/70",
            FOCUS_RING,
          )}
        >
          <KubIcon name="close" size={16} />
        </button>
      </div>
      <div className="px-2.5 py-2">
        <div className="truncate text-xs font-medium text-[color:var(--kub-text)]">{file.name}</div>
        <div
          className={cn(
            "mt-0.5 truncate text-[12px] tabular-nums",
            over ? "text-[color:var(--kub-danger-text)]" : "text-[color:var(--kub-muted)]",
          )}
        >
          {over
            ? `${formatSizeRoundedUp(file.size)}\u00a0— больше ${MAX_ORIGINAL_ATTACHMENT_SIZE_LABEL}`
            : formatAttachmentSize(file.size)}
        </div>
      </div>
    </li>
  );
}
