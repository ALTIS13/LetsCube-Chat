/**
 * The attach sheet's rules, as pure functions (D-122).
 *
 * Telegram's paperclip opens a sheet whose tabs work where they are: the gallery
 * is the first thing on screen and photos are picked, captioned and sent from it;
 * «Файл» lists where a file can come from; «Геопозиция» shows the place before
 * anything leaves. A web page cannot list the phone's photos, so the gallery here
 * starts from the system's own picker and camera, and what is picked fills the
 * sheet's grid. D-119 stands inside it: nothing asks for a quality, the gallery
 * sends compressed, and sending the originals is the named function
 * «Отправить без сжатия».
 *
 * This is the composer's attach flow on every shell — there is no menu beside it
 * and no dialog behind it.
 *
 * Nothing here touches the DOM, the network or React, and the only import is a
 * module that `node --test` already loads, so `tests/unit/attach-sheet.test.mts`
 * reads this file directly.
 */

import { isCompressibleMediaType, splitByOriginalLimit, type IncomingFilesSource } from "./mediaCompression.ts";

// ── tabs ─────────────────────────────────────────────────────────────────────

/** The tabs that do their job in place. */
export type AttachWorkingTabId = "gallery" | "file" | "location";
/** The tabs that hold the place of a function not built yet. */
export type AttachPlaceholderTabId = "poll" | "checklist" | "contact";
export type AttachTabId = AttachWorkingTabId | AttachPlaceholderTabId;

export type AttachTab =
  | { id: AttachWorkingTabId; label: string; kind: "working" }
  | {
      id: AttachPlaceholderTabId;
      label: string;
      kind: "placeholder";
      /** The one line the placeholder says: that the function is coming. */
      soon: string;
    };

/**
 * In Telegram's order; the gallery is where the sheet always opens.
 *
 * The three after «Геопозиция» are placeholders the owner asked for, in the
 * order he named them on 2026-09-12: «Опрос», «Список», «Контакт». Each opens in
 * place and says only what it is and that it is coming — no controls, no
 * selection, nothing to send. «Музыка» was rendered beside them and the owner
 * said he does not want it at all, so it is not here.
 */
export const ATTACH_TABS: ReadonlyArray<AttachTab> = [
  { id: "gallery", label: "Галерея", kind: "working" },
  { id: "file", label: "Файл", kind: "working" },
  { id: "location", label: "Геопозиция", kind: "working" },
  { id: "poll", label: "Опрос", kind: "placeholder", soon: "Скоро здесь можно будет создать опрос" },
  { id: "checklist", label: "Список", kind: "placeholder", soon: "Скоро здесь можно будет создать список" },
  { id: "contact", label: "Контакт", kind: "placeholder", soon: "Скоро здесь можно будет отправить контакт" },
];

export const ATTACH_SHEET_DEFAULT_TAB: AttachTabId = "gallery";

/** A tab by its id. */
export function attachTab(id: AttachTabId): AttachTab {
  return ATTACH_TABS.find((tab) => tab.id === id) ?? ATTACH_TABS[0];
}

/**
 * Whose picks a tab shows and sends: the gallery's, «Файл»'s, or nobody's.
 * «Геопозиция» sends from its own row, and a placeholder sends nothing, so
 * neither ever has a selection, a caption, a send button or «…».
 */
export function attachTabSelection(tab: AttachTabId): "gallery" | "file" | null {
  return tab === "gallery" || tab === "file" ? tab : null;
}

/**
 * Where a key moves the focus along the tab list, as the ARIA tabs pattern has
 * it: the arrows wrap, Home and End go to the ends, anything else is not ours.
 */
export function nextTabIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

// ── a tab row wider than the sheet ───────────────────────────────────────────

/** Which ends of a scrolling tab row have more tabs beyond them. */
export type AttachTabRowOverflow = "none" | "start" | "end" | "both";

/**
 * Six tabs do not fit across a phone, so the row scrolls sideways, as Telegram's
 * does. This says which of its ends hide tabs, for the fade drawn there; a pixel
 * of rounding is not a hidden tab.
 */
