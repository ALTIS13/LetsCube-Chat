/**
 * A file in a message: what it is called, how big it is, and whether it can be
 * looked at without leaving the conversation (tracker item 33).
 *
 * The owner, 2026-09-20: «просмотр документов и т.п вещей сразу в чате, на
 * примере других медиа». Telegram is the reference for a chat with media, and
 * its web client was read rather than recalled (`Ajaxy/telegram-tt`, master,
 * `src/components/common/Document.tsx` and `File.tsx`, 2026-09-28): a file is a
 * row — a tile with its extension or a picture of it, its name, its size —
 * whose button says what a press does: an eye for a file that has a picture or
 * a film inside it, which opens in the media viewer, and a download arrow for
 * everything else. Telegram for iPhone goes further and shows a document in
 * place, in the system's own preview; ours does the part a browser can do
 * without a plugin — a PDF where the engine draws one, a text file, a picture,
 * a film, a recording — and downloads the rest as Telegram does.
 *
 * Pure, so `node --test` reads every case.
 */

export type DocumentFamily = "pdf" | "text" | "image" | "video" | "audio" | "archive" | "sheet" | "doc" | "slides" | "other";

export type DocumentPreview = "pdf" | "text" | "image" | "video" | "audio";

export interface DocumentFacts {
  name: string;
  /** What was written with the file, when that is not its name. */
  caption: string | null;
  /** Upper case, at most five letters, or «ФАЙЛ» when there is none. */
  extension: string;
  family: DocumentFamily;
  sizeBytes: number | null;
  mimeType: string | null;
}

/** A text file is read into the page; past this it is downloaded instead. */
export const TEXT_PREVIEW_LIMIT_BYTES = 1024 * 1024;

const FAMILY_BY_EXTENSION: Record<string, DocumentFamily> = {
  pdf: "pdf",
  txt: "text", log: "text", md: "text", csv: "text", tsv: "text", json: "text", xml: "text", yaml: "text", yml: "text",
  ini: "text", conf: "text", cfg: "text", sql: "text", js: "text", ts: "text", py: "text", sh: "text", css: "text",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", heic: "image", svg: "image", bmp: "image",
  mp4: "video", webm: "video", m4v: "video", mov: "video", mkv: "video", avi: "video",
  mp3: "audio", m4a: "audio", wav: "audio", ogg: "audio", oga: "audio", flac: "audio", opus: "audio",
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive",
  xls: "sheet", xlsx: "sheet", ods: "sheet", numbers: "sheet",
  doc: "doc", docx: "doc", odt: "doc", rtf: "doc", pages: "doc",
  ppt: "slides", pptx: "slides", odp: "slides", key: "slides",
};

/**
 * What a browser draws itself, everywhere this product runs. SVG is left out
 * on purpose: Telegram warns before opening one (`isIpRevealingMedia`), since a
 * drawing can fetch from anywhere; so do HEIC, MOV and the like, which only
 * some engines decode.
 */
const INLINE_IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const INLINE_VIDEO = new Set(["mp4", "webm", "m4v"]);
const INLINE_AUDIO = new Set(["mp3", "m4a", "wav"]);

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

export function documentFacts(input: { content: string | null | undefined; mediaMetadata: unknown }): DocumentFacts {
  const meta = input.mediaMetadata && typeof input.mediaMetadata === "object" && !Array.isArray(input.mediaMetadata)
    ? (input.mediaMetadata as Record<string, unknown>)
    : {};
  // The name the file was picked under, recorded since 2026-09-28; before that
  // the message's text was the name unless a caption took its place.
  const recordedName = typeof meta.file_name === "string" && meta.file_name.trim() ? meta.file_name.trim() : null;
  const text = input.content?.trim() || null;
  const name = recordedName ?? text ?? "Файл";
  const caption = recordedName && text && text !== recordedName ? text : null;
  const sizeBytes = typeof meta.size_bytes === "number" && Number.isFinite(meta.size_bytes) && meta.size_bytes >= 0
    ? meta.size_bytes
    : null;
  const mimeType = typeof meta.mime_type === "string" && meta.mime_type ? meta.mime_type : null;
  const extension = extensionOf(name);
  let family: DocumentFamily = FAMILY_BY_EXTENSION[extension] ?? "other";
  if (family === "other" && mimeType) {
    if (mimeType === "application/pdf") family = "pdf";
    else if (mimeType.startsWith("text/")) family = "text";
    else if (mimeType.startsWith("image/")) family = "image";
    else if (mimeType.startsWith("video/")) family = "video";
    else if (mimeType.startsWith("audio/")) family = "audio";
  }
  return {
    name,
    caption,
    extension: extension ? extension.slice(0, 5).toUpperCase() : "ФАЙЛ",
    family,
    sizeBytes,
    mimeType,
  };
}

/** «340 Б», «12 КБ», «1,2 МБ», «2,4 ГБ» — the units a Russian file manager uses. */
export function formatFileSize(bytes: number | null): string | null {
  if (bytes === null) return null;
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = unit === 0 || value >= 10 ? Math.round(value).toString() : value.toFixed(1).replace(".", ",");
  return `${shown} ${units[unit]}`;
}

export interface PreviewEngine {
  /** Whether the engine draws a PDF inside the page: desktop engines do, Android's and iOS's do not usefully. */
  drawsPdf: boolean;
}

/**
 * The engine this page runs in, from what it says about itself.
 *
 * `navigator.pdfViewerEnabled` is the standard answer and is asked first: a
 * browser whose viewer is off, or a headless one, says false. It is not the
 * whole answer, because iOS's engine says true and then draws a PDF inside a
 * page as a picture of its first page — so a phone downloads regardless.
 */
export function previewEngineOf(userAgent: string, maxTouchPoints: number, pdfViewerEnabled?: boolean): PreviewEngine {
  const android = /Android/i.test(userAgent);
  // An iPad asks for the desktop site and says «Macintosh»; its touch points
  // give it away.
  const ios = /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
  return { drawsPdf: !android && !ios && pdfViewerEnabled !== false };
}

/** How the file can be shown in place, or null when it is downloaded instead. */
export function documentPreviewOf(facts: DocumentFacts, engine: PreviewEngine): DocumentPreview | null {
  const extension = facts.extension.toLowerCase();
  switch (facts.family) {
    case "pdf":
      return engine.drawsPdf ? "pdf" : null;
    case "text":
      return facts.sizeBytes !== null && facts.sizeBytes <= TEXT_PREVIEW_LIMIT_BYTES ? "text" : null;
    case "image":
      return INLINE_IMAGE.has(extension) ? "image" : null;
    case "video":
      return INLINE_VIDEO.has(extension) ? "video" : null;
    case "audio":
      return INLINE_AUDIO.has(extension) ? "audio" : null;
    default:
      return null;
  }
}
