"use client";

import { KubIcon } from "@/components/kub";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MediaViewerItem {
  type: "image" | "video";
  url: string;
  title?: string;
}

interface MediaViewerProps {
  media: MediaViewerItem | null;
  onClose: () => void;
}

export function MediaViewer({ media, onClose }: MediaViewerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setLoadError(false);
  }, [media?.url]);

  useEffect(() => {
    if (!media) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [media, onClose]);

  if (!media) return null;
  if (typeof document === "undefined") return null;

  const title = media.title || (media.type === "image" ? "Фото" : "Видео");

  const openOriginal = () => {
    window.open(media.url, "_blank", "noopener,noreferrer");
  };

  const requestVideoFullscreen = async () => {
    const video = videoRef.current;
    if (!video || !video.requestFullscreen) return;
    try {
      await video.requestFullscreen();
    } catch (error) {
      console.warn("[media-viewer] fullscreen unavailable", error);
    }
  };

  // Rendered into the document body rather than where it was called from.
  //
  // `z-[90]` only means "above everything" while the viewer is a child of the
  // page. Opened from the profile card it is a child of a `z-[60]` window,
  // which is its own stacking context, so 90 is measured inside 60 and the
  // support window at `z-[70]` covered a full-screen photo. A portal takes the
  // viewer out of that context and lets its own z-index mean what it says.
  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="relative flex h-full max-h-[calc(100vh-24px)] w-full max-w-[min(1280px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-white/10 bg-black shadow-2xl sm:max-h-[calc(100vh-48px)] sm:max-w-[min(1440px,calc(100vw-48px))]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-white/10 bg-black/80 px-3 text-white">
          <KubIcon name={media.type === "image" ? "image" : "video"} size={18} />
          <div className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</div>
          <button
            type="button"
            onClick={openOriginal}
            className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <KubIcon name="externalLink" size={16} />
            <span className="hidden sm:inline">Открыть оригинал</span>
          </button>
          {media.type === "video" && (
            <button
              type="button"
              onClick={requestVideoFullscreen}
              className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <KubIcon name="externalLink" size={16} />
              <span className="hidden sm:inline">На весь экран</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Закрыть"
          >
            <KubIcon name="close" size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-2 sm:p-4">
          {loadError ? (
            <div className="max-w-sm rounded-xl border border-white/10 bg-white/5 p-5 text-center text-white">
              <KubIcon name="warning" size={24} className="mx-auto mb-3 text-white/70" />
              <div className="mb-2 text-sm font-semibold">
                {media.type === "image" ? "Не удалось загрузить изображение." : "Не удалось загрузить видео."}
              </div>
              <button
                type="button"
                onClick={openOriginal}
                className="mt-2 inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-white/85 transition-colors hover:bg-white/10 hover:text-white"
              >
                <KubIcon name="externalLink" size={16} />
                Открыть оригинал
              </button>
            </div>
          ) : media.type === "image" ? (
            <img
              src={media.url}
              alt={title}
              className="max-h-full max-w-full select-none object-contain"
              onError={() => setLoadError(true)}
            />
          ) : (
            <video
              ref={videoRef}
              src={media.url}
              controls
              preload="metadata"
              className="max-h-full max-w-full rounded-lg bg-black"
              onError={() => setLoadError(true)}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