export function tabRowOverflow(row: { scrollLeft: number; viewportWidth: number; contentWidth: number }): AttachTabRowOverflow {
  const hiddenBefore = row.scrollLeft > 1;
  const hiddenAfter = row.contentWidth - row.viewportWidth - row.scrollLeft > 1;
  if (hiddenBefore && hiddenAfter) return "both";
  if (hiddenBefore) return "start";
  if (hiddenAfter) return "end";
  return "none";
}

/**
 * Where a scrolling tab row moves so a tab is wholly in view — after an arrow
 * key, Home or End, or a tap on a tab half out of view — with `margin` beside
 * it, so the next tab still shows and the row still reads as going on. A tab
 * already in view leaves the row where it is. Never past either end.
 */
export function tabRevealScrollLeft(input: {
  scrollLeft: number;
  viewportWidth: number;
  contentWidth: number;
  tabStart: number;
  tabEnd: number;
  margin: number;
}): number {
  const { scrollLeft, viewportWidth, contentWidth, tabStart, tabEnd, margin } = input;
  const furthest = Math.max(0, contentWidth - viewportWidth);
  let next = scrollLeft;
  if (tabStart - margin < scrollLeft) next = tabStart - margin;
  else if (tabEnd + margin > scrollLeft + viewportWidth) next = tabEnd + margin - viewportWidth;
  return Math.min(furthest, Math.max(0, Math.round(next)));
}

/** Where Tab lands inside the sheet: past the last control it comes back to the first. */
export function trappedFocusIndex(current: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return backwards ? (current - 1 + count) % count : (current + 1) % count;
}

// ── picking and selecting ────────────────────────────────────────────────────

/** As many as the composer can send at once (`MAX_STAGED_ATTACHMENTS`). */
export const ATTACH_SHEET_MAX_SELECTION = 10;

export type AttachPickerKind = "camera" | "library" | "library-original" | "file";

export interface AttachPicker {
  accept: string | null;
  capture: "environment" | null;
  multiple: boolean;
  /** Whether what this picker brings goes compressed by default. */
  compress: boolean;
  source: IncomingFilesSource;
}

/**
 * The system picker behind each entry. The camera asks the phone's own camera
 * through `capture`, so the page never opens a stream and no permission is asked
 * until a person taps it. «Файл» and the gallery's originals bring originals.
 *
 * The Android app's WebView opens a camera for `capture` only when `accept` is
 * exactly one of `image/*` or `video/*` (Capacitor's `BridgeWebChromeClient`), so
 * there the camera takes photos; iOS offers photo and video from one input.
 */
export function attachPicker(kind: AttachPickerKind, platform: { androidNative?: boolean } = {}): AttachPicker {
  switch (kind) {
    case "camera":
      return {
        accept: platform.androidNative ? "image/*" : "image/*,video/*",
        capture: "environment",
        multiple: false,
        compress: true,
        source: "camera",
      };
    case "library":
      return { accept: "image/*,video/*", capture: null, multiple: true, compress: true, source: "picker" };
    case "library-original":
      return { accept: "image/*,video/*", capture: null, multiple: true, compress: false, source: "picker" };
    case "file":
    default:
      return { accept: null, capture: null, multiple: true, compress: false, source: "picker" };
  }
}

/**
 * How «Галерея» lays out its two actions, «Камера» and «Фото и видео», around
 * what is picked: two large tiles before anything is picked, and the first two
 * cells of the grid once something is, three to a row.
 */
export type AttachGalleryArrangement = "tiles" | "grid";

export function attachGalleryArrangement(picked: number): AttachGalleryArrangement {
  return picked > 0 ? "grid" : "tiles";
}

/**
 * A tap on a selection circle: an unselected item joins the end of the order, a
 * selected one leaves it and the numbers after it close up. Past the limit a tap
 * selects nothing.
 */
export function toggleSelection(
  selected: readonly string[],
  id: string,
  max = ATTACH_SHEET_MAX_SELECTION,
): string[] {
  if (selected.includes(id)) return selected.filter((candidate) => candidate !== id);
  if (selected.length >= max) return [...selected];
  return [...selected, id];
}

/** The number drawn in an item's circle, or null when it is not selected. */
export function selectionNumber(selected: readonly string[], id: string): number | null {
  const index = selected.indexOf(id);
  return index < 0 ? null : index + 1;
}

