/**
 * What the media viewer's file control does, in the shell it is running in
 * (D-147).
 *
 * The viewer offered «Открыть оригинал» and called `window.open(url, "_blank")`
 * for it, the same way in all four shells this product runs in. Only one of the
 * four is a browser tab, where a new tab is a new tab; in the other three that
 * call ends the session the person was in. Read off the shells themselves
 * rather than assumed:
 *
 * - **Windows.** `windows-tauri/src-tauri/src/lib.rs` answers a new window with
 *   `NewWindowResponse::Deny` and hands any http(s) address to
 *   `opener().open_url()`, so the file opens in the default browser and
 *   LETSCUBE is left behind.
 * - **Android.** Capacitor's `Bridge.launchIntent` fires `Intent.ACTION_VIEW`
 *   for every host that is not the app's own, which starts another application
 *   on top of this one.
 * - **The installed iPhone app.** A standalone display has no tabs of its own,
 *   so the address goes to Safari beside the app.
 *
 * So the control is decided per shell rather than written once, and where it
 * cannot keep the file it says so in its own name before it is pressed — the
 * other half of D-147: a control that takes a person out of the app must not
 * look like one that does not.
 *
 * **Android is the shell that cannot save.** An Android WebView drops every
 * download it is given unless the host installs a `DownloadListener`, and
 * neither Capacitor's `@capacitor/android` nor this project's `MainActivity`
 * installs one — there is no `setDownloadListener` anywhere in either. A
 * «Сохранить» there would be a control that does nothing at all, silently,
 * which is worse than one that is honest about handing the file to the browser.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 */

import type { DistributionTarget } from "./platform/distribution.ts";

export type MediaFileActionKind = "save" | "open" | "share";

export interface MediaFileAction {
  /** «save» keeps the file in this shell; «open» hands its address to the browser. */
  kind: MediaFileActionKind;
  /**
   * The word drawn on the control.
   *
   * Short on purpose where the control leaves the app, because that is the one
   * word a phone must keep: measured at 390 with the Android label, a video —
   * the only kind with a fourth control in the header — left the picture's own
   * title 37 pixels wide, which is an ellipsis and nothing else. «В браузере»
   * is the half of the sentence that carries the consequence.
   */
  label: string;
  /**
   * What a screen reader says, which is the whole sentence. It contains the
   * visible word rather than replacing it.
   */
  accessibleName: string;
  /** `download` where the file is kept, `externalLink` where the address is handed away. */
  icon: "download" | "externalLink" | "share";
  /** Whether pressing it puts the person outside LETSCUBE. */
  leavesApp: boolean;
}

const SAVE: MediaFileAction = {
  kind: "save",
  label: "Сохранить",
  accessibleName: "Сохранить",
  icon: "download",
  leavesApp: false,
};

const OPEN: MediaFileAction = {
  kind: "open",
  // Not «Открыть оригинал», which said nothing about where it opens — and
  // where it opens is the part a person cannot undo by pressing again.
  label: "В браузере",
  accessibleName: "Открыть в браузере",
  icon: "externalLink",
  leavesApp: true,
};

const SHARE_PHOTO: MediaFileAction = {
  kind: "share",
  label: "Поделиться",
  accessibleName: "Поделиться фото или сохранить его",
  icon: "share",
  leavesApp: false,
};

export function mediaFileAction(target: DistributionTarget, kind?: MediaFileKind): MediaFileAction {
  if (target === "android_native") return OPEN;
  return target === "ios_pwa" && kind === "image" ? SHARE_PHOTO : SAVE;
}

/** What a saved file is called, told from its address alone. */
export type MediaFileKind = "image" | "video";

// Deliberately narrow. A download name is written to a real file system, so
// everything outside this set — a backslash, a colon, a quote, a control
// character, an alphabet the shell may mangle — falls back to a name this
// product composed itself rather than being repaired character by character.
const PLAIN_NAME = /^[A-Za-z0-9 ._()-]{1,120}$/;
const PLAIN_EXTENSION = /^[A-Za-z0-9]{1,8}$/;

/**
 * The viewer knows an address and a kind, and nothing else: it is handed a
 * `MediaViewerItem`, not a message row, so `mediaDownloadName` in
 * `messageMediaActions.ts` — which reads the stored file name, the MIME type
 * and the time it was sent — cannot be used here without every caller of the
 * viewer passing more. Stored media is addressed by its own name, so the last
 * segment of the path is that name; anything else gets a composed one.
 */
export function mediaFileName(url: string, kind: MediaFileKind): string {
  const path = url.split(/[?#]/)[0] ?? "";
  const segment = decodeSegment(path.slice(path.lastIndexOf("/") + 1)).trim();
  const dot = segment.lastIndexOf(".");
  if (dot > 0 && PLAIN_NAME.test(segment) && PLAIN_EXTENSION.test(segment.slice(dot + 1))) {
    return segment;
  }
  return kind === "image" ? "letscube-photo.jpg" : "letscube-video.mp4";
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A half-written escape is not a name; the caller falls back to a composed one.
    return value;
  }
}
