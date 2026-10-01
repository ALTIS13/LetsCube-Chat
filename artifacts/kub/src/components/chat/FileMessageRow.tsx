"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { KubIcon } from "@/components/kub";
import type { KubIconName } from "@/components/kub/icons";
import { FOCUS_RING, FOCUS_RING_INSET, PRESS_SINK } from "@/lib/controlSurface";
import {
  documentFacts,
  documentPreviewOf,
  formatFileSize,
  previewEngineOf,
  type DocumentFacts,
  type DocumentFamily,
  type DocumentPreview,
} from "@/lib/documentPreview";
import { saveMediaAs } from "@/lib/messageMediaActions";
import { FormattedText, type MemberMentionsInText } from "@/lib/formatText";
import { cn } from "@/lib/utils";

/**
 * A file in a conversation, as Telegram draws one (tracker item 33,
 * `lib/documentPreview.ts`): a tile with its extension, its name, its size and
 * kind, and a button that says what a press does — an eye where it opens in
 * place, a download arrow where it cannot. It used to be a link with the file's
 * name, which opened a browser tab and said nothing about what was behind it.
 */

/** A tint per kind, from the product's own tones: the text reads on both grounds. */
const FAMILY_TONE: Record<DocumentFamily, string> = {
  pdf: "bg-[color-mix(in_srgb,var(--kub-danger)_16%,transparent)] text-[color:var(--kub-danger-text)]",
  doc: "bg-[color-mix(in_srgb,var(--kub-cyan)_16%,transparent)] text-[color:var(--kub-accent-text)]",
  sheet: "bg-[color-mix(in_srgb,var(--kub-online)_16%,transparent)] text-[color:var(--kub-online-text)]",
  slides: "bg-[color-mix(in_srgb,var(--kub-warn)_18%,transparent)] text-[color:var(--kub-text)]",
  archive: "bg-[color-mix(in_srgb,var(--kub-pink)_16%,transparent)] text-[color:var(--kub-text)]",
  text: "bg-[var(--kub-inset)] text-[color:var(--kub-muted)]",
  image: "bg-[color-mix(in_srgb,var(--kub-cyan)_16%,transparent)] text-[color:var(--kub-accent-text)]",
  video: "bg-[color-mix(in_srgb,var(--kub-cyan)_16%,transparent)] text-[color:var(--kub-accent-text)]",
  audio: "bg-[color-mix(in_srgb,var(--kub-cyan)_16%,transparent)] text-[color:var(--kub-accent-text)]",
  other: "bg-[var(--kub-inset)] text-[color:var(--kub-muted)]",
};

const PREVIEW_ICON: Record<DocumentPreview, KubIconName> = {
  pdf: "eye",
  text: "eye",
  image: "eye",
  video: "play",
  audio: "play",
};

