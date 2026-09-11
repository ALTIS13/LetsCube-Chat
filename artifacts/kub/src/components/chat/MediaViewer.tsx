"use client";

import { KubIcon } from "@/components/kub";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  TAP_SLOP_PX,
  ZOOM_AT_REST,
  claimsDrag,
  clampZoom,
  isDoubleTap,
  isZoomed,
  panBy,
  pinchGeometry,
  pinchZoom,
  toggleZoomAt,
  wheelZoomFactor,
  zoomAt,
  zoomTransform,
  type PinchStart,
  type ZoomPoint,
  type ZoomSize,
  type ZoomState,
  type ZoomTap,
} from "@/lib/mediaZoom";

export interface MediaViewerItem {
  type: "image" | "video";
  url: string;
  title?: string;
  /** Sent without compression: `url` is the original, as it was picked. */
  original?: boolean;
  /** A lighter picture to show while an original photo loads. */
  previewUrl?: string;
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
  // The zoom stage pads itself, so a zoomed picture can run to the frame's edge
  // while one at rest keeps exactly the margin it had.
  const zoomable = media.type === "image" && !loadError;

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
      // The frame keeps its 12px (24px from `sm`) from every edge, or the inset
      // where the hardware takes more, so its close button is never under the
      // Dynamic Island.
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-safe-gap backdrop-blur-sm [--kub-safe-gap:0.75rem] sm:[--kub-safe-gap:1.5rem]"
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
          {media.original ? (
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="min-w-0 truncate text-sm font-semibold">{title}</span>
              <span className="shrink-0 text-xs font-medium text-white/70">Оригинал</span>
            </div>
          ) : (
            <div className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</div>
          )}
          <button
            type="button"
            onClick={openOriginal}
            // Below `sm` the words are hidden and only the icon is drawn, which
            // left the button with no name at all on a phone.
            aria-label="Открыть оригинал"
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

