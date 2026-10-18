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
import { createPortal } from "react-dom";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import { requestAppConfirm, showAppAlert } from "@/lib/appDialogs";
import { useReloadGuard } from "@/hooks/useReloadGuard";
import {
  ATTACH_SHEET_DEFAULT_TAB,
  ATTACH_SHEET_MAX_SELECTION,
  ATTACH_SHEET_PHONE_REST_SHARE,
  attachPicker,
  attachTab,
  attachTabSelection,
  fittedSheetHeight,
  moveSelected,
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
import { showActionFeedback } from "@/lib/actionFeedback";
import {
  PHOTO_RESOLUTION_STORAGE_KEY,
  PHOTO_SEND_ORIGINAL_HINT,
  PHOTO_SEND_QUALITY_FEEDBACK_KEY,
  photoResolutionToStore,
  photoSendQuality,
  photoSendQualitySentence,
  readStoredPhotoResolution,
} from "@/lib/mediaQuality";
import { useVideoSendLadder } from "@/hooks/useVideoSendLadder";
import { isNativeAndroid } from "@/lib/platform/capabilities";
import { cn } from "@/lib/utils";
import { AttachFilePanel, type AttachFileSource } from "./AttachFilePanel";
import { AttachGalleryPanel, type AttachGalleryEntry } from "./AttachGalleryPanel";
import { AttachLocationPanel } from "./AttachLocationPanel";
import { AttachMoreMenu } from "./AttachMoreMenu";
import { AttachPlaceholderPanel } from "./AttachPlaceholderPanel";
import { AttachSendBar } from "./AttachSendBar";
import { createMentionText, rebaseMentionText, trimMentionText, type MessageMentionsV1 } from "@/lib/memberMentions";
import { AttachTabs, attachPanelElementId, attachTabElementId } from "./AttachTabs";
import { AttachVideoProgressRow, AttachVideoQualityRow } from "./AttachVideoQuality";
import { attachPickKind, type AttachPick } from "./attachTypes";
import { useAppStore } from "@/store/app.store";
import { isCanvasPhotoCandidate } from "@/lib/photoEncoding";
import type { PhotoEditResult } from "@/lib/photoEdit";
import type { VideoEditResult } from "@/lib/videoEdit";
import type { MediaQuality } from "@/lib/mediaQuality";

type PhotoEditor = typeof import("./AttachPhotoEditor").default;
type VideoEditor = typeof import("./AttachVideoEditor").default;
type MediaEditResult = PhotoEditResult | VideoEditResult;
type EditingMedia = { pick: AttachPick; version: number; selected: boolean; quality: MediaQuality };

const PICKER_KINDS: readonly AttachPickerKind[] = ["camera", "library", "library-original", "file"];
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="file"]), [tabindex]:not([tabindex="-1"])';

/** The tallest the desktop panel is drawn, and never past the window. */
const DESKTOP_CEILING = "min(33rem, calc(100dvh - 11rem))";

function AttachEditorLoading({ failed, onCancel }: { failed: boolean; onCancel: () => void }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusInside = () => buttonRef.current?.focus({ preventScroll: true });
    const focus = (event: FocusEvent) => { if (event.target !== buttonRef.current) focusInside(); };
    const keys = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelRef.current();
      } else if (event.key === "Tab") {
        event.preventDefault();
        event.stopImmediatePropagation();
        focusInside();
      }
    };
    document.addEventListener("focusin", focus, true);
    document.addEventListener("keydown", keys, true);
    focusInside();
    return () => {
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("keydown", keys, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div role="dialog" aria-modal="true" aria-label="Редактор вложения" data-photo-editor-loading=""
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 bg-[var(--kub-bg)] text-[color:var(--kub-text)]">
      {failed ? <p role="alert">Не удалось открыть редактор. Файл не изменён.</p> : <KubIcon name="spinner" spin size={28} />}
      <button ref={buttonRef} type="button" onClick={onCancel} className={cn("min-h-11 rounded px-4", FOCUS_RING)}>Отмена</button>
    </div>
  );
}