export function FileMessageRow({
  content,
  mediaMetadata,
  url,
  members = null,
}: {
  content: string | null | undefined;
  mediaMetadata: unknown;
  /** Null while the file is still on its way, or while its address is being resolved. */
  url: string | null;
  members?: MemberMentionsInText | null;
}) {
  const facts = useMemo(() => documentFacts({ content, mediaMetadata }), [content, mediaMetadata]);
  const preview = useMemo(
    () =>
      typeof navigator === "undefined"
        ? null
        : documentPreviewOf(
            facts,
            previewEngineOf(navigator.userAgent, navigator.maxTouchPoints ?? 0, navigator.pdfViewerEnabled),
          ),
    [facts],
  );
  const [open, setOpen] = useState(false);
  const size = formatFileSize(facts.sizeBytes);
  const kindLine = [size, facts.extension === "ФАЙЛ" ? null : facts.extension].filter(Boolean).join(" · ");

  const press = () => {
    if (!url) return;
    if (preview) setOpen(true);
    else void saveMediaAs(url, facts.name);
  };

  return (
    <>
      <div className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        onClick={press}
        disabled={!url}
        data-testid="file-message"
        data-file-preview={preview ?? "download"}
        aria-label={preview ? `Открыть: ${facts.name}` : `Скачать: ${facts.name}`}
        className={cn(
          "flex w-full min-w-0 max-w-[18rem] items-center gap-3 rounded-lg py-0.5 pr-1 text-left kub-raise-hover",
          FOCUS_RING_INSET,
          PRESS_SINK,
          !url && "cursor-default",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold tracking-wide",
            FAMILY_TONE[facts.family],
          )}
        >
          {facts.extension === "ФАЙЛ" ? <KubIcon name="file" size={18} /> : facts.extension}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[color:var(--kub-text)]" data-testid="file-message-name">
            {facts.name}
          </span>
          {kindLine && (
            <span className="block truncate text-xs text-[color:var(--kub-muted)]" data-testid="file-message-kind">
              {kindLine}
            </span>
          )}
        </span>
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center text-[color:var(--kub-accent-text)]">
          {url ? (
            <KubIcon name={preview ? PREVIEW_ICON[preview] : "download"} size={18} />
          ) : (
            <KubIcon name="spinner" size={16} tone="muted" />
          )}
        </span>
      </button>
      {facts.caption && (
        // Under the file, as Telegram draws a document's caption.
        <p data-testid="file-message-caption" className="kub-message-text min-w-0 max-w-[18rem] whitespace-pre-wrap break-words text-[color:var(--kub-text)]">
          <FormattedText content={facts.caption} members={members} />
        </p>
      )}
      </div>
      {open && url && preview && (
        <DocumentViewer facts={facts} url={url} preview={preview} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/**
 * The file, in place: Telegram for iPhone's preview, as far as a browser draws
 * one without a plugin. Its name and size at the top with «Скачать» and
 * «Закрыть»; Escape closes it, and focus goes back to the row it came from.
 */
function DocumentViewer({
  facts,
  url,
  preview,
  onClose,
}: {
  facts: DocumentFacts;
  url: string;
  preview: DocumentPreview;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      returnTo?.focus?.();
    };
  }, [onClose]);

  useEffect(() => {
    if (preview !== "text") return undefined;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`the file answered ${response.status}`);
        setText(await response.text());
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [preview, url]);

  const size = formatFileSize(facts.sizeBytes);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={facts.name}
      data-testid="document-viewer"
      data-document-preview={preview}
      className="fixed inset-0 z-[91] flex flex-col bg-[color-mix(in_srgb,#000_96%,transparent)] pt-window-top pb-safe px-safe text-white"
    >
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold" data-testid="document-viewer-name">{facts.name}</div>
          {size && <div className="truncate text-xs text-white/70">{size}</div>}
        </div>
        <button
          type="button"
          onClick={() => void saveMediaAs(url, facts.name)}
          aria-label="Скачать"
          title="Скачать"
          className={cn("flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10", FOCUS_RING)}
        >
          <KubIcon name="download" size={20} />
        </button>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          title="Закрыть"
          data-testid="document-viewer-close"
          className={cn("flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10", FOCUS_RING)}
        >
          <KubIcon name="close" size={20} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-3 pb-3">
        {preview === "pdf" && (
          // An object rather than a frame, for what it does when the engine
          // cannot draw the file after all: it shows what is inside it.
          <object data={url} type="application/pdf" aria-label={facts.name} data-testid="document-viewer-pdf" className="h-full w-full max-w-5xl rounded-lg bg-white">
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-[color:var(--kub-muted)]">
              Этот PDF здесь не открылся.
              <button type="button" className="font-semibold text-[color:var(--kub-accent-text)] underline" onClick={() => void saveMediaAs(url, facts.name)}>
                Скачать
              </button>
            </div>
          </object>
        )}
        {preview === "image" && (
          <img src={url} alt={facts.name} className="max-h-full max-w-full object-contain" />
        )}
        {preview === "video" && (
          <video src={url} controls autoPlay playsInline className="max-h-full max-w-full" />
        )}
        {preview === "audio" && <audio src={url} controls autoPlay />}
        {preview === "text" && (
          failed ? (
            <div role="alert" className="text-center text-sm text-white/80">
              Не удалось открыть файл.{" "}
              <button type="button" className="underline" onClick={() => void saveMediaAs(url, facts.name)}>
                Скачать
              </button>
            </div>
          ) : text === null ? (
            <KubIcon name="spinner" size={22} className="text-white/80" />
          ) : (
            <pre
              data-testid="document-viewer-text"
              className="h-full w-full max-w-5xl overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#0d1117] p-4 font-mono text-[13px] leading-relaxed text-[#e6edf3]"
            >
              {text}
            </pre>
          )
        )}
      </div>
    </div>,
    document.body,
  );
}