        <div className={cn("flex min-h-0 flex-1 items-center justify-center bg-black", !zoomable && "p-2 sm:p-4")}>
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
            // Keyed by the address, so another photo — or the same one opened
            // again after closing — always starts at rest. Closing unmounts it.
            <ZoomableImage
              key={media.url}
              url={media.url}
              previewUrl={media.previewUrl}
              title={title}
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

type TrackedPointer = { x: number; y: number; downX: number; downY: number };

type ZoomGesture =
  | { kind: "pan"; pointerId: number; origin: ZoomPoint; start: ZoomState }
  | { kind: "pinch"; ids: [number, number]; start: PinchStart }
  | null;

type StageGeometry = { stage: ZoomSize; picture: ZoomSize; centre: ZoomPoint };

/**
 * The photo, and the gestures that zoom it.
 *
 * "Нельзя увеличить фото". The page refuses page zoom on purpose —
 * `maximum-scale=1, user-scalable=no` — so a photo could only be seen fitted
 * to the screen. The viewer zooms instead: a pinch, a double tap or a double
 * click at the point, Ctrl with the wheel (which is also how a trackpad pinch
 * arrives in Chromium and Firefox; Safari's gesture events are not handled),
 * and a drag to pan once zoomed. What each gesture does to the
 * picture is decided in `lib/mediaZoom.ts`; this component only turns events
 * into those calls.
 *
 * The stage clips the picture, so however far it is zoomed it is drawn inside
 * the frame, and the frame already keeps clear of the unsafe areas
 * (`p-safe-gap`, rule 13 of the interface material). The header, with the only
 * way out, sits outside the stage and stays on top of a zoomed picture.
 *
 * At rest a one-finger drag is not claimed — it moves nothing and is left to
 * propagate — so a swipe on whatever holds the viewer and panning can never
 * both answer the same drag. Zoomed, a drag pans and stops here.
 */
function ZoomableImage({
  url,
  previewUrl,
  title,
  onError,
}: {
  url: string;
  previewUrl?: string;
  title: string;
  onError: () => void;
}) {
  // An original can be tens of megabytes. Until it has loaded, the preview the
  // conversation already drew is laid behind the empty picture — as the stage's
  // background, so the one `<img>` the zoom measures is still the original and
  // nothing about the arithmetic changes when it arrives.
  const [pictureLoaded, setPictureLoaded] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pictureRef = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState<ZoomState>(ZOOM_AT_REST);
  const [dragging, setDragging] = useState(false);
  // The state the next event computes from. Several pointer events can arrive
  // between two renders, and each has to build on the one before it.
  const zoomRef = useRef<ZoomState>(ZOOM_AT_REST);
  const pointersRef = useRef(new Map<number, TrackedPointer>());
  const gestureRef = useRef<ZoomGesture>(null);
  const lastTapRef = useRef<ZoomTap | null>(null);
  // A second finger turns the whole touch into a pinch, so none of its fingers
  // lifting may count as a tap.
  const multiTouchRef = useRef(false);
  const lastPointerTypeRef = useRef("mouse");

  const apply = useCallback((next: ZoomState) => {
    zoomRef.current = next;
    setZoom(next);
  }, []);

  /** The stage and the picture's fitted size, read now; null until the picture has a size. */
  const measure = useCallback((): StageGeometry | null => {
    const stage = stageRef.current;
    const picture = pictureRef.current;
    // `offsetWidth` is the layout box, which a transform does not change: the
    // fitted size, whatever the zoom.
    if (!stage || !picture || picture.offsetWidth === 0 || picture.offsetHeight === 0) return null;
    const rect = stage.getBoundingClientRect();
    return {
      stage: { width: rect.width, height: rect.height },
      picture: { width: picture.offsetWidth, height: picture.offsetHeight },
      centre: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    };
  }, []);

  const reclamp = useCallback(() => {
    const geometry = measure();
    if (!geometry) return;
    const current = zoomRef.current;
    const next = clampZoom(current, geometry.picture, geometry.stage);
    if (next.scale !== current.scale || next.x !== current.x || next.y !== current.y) apply(next);
  }, [apply, measure]);

  // Ctrl with the wheel, and a trackpad pinch, which Chromium and Firefox deliver
  // as exactly that (Safari sends its own gesture events, not read here). A
  // native listener, because React's wheel handler is passive and cannot stop
  // the browser zooming the whole page instead.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const geometry = measure();
      if (!geometry) return;
      const current = zoomRef.current;
      apply(zoomAt(
        current,
        current.scale * wheelZoomFactor(event.deltaY, event.deltaMode),
        relativeTo(geometry, { x: event.clientX, y: event.clientY }),
        geometry.picture,
        geometry.stage,
      ));
    };
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [apply, measure]);

  // A stage that changes size — a phone turned sideways — moves the limits, and
  // a picture panned to the old edge would otherwise stay past the new one.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(reclamp);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [reclamp]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    lastPointerTypeRef.current = event.pointerType;
    const pointers = pointersRef.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, downX: event.clientX, downY: event.clientY });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer considers active cannot be captured;
      // the gesture still works for as long as its events reach the stage.
    }

    const geometry = measure();
    if (!geometry) return;

    if (pointers.size >= 2) {
      const [first, second] = Array.from(pointers.entries());
      multiTouchRef.current = true;
      lastTapRef.current = null;
      const { distance, midpoint } = pinchGeometry(relativeTo(geometry, first[1]), relativeTo(geometry, second[1]));
      gestureRef.current = {
        kind: "pinch",
        ids: [first[0], second[0]],
        start: { state: zoomRef.current, distance, midpoint },
      };
      setDragging(true);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (claimsDrag(zoomRef.current)) {
      gestureRef.current = {
        kind: "pan",
        pointerId: event.pointerId,
        origin: { x: event.clientX, y: event.clientY },
        start: zoomRef.current,
      };
      setDragging(true);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    gestureRef.current = null;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    const tracked = pointers.get(event.pointerId);
    if (!tracked) return;
    tracked.x = event.clientX;
    tracked.y = event.clientY;
    const gesture = gestureRef.current;
    if (!gesture) return;
    const geometry = measure();
    if (!geometry) return;

    if (gesture.kind === "pinch") {
      const first = pointers.get(gesture.ids[0]);
      const second = pointers.get(gesture.ids[1]);
      if (!first || !second) return;
      const { distance, midpoint } = pinchGeometry(relativeTo(geometry, first), relativeTo(geometry, second));
      apply(pinchZoom(gesture.start, distance, midpoint, geometry.picture, geometry.stage));
    } else if (gesture.pointerId === event.pointerId) {
      apply(panBy(
        gesture.start,
        { x: event.clientX - gesture.origin.x, y: event.clientY - gesture.origin.y },
        geometry.picture,
        geometry.stage,
      ));
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const pointers = pointersRef.current;
    const tracked = pointers.get(event.pointerId);
    if (!tracked) return;
    pointers.delete(event.pointerId);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Already released, or never captured.
    }

    const gesture = gestureRef.current;
    const wasMultiTouch = multiTouchRef.current;
    if (pointers.size === 0) multiTouchRef.current = false;

    if (gesture?.kind === "pinch") {
      // One finger lifted: the other carries on panning from where it is, if
      // there is anything left to pan.
      const remaining = Array.from(pointers.entries())[0];
      if (remaining && claimsDrag(zoomRef.current)) {
        gestureRef.current = {
          kind: "pan",
          pointerId: remaining[0],
          origin: { x: remaining[1].x, y: remaining[1].y },
          start: zoomRef.current,
        };
      } else {
        gestureRef.current = null;
        setDragging(false);
      }
      event.stopPropagation();
      return;
    }

    if (gesture?.kind === "pan" && gesture.pointerId === event.pointerId) {
      gestureRef.current = null;
      setDragging(false);
      event.stopPropagation();
    }

    // A tap is a touch or a pen that lifted close to where it landed. A mouse
    // double click is the browser's to recognise; see `handleDoubleClick`.
    if (cancelled || wasMultiTouch || event.pointerType === "mouse") return;
    if (Math.hypot(event.clientX - tracked.downX, event.clientY - tracked.downY) > TAP_SLOP_PX) {
      lastTapRef.current = null;
      return;
    }
    const geometry = measure();
    if (!geometry) return;
    const tap: ZoomTap = { time: event.timeStamp, x: event.clientX, y: event.clientY };
    if (isDoubleTap(lastTapRef.current, tap)) {
      lastTapRef.current = null;
      apply(toggleZoomAt(zoomRef.current, relativeTo(geometry, tap), geometry.picture, geometry.stage));
      event.stopPropagation();
    } else {
      lastTapRef.current = tap;
    }
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // A touch screen can report a double tap as a double click as well, after
    // the pointer handlers have already toggled; answering both would zoom in
    // and straight back out.
    if (lastPointerTypeRef.current !== "mouse") return;
    const geometry = measure();
    if (!geometry) return;
    event.preventDefault();
    event.stopPropagation();
    apply(toggleZoomAt(
      zoomRef.current,
      relativeTo(geometry, { x: event.clientX, y: event.clientY }),
      geometry.picture,
      geometry.stage,
    ));
  };

  const zoomed = isZoomed(zoom);

  return (
    <div
      ref={stageRef}
      data-testid="media-viewer-stage"
      data-zoomed={zoomed ? "true" : "false"}
      className={cn(
        // `touch-none`: the browser's own panning and zooming would answer the
        // same fingers. The padding is the margin the picture had at rest.
        "flex h-full w-full touch-none select-none items-center justify-center p-2 sm:p-4",
        // The clip only while zoomed. At rest the picture fits the stage and
        // there is nothing to clip, and the clip is not free: photographed at
        // 1440x900, a stage that clipped at rest drew the picture 556 pixels
        // differently from the viewer before zoom existed — all on the
        // anti-aliased edge of a curve at a fractional position — where without
        // it the two are identical. Zoomed, it keeps the picture off the header
        // and inside the frame (rule 13), and it arrives in the commit that
        // applies the transform.
        zoomed && "overflow-hidden",
        zoomed ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in",
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => handlePointerEnd(event, false)}
      onPointerCancel={(event) => handlePointerEnd(event, true)}
      onDoubleClick={handleDoubleClick}
      style={previewUrl && !pictureLoaded ? {
        backgroundImage: `url(${JSON.stringify(previewUrl)})`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
        backgroundSize: "contain",
        backgroundOrigin: "content-box",
        backgroundClip: "content-box",
      } : undefined}
    >
      <img
        ref={pictureRef}
        src={url}
        alt={title}
        draggable={false}
        className="max-h-full max-w-full select-none object-contain"
        style={{ transform: zoomTransform(zoom) }}
        onLoad={() => {
          setPictureLoaded(true);
          reclamp();
        }}
        onError={onError}
      />
    </div>
  );
}

/** A client point, relative to the stage's centre — the frame the zoom arithmetic works in. */
function relativeTo(geometry: StageGeometry, point: ZoomPoint): ZoomPoint {
  return { x: point.x - geometry.centre.x, y: point.y - geometry.centre.y };
}