export interface AttachSheetProps {
  /** Files that open the sheet from outside it: pasted, dropped, or shot on a webcam. */
  incoming?: AttachIncoming | null;
  onIncomingTaken?: () => void;
  onClose: () => void;
  onSendMedia: (request: AttachSendRequest) => void;
  onSendLocation: (latitude: number, longitude: number) => void;
  /** A desktop has no camera app behind `capture`; its webcam dialog stands in. */
  onOpenWebcam?: () => void;
  /**
   * What was typed in the composer before the sheet opened: its caption, as in
   * Telegram (tracker item 65). Read once, when the sheet opens.
   */
  initialCaption?: string;
  initialMentionEntities?: MessageMentionsV1;
  chatId?: string;
  topicId?: string | null;
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
  initialCaption = "",
  initialMentionEntities,
  chatId = "",
  topicId = null,
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
  const [editingMedia, setEditingMedia] = useState<EditingMedia | null>(null);
  const [PhotoEditorComponent, setPhotoEditorComponent] = useState<PhotoEditor | null>(null);
  const [VideoEditorComponent, setVideoEditorComponent] = useState<VideoEditor | null>(null);
  const [editorLoadFailed, setEditorLoadFailed] = useState(false);
  const editorRef = useRef<EditingMedia | null>(null);
  const editorFocusRef = useRef<string | null>(null);
  const originalPicksRef = useRef(new Map<string, AttachPick>());
  const galleryRef = useRef(gallery);
  galleryRef.current = gallery;
  const gallerySelectionRef = useRef(gallerySelected);
  gallerySelectionRef.current = gallerySelected;
  const ownerRef = useRef({ userId: useAppStore.getState().currentUser?.id ?? null,
    epoch: useAppStore.getState().accountEpoch, chatId, topicId });
  const contextRef = useRef({ chatId, topicId, onClose });
  contextRef.current = { chatId, topicId, onClose };
  const lifetimeRef = useRef({ active: true, version: 0 });
  const scopeIsCurrent = useCallback(() => {
    const owner = ownerRef.current;
    const state = useAppStore.getState();
    return lifetimeRef.current.active && owner.userId === (state.currentUser?.id ?? null)
      && owner.epoch === state.accountEpoch && owner.chatId === contextRef.current.chatId
      && owner.topicId === contextRef.current.topicId;
  }, []);
  // Picked files are in this sheet and nowhere else, so a quiet restart waits
  // for them (`lib/reloadGuard.ts`).
  useReloadGuard(gallery.length + files.length > 0, "attach-sheet");
  const [captionSnapshot, setCaptionSnapshot] = useState(() => createMentionText(initialCaption, initialMentionEntities));
  const caption = captionSnapshot.content;
  const setCaption = (value: string) => setCaptionSnapshot((current) => rebaseMentionText(current, value));
  const [menuOpen, setMenuOpen] = useState(false);
  // Remembered between sends, per device, since 2026-09-21. The tester called
  // ours «настройка HD», which is what a person calls a control that looks like
  // a preference — and a preference that forgets is a question asked again.
  // Why that completes D-119 instead of overturning it is written once, beside
  // the key, in `lib/mediaQuality.ts`.
  //
  // Read at mount rather than in an effect: the badge must be drawn in the
  // state it is in, not drawn wrong and corrected a frame later.
  const [hd, setHd] = useState(() => readStoredPhotoResolution(readPhotoResolution()));
  const [dragY, setDragY] = useState(0);
  const [dragFrom, setDragFrom] = useState(0);
  const [dragging, setDragging] = useState(false);
  /** The height the sheet's content asks for, measured; null until it has been. */
  const [fit, setFit] = useState<number | null>(null);
  /**
   * How tall the capsule that floats over the grid is, measured rather than
   * assumed: the video ladder joins it for some selections and not others, and
   * the room kept under the grid has to be the room it actually takes.
   */
  const [floatingHeight, setFloatingHeight] = useState(0);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Partial<Record<AttachTabId, HTMLButtonElement | null>>>({});
  const inputRefs = useRef<Partial<Record<AttachPickerKind, HTMLInputElement | null>>>({});
  const urlsRef = useRef<string[]>([]);
  const nextIdRef = useRef(1);
  const takenIncomingRef = useRef<number | null>(null);
  /** Read by `requestClose`, which the backdrop and Escape both reach. */
  const encodingRef = useRef(false);
  const cancelLadderRef = useRef<() => void>(() => {});
  const dragRef = useRef<{ pointerId: number; startY: number; lastY: number; lastT: number; velocity: number; height: number } | null>(null);

