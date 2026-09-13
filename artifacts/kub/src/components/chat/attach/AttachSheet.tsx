import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import { requestAppConfirm, showAppAlert } from "@/lib/appDialogs";
import {
  ATTACH_SHEET_DEFAULT_TAB,
  ATTACH_SHEET_MAX_SELECTION,
  ATTACH_SHEET_PHONE_REST_SHARE,
  attachPicker,
  attachTab,
  attachTabSelection,
  fittedSheetHeight,
  offersHdPhotos,
  offersSendWithoutCompression,
  planAttachSend,
  releaseSheet,
  selectPicked,
  selectedInOrder,
  sheetContentHeight,
  sheetStretch,
  toggleSelection,
  trappedFocusIndex,
  type AttachIncoming,
  type AttachPickerKind,
  type AttachSendMode,
  type AttachSendRequest,
  type AttachTabId,
  type SheetDetent,
} from "@/lib/attachSheet";
import { FOCUS_RING } from "@/lib/controlSurface";
import {
  isCompressibleMediaType,
  mediaSendShape,
  mediaSendTitle,
  originalLimitAlertTitle,
  originalLimitMessage,
  type IncomingFilesSource,
} from "@/lib/mediaCompression";
import { photoSendQuality } from "@/lib/mediaQuality";
import { isNativeAndroid } from "@/lib/platform/capabilities";
import { cn } from "@/lib/utils";
import { AttachFilePanel, type AttachFileSource } from "./AttachFilePanel";
import { AttachGalleryPanel, type AttachGalleryEntry } from "./AttachGalleryPanel";
import { AttachLocationPanel } from "./AttachLocationPanel";
import { AttachMoreMenu } from "./AttachMoreMenu";
import { AttachPlaceholderPanel } from "./AttachPlaceholderPanel";
import { AttachSendBar } from "./AttachSendBar";
import { AttachTabs, attachPanelElementId, attachTabElementId } from "./AttachTabs";
import { attachPickKind, type AttachPick } from "./attachTypes";

const PICKER_KINDS: readonly AttachPickerKind[] = ["camera", "library", "library-original", "file"];
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="file"]), [tabindex]:not([tabindex="-1"])';

/** The tallest the desktop panel is drawn, and never past the window. */
const DESKTOP_CEILING = "min(33rem, calc(100dvh - 11rem))";

export interface AttachSheetProps {
  /** Files that open the sheet from outside it: pasted, dropped, or shot on a webcam. */
  incoming?: AttachIncoming | null;
  onIncomingTaken?: () => void;
  onClose: () => void;
  onSendMedia: (request: AttachSendRequest) => void;
  onSendLocation: (latitude: number, longitude: number) => void;
  /** A desktop has no camera app behind `capture`; its webcam dialog stands in. */
  onOpenWebcam?: () => void;
}

/**
 * Telegram's attach sheet, in «Стеклянная капсула» — the look the owner chose on
 * 2026-09-12 (D-122). This is the composer's attach flow on every shell: the
 * browser, the installed iPhone app, Android and Windows. There is no switch and
 * no other look; the menu of buttons it replaces is gone, and so is the
 * desktop's send dialog.
 *
 * Every tab does its job in place. «Галерея» opens first and fills with what is
 * picked, selected and numbered, with a caption and a send button that sends
 * compressed; «…» holds «Отправить без сжатия». «Файл» lists Telegram's two
 * sources and sends originals. «Геопозиция» shows the place and sends it only
 * from its row. «Опрос», «Список» and «Контакт» are placeholders that say they
 * are coming. Voice and round video stay on the composer's microphone button, as
 * in Telegram.
 *
 * The sheet is as tall as what it holds, up to two thirds of a phone's screen:
 * two tiles make a short sheet, picks grow it, and past that height the content
 * scrolls. On a phone it is a sheet inset from every edge, over the
 * conversation: a handle to drag it to full height or down to close, a dimmed
 * backdrop that closes it, and «Отменить выбор?» before anything selected is
 * thrown away. On a desktop it is a panel above the composer, 390 points wide as
 * Telegram's iPad panel is. Both trap Tab and close on Escape. Nothing asks for
 * a permission or opens a camera because the sheet opened.
 */
