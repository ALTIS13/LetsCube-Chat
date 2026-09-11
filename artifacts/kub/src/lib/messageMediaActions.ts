import { showActionFeedback } from "./actionFeedback.ts";

/**
 * «Копировать изображение» and «Сохранить как…».
 *
 * Both reach for the file itself, so both can be refused by things this code
 * does not control: a cross-origin response without CORS headers, a browser
 * that cannot write an image to the clipboard, a shell that ignores `download`.
 * Each says what happened rather than failing silently. Verified in Chromium
 * against a `data:` picture only — not in the Windows or Android shells, and not
 * against production storage.
 */

async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("png encoding failed"))), "image/png");
  });
}

export async function copyImageToClipboard(url: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      throw new Error("the clipboard cannot take an image here");
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`the picture answered ${response.status}`);
    const blob = await response.blob();
    // Chromium writes only PNG to the clipboard, whatever the picture was.
    const png = blob.type === "image/png" ? blob : await toPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    showActionFeedback({ kind: "success", title: "Изображение скопировано", key: "message-image" });
    return true;
  } catch {
    showActionFeedback({ kind: "error", title: "Не удалось скопировать изображение", key: "message-image:error" });
    return false;
  }
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "application/pdf": "pdf",
};

/** A file name for a download: the stored name when there is one, a dated one otherwise. */
export function mediaDownloadName(input: {
  type: string;
  content?: string | null;
  mimeType?: string | null;
  createdAt: string;
}): string {
  const stored = input.content?.trim() ?? "";
  if (input.type === "file" && /^[^\\/:*?"<>|\n]{1,120}\.[a-z0-9]{1,8}$/i.test(stored)) return stored;
  const stamp = input.createdAt.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const extension = (input.mimeType && EXTENSIONS[input.mimeType]) ||
    (input.type === "image" ? "jpg" : input.type === "video" ? "mp4" : input.type === "audio" ? "webm" : "bin");
  const noun = input.type === "image" ? "photo" : input.type === "video" ? "video" : input.type === "audio" ? "voice" : "file";
  return `letscube-${noun}-${stamp}.${extension}`;
}

export async function saveMediaAs(url: string, fileName: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`the file answered ${response.status}`);
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
  } catch {
    // Where the file cannot be read as a blob, the browser can still be asked
    // to open it, and saving is then one step away rather than impossible.
    showActionFeedback({ kind: "info", title: "Файл открыт в новой вкладке", key: "message-save" });
    window.open(url, "_blank", "noopener");
  }
}