  useLayoutEffect(() => {
    lifetimeRef.current.active = true;
    const retire = () => {
      if (!lifetimeRef.current.active) return;
      lifetimeRef.current.active = false;
      lifetimeRef.current.version += 1;
      editorRef.current = null;
      setEditingMedia(null);
      galleryRef.current = [];
      setGallery([]);
      setFiles([]);
      setGallerySelected([]);
      setFilesSelected([]);
      setCaptionSnapshot(createMentionText(""));
      originalPicksRef.current.clear();
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
      urlsRef.current = [];
      cancelLadderRef.current();
      contextRef.current.onClose();
    };
    const unsubscribe = useAppStore.subscribe(() => { if (!scopeIsCurrent()) retire(); });
    if (!scopeIsCurrent()) retire();
    return () => {
      unsubscribe();
      lifetimeRef.current.active = false;
      lifetimeRef.current.version += 1;
      editorRef.current = null;
    };
  }, [scopeIsCurrent]);

  useLayoutEffect(() => {
    if (scopeIsCurrent()) return;
    lifetimeRef.current.active = false;
    lifetimeRef.current.version += 1;
    editorRef.current = null;
    setEditingMedia(null);
    cancelLadderRef.current();
    contextRef.current.onClose();
  }, [chatId, topicId, scopeIsCurrent]);

  // ── what is picked ─────────────────────────────────────────────────────────

  const addPicks = useCallback(
    (list: File[], source: IncomingFilesSource, originals: boolean) => {
      if (!list.length || !scopeIsCurrent()) return;
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
    [filesSelected, gallerySelected, scopeIsCurrent],
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
      originalPicksRef.current.clear();
    },
    [],
  );