export default function AttachSheet({
  incoming = null,
  onIncomingTaken,
  onClose,
  onSendMedia,
  onSendLocation,
  onOpenWebcam,
}: AttachSheetProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const [shape] = useState(() => mediaSendShape(typeof window === "undefined" ? null : window.matchMedia?.bind(window)));
  const phone = shape === "phone";
  const [androidNative] = useState(() => isNativeAndroid());
  const [tab, setTab] = useState<AttachTabId>(ATTACH_SHEET_DEFAULT_TAB);
  const [detent, setDetent] = useState<SheetDetent>("rest");
  const [gallery, setGallery] = useState<AttachPick[]>([]);
  const [gallerySelected, setGallerySelected] = useState<string[]>([]);
  const [files, setFiles] = useState<AttachPick[]>([]);
  const [filesSelected, setFilesSelected] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  // Off for every send, and not remembered between them: the objection D-119
  // recorded was to being asked and then having the answer applied for ever
  // afterwards. The sheet unmounts with the send, so this resets itself.
  const [hd, setHd] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragFrom, setDragFrom] = useState(0);
  const [dragging, setDragging] = useState(false);
  /** The height the sheet's content asks for, measured; null until it has been. */
  const [fit, setFit] = useState<number | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Partial<Record<AttachTabId, HTMLButtonElement | null>>>({});
  const inputRefs = useRef<Partial<Record<AttachPickerKind, HTMLInputElement | null>>>({});
  const urlsRef = useRef<string[]>([]);
  const nextIdRef = useRef(1);
  const takenIncomingRef = useRef<number | null>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; lastY: number; lastT: number; velocity: number; height: number } | null>(null);

  // ── what is picked ─────────────────────────────────────────────────────────

  const addPicks = useCallback(
    (list: File[], source: IncomingFilesSource, originals: boolean) => {
      if (!list.length) return;
      const make = (file: File): AttachPick => {
        const kind = attachPickKind(file);
        const url = kind === "file" ? null : URL.createObjectURL(file);
        if (url) urlsRef.current.push(url);
        return { id: `attach-pick-${nextIdRef.current++}`, file, kind, url, source };
      };
      // Photos and videos for the gallery's grid; originals and documents for «Файл».
      const toGallery = originals ? [] : list.filter((file) => isCompressibleMediaType(file.type)).map(make);
      const toFiles = (originals ? list : list.filter((file) => !isCompressibleMediaType(file.type))).map(make);
      let refused = 0;
      if (toGallery.length) {
        const next = selectPicked(gallerySelected, toGallery.map((pick) => pick.id));
        refused += next.refused;
        setGallery((current) => [...current, ...toGallery]);
        setGallerySelected(next.selected);
      }
      if (toFiles.length) {
        const next = selectPicked(filesSelected, toFiles.map((pick) => pick.id));
        refused += next.refused;
        setFiles((current) => [...current, ...toFiles]);
        setFilesSelected(next.selected);
      }
      setTab(toGallery.length || !toFiles.length ? "gallery" : "file");
      setMenuOpen(false);
      if (refused) showAppAlert(`Можно выбрать не больше ${ATTACH_SHEET_MAX_SELECTION} файлов за раз.`, "Вложения");
    },
    [filesSelected, gallerySelected],
  );

  useEffect(() => {
    if (!incoming || takenIncomingRef.current === incoming.id) return;
    takenIncomingRef.current = incoming.id;
    addPicks(incoming.files, incoming.source, false);
    onIncomingTaken?.();
  }, [addPicks, incoming, onIncomingTaken]);

  useEffect(
    () => () => {
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
      urlsRef.current = [];
    },
    [],
  );

  // The keyboard goes down and the focus comes into the sheet; a desktop gets its
  // focus back when the sheet closes, a phone does not raise its keyboard again.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previous?.blur();
    const frame = requestAnimationFrame(() => tabRefs.current[ATTACH_SHEET_DEFAULT_TAB]?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      if (!phone && previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [phone]);

  // ── how tall it is ─────────────────────────────────────────────────────────

  // What the content asks for is measured rather than worked out, so a tab, a
  // pick, a failed position and the keyboard's inset all count the same way.
  // Watching the scrolling part as well as its content catches the chrome
  // changing around it: the tabs giving way to the send capsule, the keyboard.
  const measureFit = useCallback(() => {
    const sheet = sheetRef.current;
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!sheet || !scroller || !content) return;
    const next = sheetContentHeight({
      sheet: sheet.getBoundingClientRect().height,
      scroller: scroller.getBoundingClientRect().height,
      content: content.getBoundingClientRect().height,
    });
    setFit((current) => (current === next ? current : next));
  }, []);

  useLayoutEffect(() => {
    measureFit();
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measureFit);
    observer.observe(content);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [measureFit]);

  // «Геопозиция» and the placeholders have no selection, so they never show a
  // caption, a send button or «…».
  const selectionScope = attachTabSelection(tab);
  const activePicks = selectionScope === "file" ? files : selectionScope === "gallery" ? gallery : [];
  const activeSelected = selectionScope === "file" ? filesSelected : selectionScope === "gallery" ? gallerySelected : [];
  const chosen = selectedInOrder(activePicks, activeSelected);
  const chosenFiles = chosen.map((pick) => pick.file);
  const offersOriginal = offersSendWithoutCompression(tab, chosenFiles);
  const offersHd = offersHdPhotos(tab, chosenFiles);
  const selecting = chosen.length > 0;

  const requestClose = useCallback(() => {
    if (!gallerySelected.length && !filesSelected.length) {
      onClose();
      return;
    }
    void requestAppConfirm({ title: "Отменить выбор?", confirmLabel: "Отменить выбор", cancelLabel: "Продолжить" }).then(
      (confirmed) => {
        if (confirmed) onClose();
      },
    );
  }, [filesSelected.length, gallerySelected.length, onClose]);

  const send = (mode: AttachSendMode) => {
    if (!chosen.length) return;
    setMenuOpen(false);
    const plan = planAttachSend(chosenFiles, tab === "file" ? "original" : mode);
    if (plan.refused.length) {
      showAppAlert(
        plan.refused.map((file) => originalLimitMessage(file)).filter(Boolean).join("\n"),
        originalLimitAlertTitle(plan.refused.length),
      );
    }
    if (!plan.send.length) return;
    onSendMedia({
      files: plan.send,
      compress: plan.compress,
      caption: caption.trim(),
      source: chosen[0].source,
      // Named on every send rather than defaulted somewhere downstream, so
      // the one place that decides is the one the person pressed.
      photoQuality: photoSendQuality(hd),
    });
    onClose();
  };

  const selectTab = (next: AttachTabId) => {
    setMenuOpen(false);
    setTab(next);
  };

  const openPicker = (kind: AttachPickerKind) => inputRefs.current[kind]?.click();

  const galleryEntries: AttachGalleryEntry[] = [];
  if (phone) galleryEntries.push({ id: "camera", label: "Камера", icon: "camera", onPress: () => openPicker("camera") });
  else if (onOpenWebcam) galleryEntries.push({ id: "camera", label: "Камера", icon: "camera", onPress: onOpenWebcam });
  galleryEntries.push({ id: "library", label: "Фото и видео", icon: "image", onPress: () => openPicker("library") });

  // Telegram's two rows on iOS, in its order and words. The subtitles say what
  // D-119 made them mean here.
  const fileSources: AttachFileSource[] = [
    {
      id: "library-original",
      title: "Выбрать из Галереи",
      subtitle: "Фото и видео без сжатия",
      icon: "imageOriginal",
      onPress: () => openPicker("library-original"),
    },
    {
      id: "file",
      title: "Выбрать из файлов",
      subtitle: phone ? "Документы и другие файлы" : "Файлы с компьютера",
      icon: "folderOpen",
      onPress: () => openPicker("file"),
    },
  ];

  // ── keys and dragging ──────────────────────────────────────────────────────

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (menuOpen) setMenuOpen(false);
      else requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    const root = sheetRef.current;
    if (!root) return;
    const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (node) => node.tabIndex >= 0 && node.getClientRects().length > 0,
    );
    if (!focusables.length) return;
    const current = focusables.indexOf(document.activeElement as HTMLElement);
    const atEdge = current < 0 || (event.shiftKey ? current === 0 : current === focusables.length - 1);
    if (!atEdge) return;
    event.preventDefault();
    focusables[trappedFocusIndex(current, focusables.length, event.shiftKey)]?.focus();
  };

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!phone || event.button !== 0) return;
    // A finger landing on a control in the handle's row — the way out, «…» — is
    // pressing it, not dragging the sheet.
    if ((event.target as HTMLElement).closest("button, input, [role='tab'], [role='tablist']")) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const height = sheetRef.current?.getBoundingClientRect().height ?? 0;
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, lastY: event.clientY, lastT: event.timeStamp, velocity: 0, height };
    setDragFrom(height);
    setDragging(true);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const elapsed = Math.max(1, event.timeStamp - drag.lastT);
    drag.velocity = (event.clientY - drag.lastY) / elapsed;
    drag.lastY = event.clientY;
    drag.lastT = event.timeStamp;
    setDragY(event.clientY - drag.startY);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    setDragY(0);
    const viewport = window.innerHeight || 1;
    // The height each detent draws the sheet at, which is the content's own
    // wherever that is less; with nothing more to show the two are one.
    const content = fit ?? drag.height;
    const result = releaseSheet({
      detent,
      dy: event.clientY - drag.startY,
      velocity: drag.velocity,
      restHeight: Math.min(content, viewport * ATTACH_SHEET_PHONE_REST_SHARE),
      fullHeight: Math.min(content, viewport * 0.92),
    });
    if (result === "close") requestClose();
    else setDetent(result);
  };

  // ── geometry ───────────────────────────────────────────────────────────────

  let frameStyle: CSSProperties;
  if (phone) {
    // The keys cover the home indicator, so the larger of the two, never the sum
    // (rule 13); the sheet grows by it rather than its content shrinking.
    const inset = "max(var(--kub-keyboard-inset, 0px), var(--kub-safe-bottom))";
    const available = `calc(100dvh - var(--kub-safe-top) - 0.75rem - ${inset} - 0.5rem)`;
    const resting = `min(${available}, ${Math.round(ATTACH_SHEET_PHONE_REST_SHARE * 100)}dvh)`;
    frameStyle = {
      ...fittedSheetHeight({
        ceiling: detent === "full" ? available : resting,
        content: fit,
        stretch: dragging ? sheetStretch({ dy: dragY, height: dragFrom, content: fit }) : 0,
        available,
      }),
      transform: dragY > 0 ? `translateY(${Math.round(dragY)}px)` : undefined,
      bottom: `calc(${inset} + 0.5rem)`,
    };
  } else {
    frameStyle = fittedSheetHeight({ ceiling: DESKTOP_CEILING, content: fit });
  }

  const frameClass = phone
    ? cn(
        "fixed inset-x-2 z-40 flex flex-col overflow-hidden rounded-[2.125rem]",
        "starting:translate-y-full motion-safe:transition-[translate,height,transform] motion-safe:duration-300 motion-safe:ease-[cubic-bezier(.16,1,.3,1)]",
        dragging && "motion-safe:transition-none",
      )
    : cn(
        // The composer's capsules stand 16px in from `md`, and the panel opens
        // over the attach button.
        "absolute bottom-full left-3 z-40 mb-2 flex w-[min(24.375rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[1.75rem] md:left-4",
        "starting:translate-y-2 starting:opacity-0 motion-safe:transition-[translate,opacity,height] motion-safe:duration-200",
      );

  // ── parts ──────────────────────────────────────────────────────────────────

  const currentTab = attachTab(tab);
  // Where the glass capsule says how many go, once something is selected.
  const title = selecting ? `Выбрано ${chosen.length}` : currentTab.label;

  const tabs = <AttachTabs baseId={baseId} active={tab} onSelect={selectTab} tabRefs={tabRefs} />;

  const closeButton = (
    <button
      type="button"
      onClick={requestClose}
      aria-label="Закрыть"
      data-testid="attach-sheet-close"
      className={cn(
        "kub-icon-action kub-interactive relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[color:var(--kub-text)] transition-colors",
        FOCUS_RING,
      )}
    >
      <KubGlassLayer className="rounded-full border border-[color:var(--glass-line)]" />
      <KubIcon name="close" size={20} className="relative" />
    </button>
  );

  const moreMenu = offersOriginal ? (
    <AttachMoreMenu open={menuOpen} onOpenChange={setMenuOpen} onSendOriginal={() => send("original")} />
  ) : null;

  const header = phone ? (
    <div
      data-attach-drag-handle=""
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="relative z-10 shrink-0 touch-none select-none"
    >
      <div className="flex justify-center pb-1 pt-[5px]">
        <span aria-hidden="true" className="h-[5px] w-9 rounded-full bg-[color:var(--kub-muted)]/45" />
      </div>
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 px-2.5 pb-2">
        {closeButton}
        <h2 id={titleId} className="truncate text-center text-[17px] font-semibold text-[color:var(--kub-text)]">
          {title}
        </h2>
        {moreMenu ?? <span aria-hidden="true" />}
      </div>
    </div>
  ) : (
    <div className="relative z-10 flex shrink-0 items-center gap-1 px-3 pb-2 pt-2.5">
      <h2 id={titleId} className="min-w-0 flex-1 truncate pl-1 text-[15px] font-semibold text-[color:var(--kub-text)]">
        {title}
      </h2>
      {moreMenu}
      {closeButton}
    </div>
  );

  // At the foot: the glass capsule, as the tabs until something is selected and
  // as the caption and send capsule after that — floating over the photos.
  const sendBar = selecting ? (
    <AttachSendBar
      sendLabel={mediaSendTitle(chosenFiles)}
      caption={caption}
      onCaptionChange={setCaption}
      onSend={() => send("compressed")}
      hdAvailable={offersHd}
      hd={hd}
      onHdChange={setHd}
    />
  ) : null;
  const bottom = selecting ? null : <div className="flex shrink-0 justify-center px-4 pb-3 pt-1.5">{tabs}</div>;

  const panel = (
    <div
      role="tabpanel"
      id={attachPanelElementId(baseId, tab)}
      aria-labelledby={attachTabElementId(baseId, tab)}
      data-testid="attach-sheet-panel"
      className="relative flex min-h-0 flex-1 flex-col"
    >
      <div ref={scrollRef} data-attach-scroll="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* With nothing at the foot to end on, the content keeps a margin of its own. */}
        <div ref={contentRef} data-attach-content="" className={cn(!bottom && !selecting && "pb-3")}>
          {tab === "gallery" && (
            <AttachGalleryPanel
              entries={galleryEntries}
              picks={gallery}
              selected={gallerySelected}
              onToggle={(id) => setGallerySelected((current) => toggleSelection(current, id))}
              reserveBottom={selecting}
            />
          )}
          {tab === "file" && (
            <AttachFilePanel
              sources={fileSources}
              picks={files}
              selected={filesSelected}
              onToggle={(id) => setFilesSelected((current) => toggleSelection(current, id))}
              reserveBottom={selecting}
            />
          )}
          {tab === "location" && (
            <AttachLocationPanel
              onSend={(latitude, longitude) => {
                onSendLocation(latitude, longitude);
                onClose();
              }}
            />
          )}
          {currentTab.kind === "placeholder" && <AttachPlaceholderPanel tab={currentTab} />}
        </div>
      </div>
      {sendBar}
    </div>
  );

  return (
    <>
      <div
        aria-hidden="true"
        data-testid="attach-sheet-backdrop"
        onClick={requestClose}
        className={cn("fixed inset-0 z-40", phone && "kub-message-scrim")}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="attach-sheet"
        data-attach-shape={shape}
        data-attach-tab={tab}
        data-attach-detent={detent}
        onKeyDown={handleKeyDown}
        className={frameClass}
        style={frameStyle}
      >
        <KubGlassLayer strong className="rounded-[inherit] border border-[color:var(--glass-line)]" />
        <div className="relative flex min-h-0 flex-1 flex-col">
          {header}
          {panel}
          {bottom}
        </div>
        {PICKER_KINDS.map((kind) => {
          const picker = attachPicker(kind, { androidNative });
          return (
            <input
              key={kind}
              ref={(node) => {
                inputRefs.current[kind] = node;
              }}
              type="file"
              tabIndex={-1}
              aria-hidden="true"
              className="hidden"
              data-attach-picker={kind}
              accept={picker.accept ?? undefined}
              capture={picker.capture ?? undefined}
              multiple={picker.multiple}
              onChange={(event) => {
                const list = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
                event.currentTarget.value = "";
                addPicks(list, picker.source, !picker.compress);
              }}
            />
          );
        })}
      </div>
    </>
  );
}