/**
 * What a new pick does to the selection. Picked from the system's picker means
 * chosen, so the new items are selected in the order they came, up to the limit;
 * the rest stay in the grid unselected and are counted as refused.
 */
export function selectPicked(
  selected: readonly string[],
  pickedIds: readonly string[],
  max = ATTACH_SHEET_MAX_SELECTION,
): { selected: string[]; refused: number } {
  const next = [...selected];
  let refused = 0;
  for (const id of pickedIds) {
    if (next.includes(id)) continue;
    if (next.length >= max) {
      refused += 1;
      continue;
    }
    next.push(id);
  }
  return { selected: next, refused };
}

/** The items to send, in the order they were selected. */
export function selectedInOrder<T extends { id: string }>(items: readonly T[], selected: readonly string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return selected.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));
}

// ── sending ──────────────────────────────────────────────────────────────────

export type AttachSendMode = "compressed" | "original";

/** What the sheet hands the conversation to send, caption included. */
export interface AttachSendRequest {
  files: File[];
  compress: boolean;
  caption: string;
  source: IncomingFilesSource;
}

/** Files that reached the composer another way — pasted, dropped, shot on a webcam — and open the sheet. */
export interface AttachIncoming {
  id: number;
  files: File[];
  source: IncomingFilesSource;
}

/**
 * What a send carries. Compressed takes everything selected. The originals leave
 * a photo or a video over 50 MB behind, which the caller names to the person,
 * and send the rest, as a pick from «Файл» always has (D-119).
 */
export function planAttachSend<T extends { size: number; type: string }>(
  files: readonly T[],
  mode: AttachSendMode,
): { send: T[]; refused: T[]; compress: boolean } {
  if (mode === "compressed") return { send: [...files], refused: [], compress: true };
  const { within, over } = splitByOriginalLimit(files);
  return { send: within, refused: over, compress: false };
}

/**
 * Whether «…» offers «Отправить без сжатия», where Telegram for iOS keeps it
 * once something is selected. Only where there is something to compress: a
 * gallery selection with a photo or a video in it. A pick from «Файл» already
 * goes as it is, so there is no «…» on that tab at all.
 */
export function offersSendWithoutCompression(tab: AttachTabId, files: ReadonlyArray<{ type: string }>): boolean {
  return tab === "gallery" && files.some((file) => isCompressibleMediaType(file.type));
}

/**
 * Whether files that arrive at the composer another way — pasted, dropped, or
 * picked outside the sheet — open the sheet as their send step, rather than
 * going straight into the tray. A photo or a video does, on every device and on
 * every shell; a camera shot was already looked at, and a batch of documents has
 * nothing to preview.
 */
export function opensAttachSheet(input: { source: IncomingFilesSource; files: ReadonlyArray<{ type: string }> }): boolean {
  if (input.source === "camera") return false;
  return input.files.some((file) => isCompressibleMediaType(file.type));
}

// ── the sheet's height ───────────────────────────────────────────────────────

/** The most of a phone's screen the sheet takes at rest; below that it is as tall as what it holds. */
export const ATTACH_SHEET_PHONE_REST_SHARE = 0.66;

/**
 * How tall the sheet's content asks it to be, from three measured heights: the
 * sheet, the part of it that scrolls, and all of what that part holds.
 *
 * The sheet is as tall as what it holds (2026-09-12): two tiles or two rows
 * make a short sheet, and picks grow it. Everything that does not scroll — the
 * handle, the header, the tabs or the send capsule, the inset under them — stays,
 * and the scrolling part is swapped for its whole content. That is the same in
 * the middle of an animation, because what does not scroll does not change.
 * Rounded up, so the content never scrolls by a fraction of a pixel.
 */
export function sheetContentHeight(measured: { sheet: number; scroller: number; content: number }): number {
  return Math.ceil(measured.sheet - measured.scroller + measured.content);
}

/**
 * The sheet's CSS height: the height its content asks for, never past
 * `ceiling` — the height it rests at, or the full height once dragged
 * there — past which the content scrolls inside it.
 *
 * Until the content has been measured the browser sizes the sheet to it under
 * the same ceiling, so the first frame is already the right height and nothing
 * animates into place. A drag upwards adds `stretch`, never past `available`.
 */