  // The keyboard goes down and the focus comes into the sheet; a desktop gets its
  // focus back when the sheet closes, a phone does not raise its keyboard again.
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previous?.blur();
    // Own Escape before the first paint, not one frame after the sheet opens.
    tabRefs.current[ATTACH_SHEET_DEFAULT_TAB]?.focus({ preventScroll: true });
    return () => {
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
  const chosenRef = useRef(chosen);
  chosenRef.current = chosen;
  const chosenFiles = chosen.map((pick) => pick.file);
  const offersOriginal = offersSendWithoutCompression(tab, chosenFiles);
  const offersHd = offersHdPhotos(tab, chosen.filter(pick => !pick.preparedPhoto).map(pick => pick.file));
  const selecting = chosen.length > 0;

  // The ladder governs the gallery's videos only. A pick from «Файл» goes as it
  // is by definition (D-119), so there is nothing there for a quality to change.
  const videoPicks = selectionScope === "gallery" ? chosen.filter((pick) => pick.kind === "video") : [];
  const ladder = useVideoSendLadder(videoPicks);
  const encoding = ladder.progress !== null;
  const offersLadder = selectionScope === "gallery" && ladder.ready && ladder.stops.length > 1;
  encodingRef.current = encoding;
  cancelLadderRef.current = ladder.cancel;

  const cancelMediaEditor = useCallback(() => {
    const edit = editorRef.current;
    editorRef.current = null;
    editorFocusRef.current = edit?.pick.id ?? null;
    setEditingMedia(null);
  }, []);

  useLayoutEffect(() => {
    if (editingMedia || !editorFocusRef.current || !scopeIsCurrent()) return;
    sheetRef.current?.querySelector<HTMLButtonElement>(`[data-attach-edit="${editorFocusRef.current}"]`)?.focus({ preventScroll: true });
    editorFocusRef.current = null;
  }, [editingMedia, scopeIsCurrent]);

  const editIsCurrent = (edit: EditingMedia) => scopeIsCurrent() && editorRef.current === edit
    && lifetimeRef.current.version === edit.version
    && galleryRef.current.some(pick => pick.id === edit.pick.id && pick.file === edit.pick.file)
    && gallerySelectionRef.current.includes(edit.pick.id) === edit.selected;

  const openMediaEditor = (id: string) => {
    const pick = galleryRef.current.find(item => item.id === id);
    if (!pick || !pick.url || (pick.kind !== "video" && !isCanvasPhotoCandidate(pick.file.type)) || encoding || !scopeIsCurrent()) return;
    // A new edit intent retires an earlier Send, even before its encoder starts.
    lifetimeRef.current.version += 1;
    cancelLadderRef.current();
    const edit: EditingMedia = { pick, version: lifetimeRef.current.version,
      selected: gallerySelectionRef.current.includes(id), quality: pick.preparedPhoto?.quality ?? photoSendQuality(hd) };
    editorRef.current = edit;
    setEditingMedia(edit);
    setMenuOpen(false);
    setEditorLoadFailed(false);
    if (pick.kind === "video") {
      if (!VideoEditorComponent) void import("./AttachVideoEditor").then(module => {
        if (editIsCurrent(edit)) setVideoEditorComponent(() => module.default);
      }, () => {
        if (editIsCurrent(edit)) setEditorLoadFailed(true);
      });
    } else if (!PhotoEditorComponent) void import("./AttachPhotoEditor").then(module => {
      if (editIsCurrent(edit)) setPhotoEditorComponent(() => module.default);
    }, () => {
      if (editIsCurrent(edit)) setEditorLoadFailed(true);
    });
  };

  const applyMediaEdit = (edit: EditingMedia, result: MediaEditResult): boolean => {
    if (!editIsCurrent(edit)) return false;
    if (!result.changed || result.file === edit.pick.file) { cancelMediaEditor(); return true; }
    const validKind = edit.pick.kind === "video"
      ? result.file.type === "video/mp4" && "duration" in result && Number.isFinite(result.duration) && result.duration > 0
      : isCanvasPhotoCandidate(result.file.type);
    if (!validKind || !result.file.size || !Number.isFinite(result.width)
      || !Number.isFinite(result.height) || result.width < 1 || result.height < 1) return false;
    let url: string;
    try { url = URL.createObjectURL(result.file); }
    catch { showAppAlert("Не удалось открыть результат. Изменения не отправлены.", "Вложение"); return false; }
    if (!originalPicksRef.current.has(edit.pick.id)) originalPicksRef.current.set(edit.pick.id, edit.pick);
    const replacement = { ...edit.pick, file: result.file, url, edited: true,
      ...(edit.pick.kind === "image" ? { preparedPhoto: { width: result.width, height: result.height, quality: edit.quality } } : {}) };
    urlsRef.current.push(url);
    const originalUrl = originalPicksRef.current.get(edit.pick.id)?.url;
    if (edit.pick.url && edit.pick.url !== originalUrl) {
      URL.revokeObjectURL(edit.pick.url);
      urlsRef.current = urlsRef.current.filter(value => value !== edit.pick.url);
    }
    galleryRef.current = galleryRef.current.map(pick => pick.id === edit.pick.id ? replacement : pick);
    setGallery(current => scopeIsCurrent()
      ? current.map(pick => pick.id === edit.pick.id && pick.file === edit.pick.file ? replacement : pick) : current);
    cancelMediaEditor();
    return true;
  };

  const restoreMedia = (edit: EditingMedia) => {
    if (!editIsCurrent(edit)) return;
    const original = originalPicksRef.current.get(edit.pick.id);
    if (!original) return;
    if (edit.pick.url && edit.pick.url !== original.url) {
      URL.revokeObjectURL(edit.pick.url);
      urlsRef.current = urlsRef.current.filter(url => url !== edit.pick.url);
    }
    galleryRef.current = galleryRef.current.map(pick => pick.id === edit.pick.id ? original : pick);
    setGallery(current => scopeIsCurrent() ? current.map(pick => pick.id === edit.pick.id ? original : pick) : current);
    originalPicksRef.current.delete(edit.pick.id);
    cancelMediaEditor();
  };

  const toggleGalleryPick = (id: string) => {
    if (editorRef.current?.pick.id === id) cancelMediaEditor();
    setGallerySelected(current => toggleSelection(current, id));
  };

  // What floats over the grid is measured rather than assumed: it is one
  // capsule for a photograph and two for a video, and a reserve that is
  // sometimes wrong hides the last row of what was picked.
  useLayoutEffect(() => {
    const node = floatingRef.current;
    if (!node) {
      setFloatingHeight(0);
      return undefined;
    }
    const measure = () => setFloatingHeight(Math.ceil(node.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [selecting, offersLadder, encoding]);

  const requestClose = useCallback(() => {
    if (!scopeIsCurrent()) return;
    if (editorRef.current) { cancelMediaEditor(); return; }
    // While a video is being encoded, closing means «stop waiting» rather than
    // «throw the selection away»: the encoding stops and the sheet stays with
    // what was picked still in it. Nothing has been uploaded at this point.
    if (encodingRef.current) {
      cancelLadderRef.current();
      return;
    }
    if (!gallerySelected.length && !filesSelected.length) {
      onClose();
      return;
    }
    void requestAppConfirm({ title: "Отменить выбор?", confirmLabel: "Отменить выбор", cancelLabel: "Продолжить" }).then(
      (confirmed) => {
        if (confirmed && scopeIsCurrent()) onClose();
      },
    );
  }, [filesSelected.length, gallerySelected.length, onClose, scopeIsCurrent, cancelMediaEditor]);

  /**
   * The badge, and the sentence it makes true (D-290).
   *
   * Telegram draws a line at the moment of pressing — «Фотография будет в
   * высоком разрешении.» — rather than leaving the reader to infer it from
   * two letters, and that line is the whole difference between a control whose
   * name a person has to guess at and one that states its effect. Ours says the
   * same thing and, on the same line, names the path this control is not:
   * somebody reaching for HD to get their 5 MB back is reaching for the wrong
   * one, and nothing used to tell them so.
   */
  const changePhotoResolution = (next: boolean) => {
    setHd(next);
    writePhotoResolution(next);
    showActionFeedback({
      kind: "info",
      title: chosen.some(pick => pick.preparedPhoto) ? `Неизменённые фото: ${next ? "HD" : "SD"}` : photoSendQualitySentence(next),
      detail: PHOTO_SEND_ORIGINAL_HINT,
      key: PHOTO_SEND_QUALITY_FEEDBACK_KEY,
    });
  };

  const send = async (mode: AttachSendMode) => {
    if (!chosen.length || encoding || editorRef.current || !scopeIsCurrent()) return;
    const version = lifetimeRef.current.version;
    const sendPicks = chosen;
    setMenuOpen(false);
    const plan = planAttachSend(chosenFiles, tab === "file" ? "original" : mode);
    if (plan.refused.length) {
      showAppAlert(
        plan.refused.map((file) => originalLimitMessage(file)).filter(Boolean).join("\n"),
        originalLimitAlertTitle(plan.refused.length),
      );
    }
    if (!plan.send.length) return;
    // The encoding happens here rather than downstream, because this is where
    // the rung was chosen and where a person can still stop it: a browser
    // encodes at roughly realtime, so the wait belongs in front of them, with
    // «Отмена», rather than behind a sheet that has already closed. A send asked
    // for as originals is never encoded — that is what «Отправить без сжатия»
    // means.
    const outgoingCaption = trimMentionText(captionSnapshot);
    const prepared = plan.compress ? await ladder.prepare(plan.send) : { files: plan.send, origins: undefined };
    // Cancelled: the selection stays where it was and nothing is sent.
    if (!prepared || !scopeIsCurrent() || lifetimeRef.current.version !== version
      || chosenRef.current.length !== sendPicks.length
      || !sendPicks.every((pick, index) => chosenRef.current[index]?.id === pick.id && chosenRef.current[index]?.file === pick.file)) return;
    const preparedPhotos = new Map(sendPicks.flatMap(pick => pick.preparedPhoto && prepared.files.includes(pick.file)
      ? [[pick.file, pick.preparedPhoto] as const] : []));
    onSendMedia({
      files: prepared.files,
      originalSizes: prepared.origins,
      preparedPhotos,
      compress: plan.compress,
      caption: outgoingCaption.content,
      mentionEntities: outgoingCaption.mentionEntities,
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
    const inset = "max(var(--kub-keyboard-inset, 0px), var(--kub-attach-safe-bottom))";
    // A fixed sheet may anchor below the iPhone's paintable canvas. Runtime
    // measures that difference; elsewhere it is zero. The voice-call shell
    // overrides --kub-app-height locally, so use the independent root token.
    const viewportGap = "var(--kub-fixed-paintable-gap, 0px)";
    const available = `calc(var(--kub-paintable-height) - var(--kub-safe-top) - 0.75rem - ${inset} - 0.5rem)`;
    const resting = `min(${available}, ${Math.round(ATTACH_SHEET_PHONE_REST_SHARE * 100)}dvh)`;
    frameStyle = {
      ...fittedSheetHeight({
        ceiling: detent === "full" ? available : resting,
        content: fit,
        stretch: dragging ? sheetStretch({ dy: dragY, height: dragFrom, content: fit }) : 0,
        available,
      }),
      transform: dragY > 0 ? `translateY(${Math.round(dragY)}px)` : undefined,
      bottom: `calc(${viewportGap} + ${inset} + 0.5rem)`,
    };
  } else {
    frameStyle = fittedSheetHeight({ ceiling: DESKTOP_CEILING, content: fit });
  }

  const frameClass = phone
    ? cn(
        "kub-attach-sheet fixed inset-x-2 z-40 flex flex-col overflow-hidden rounded-[2.125rem]",
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
    <AttachMoreMenu open={menuOpen} onOpenChange={setMenuOpen} onSendOriginal={() => void send("original")} />
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
    <div ref={floatingRef} className="absolute inset-x-3 bottom-3 z-10 flex flex-col gap-2">
      {/* The ladder above the capsule, and the same box showing the wait once
          the encoding starts — the control and its consequence in one place. */}
      {ladder.progress ? (
        <AttachVideoProgressRow
          progress={ladder.progress.value}
          position={ladder.progress.position}
          onCancel={ladder.cancel}
        />
      ) : offersLadder ? (
        <AttachVideoQualityRow
          stops={ladder.stops}
          stop={ladder.stop}
          onStopChange={ladder.setStop}
          summary={ladder.summary}
          videos={ladder.videos}
        />
      ) : null}
      <AttachSendBar
        chatId={chatId}
        topicId={topicId}
        snapshot={captionSnapshot}
        onSnapshotChange={setCaptionSnapshot}
        sendLabel={mediaSendTitle(chosenFiles)}
        caption={caption}
        onCaptionChange={setCaption}
        onSend={() => void send("compressed")}
        hdAvailable={offersHd}
        hd={hd}
        onHdChange={changePhotoResolution}
        busy={encoding}
      />
    </div>
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
              onToggle={toggleGalleryPick}
              onMove={(id, direction) => setGallerySelected((current) => moveSelected(current, id, direction))}
              onEdit={encoding ? undefined : openMediaEditor}
              reserveBottom={selecting ? floatingHeight + 24 : 0}
            />
          )}
          {tab === "file" && (
            <AttachFilePanel
              sources={fileSources}
              picks={files}
              selected={filesSelected}
              onToggle={(id) => setFilesSelected((current) => toggleSelection(current, id))}
              reserveBottom={selecting ? floatingHeight + 24 : 0}
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

  if (!scopeIsCurrent()) return null;

  return (
    <>
      <div
        aria-hidden="true"
        data-testid="attach-sheet-backdrop"
        inert={editingMedia ? true : undefined}
        onClick={requestClose}
        className={cn("fixed inset-0 z-40", phone && "kub-message-scrim")}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-hidden={editingMedia ? true : undefined}
        inert={editingMedia ? true : undefined}
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
      {editingMedia && scopeIsCurrent() && createPortal(editingMedia.pick.kind === "video" ? (
        VideoEditorComponent ? <VideoEditorComponent
          key={`${editingMedia.pick.id}-${editingMedia.version}`}
          file={editingMedia.pick.file}
          url={editingMedia.pick.url!}
          onApply={result => applyMediaEdit(editingMedia, result)}
          onCancel={cancelMediaEditor}
          onRestore={originalPicksRef.current.has(editingMedia.pick.id) ? () => restoreMedia(editingMedia) : undefined}
        /> : <AttachEditorLoading failed={editorLoadFailed} onCancel={cancelMediaEditor} />
      ) : PhotoEditorComponent ? (
        <PhotoEditorComponent
          key={`${editingMedia.pick.id}-${editingMedia.version}`}
          file={editingMedia.pick.file}
          url={editingMedia.pick.url!}
          quality={editingMedia.quality}
          onApply={result => applyMediaEdit(editingMedia, result)}
          onCancel={cancelMediaEditor}
          onRestore={originalPicksRef.current.has(editingMedia.pick.id) ? () => restoreMedia(editingMedia) : undefined}
        />
      ) : (
        <AttachEditorLoading failed={editorLoadFailed} onCancel={cancelMediaEditor} />
      ), document.body)}
    </>
  );
}

/**
 * The SD/HD state, read off this device.
 *
 * Wrapped because access itself throws, not merely returns null, in a private
 * window and wherever site data is blocked — the same shape
 * `hooks/useMessageTextSize.ts` and `lib/playbackVolume.ts` use. What the value
 * means is decided in `lib/mediaQuality.ts`, which imports nothing and can
 * therefore be reached by `node --test`; this pair only fetches the string.
 */
function readPhotoResolution(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(PHOTO_RESOLUTION_STORAGE_KEY);
  } catch {
    // A blocked store is not a new device. Keep the conservative SD fallback.
    return "";
  }
}

function writePhotoResolution(hd: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PHOTO_RESOLUTION_STORAGE_KEY, photoResolutionToStore(hd));
  } catch {
    // A device that refuses storage still gets the state for this sheet; it
    // just will not have it for the next one. Losing a preference is not worth
    // failing a send over.
  }
}