export function fittedSheetHeight(input: {
  ceiling: string;
  content: number | null;
  stretch?: number;
  available?: string;
}): { height: string; maxHeight?: string } {
  const { ceiling, content, stretch = 0, available = ceiling } = input;
  if (content === null) return { height: "auto", maxHeight: ceiling };
  const fitted = `min(${ceiling}, ${Math.ceil(content)}px)`;
  if (stretch < 1) return { height: fitted };
  return { height: `min(${available}, calc(${fitted} + ${Math.round(stretch)}px))` };
}

/** Past all it holds, a sheet dragged up follows a third of the finger, and springs back when let go. */
export const SHEET_RUBBER_BAND = 1 / 3;

/**
 * How much taller a sheet being dragged up is drawn than when the drag began:
 * the whole of the finger's travel until the sheet shows all it holds, and a
 * third of the rest. `height` is the sheet's height when the drag began and
 * `content` the height its content asks for, null until measured.
 */
export function sheetStretch(input: { dy: number; height: number; content: number | null }): number {
  if (input.dy >= 0) return 0;
  const pull = -input.dy;
  const room = input.content === null ? 0 : Math.max(0, input.content - input.height);
  return pull <= room ? pull : room + (pull - room) * SHEET_RUBBER_BAND;
}

// ── dragging the sheet ───────────────────────────────────────────────────────

export type SheetDetent = "rest" | "full";
export type SheetRelease = SheetDetent | "close";

/** Faster than this, in points per millisecond, a release is a flick and goes one detent its way. */
export const SHEET_FLICK_VELOCITY = 0.8;

/**
 * Where a sheet let go of lands. `dy` is how far it was dragged, positive down;
 * `restHeight` and `fullHeight` are the heights it is drawn at in each detent,
 * which are its content's own height wherever that is less.
 *
 * A flick goes one detent in its direction; otherwise past a third of the way to
 * the next detent it moves there, and short of that it springs back. A sheet
 * already as tall as all it holds has no taller detent to go to: up springs
 * back, and down closes on a flick or past a third of the sheet.
 */
export function releaseSheet(input: {
  detent: SheetDetent;
  dy: number;
  velocity: number;
  restHeight: number;
  fullHeight: number;
}): SheetRelease {
  const { detent, dy, velocity, restHeight, fullHeight } = input;
  if (fullHeight - restHeight < 1) {
    return velocity >= SHEET_FLICK_VELOCITY || dy > restHeight / 3 ? "close" : "rest";
  }
  const stretch = fullHeight - restHeight;
  if (velocity >= SHEET_FLICK_VELOCITY) return detent === "full" ? "rest" : "close";
  if (velocity <= -SHEET_FLICK_VELOCITY) return "full";
  if (detent === "rest") {
    if (dy > restHeight / 3) return "close";
    if (dy < -stretch / 3) return "full";
    return "rest";
  }
  if (dy > stretch + restHeight / 3) return "close";
  if (dy > stretch / 3) return "rest";
  return "full";
}

// ── location ─────────────────────────────────────────────────────────────────

/** Between a number and its unit, so the two never part at a line end. */
const NBSP = String.fromCharCode(0xa0);

/** «55.75580, 37.61730»: five places, about a metre, which is what a phone reports. */
export function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

/**
 * «18 м», «1,2 км»: the radius the device is sure of, for Telegram's
 * «С точностью до …» under «Отправить геопозицию»; nothing when it gave no figure.
 */
export function formatAccuracy(meters: number | null | undefined): string | null {
  if (typeof meters !== "number" || !Number.isFinite(meters) || meters <= 0) return null;
  if (meters < 1000) return `${Math.max(1, Math.round(meters))}${NBSP}м`;
  const kilometres = Math.round(meters / 100) / 10;
  return `${String(kilometres).replace(".", ",")}${NBSP}км`;
}

/**
 * The message a shared location is sent as. Unchanged from the one-tap item it
 * replaces, so a conversation draws it exactly as before; what changes is that
 * the place is shown, and sent only by the button under it.
 */
export function locationMessageText(latitude: number, longitude: number): string {
  return `📍 Местоположение: https://maps.google.com/?q=${latitude},${longitude}`;
}
