import { MAX_ORIGINAL_ATTACHMENT_BYTES } from "./mediaCompression.ts";
import { getImageUploadProfile, type MediaQuality } from "./mediaQuality.ts";
import { canvasEncodesWebp } from "./mediaUpload.ts";
import {
  JPEG_TYPE,
  PNG_TYPE,
  PHOTO_MAX_LONG_SIDE,
  compressedPhotoEncoding,
  compressedPhotoSize,
  encodedFileIdentity,
  isCanvasPhotoCandidate,
} from "./photoEncoding.ts";

export interface PhotoEditRect { x: number; y: number; width: number; height: number }
export interface PhotoEditPoint { x: number; y: number }
export type PhotoEditMark =
  | ({ kind: "cover" } & PhotoEditRect)
  | { kind: "pen"; points: readonly PhotoEditPoint[]; color: string; width: number };
export interface PhotoEditIntent {
  rotation: 0 | 90 | 180 | 270;
  crop: PhotoEditRect | null;
  marks: readonly PhotoEditMark[];
}
export interface PhotoEditResult { file: File; width: number; height: number; changed: boolean }

const failure = (code: string) => new Error(`PHOTO_EDIT_${code}`);
const abortError = () => new DOMException("Photo edit cancelled", "AbortError");
const unit = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    void work.then(value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) { signal.removeEventListener("abort", abort); abort(); }
  });
}

function rect(value: unknown): PhotoEditRect {
  if (!object(value) || typeof value.x !== "number" || !Number.isFinite(value.x) || value.x < 0
    || typeof value.y !== "number" || !Number.isFinite(value.y) || value.y < 0
    || !positive(value.width) || !positive(value.height)) throw failure("INVALID_CROP");
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

// Capture the whole recipe before decode, so later UI mutations cannot change an export.
function snapshot(intent: PhotoEditIntent): PhotoEditIntent {
  if (!object(intent) || ![0, 90, 180, 270].includes(intent.rotation) || !Array.isArray(intent.marks)) {
    throw failure("INVALID_INTENT");
  }
  const crop = intent.crop === null ? null : rect(intent.crop);
  const marks: PhotoEditMark[] = intent.marks.map((mark: unknown) => {
    if (!object(mark)) throw failure("INVALID_MARK");
    if (mark.kind === "cover") {
      if (!unit(mark.x) || !unit(mark.y) || !unit(mark.width) || !unit(mark.height)
        || mark.width === 0 || mark.height === 0 || mark.x + mark.width > 1 || mark.y + mark.height > 1) {
        throw failure("INVALID_MARK");
      }
      return { kind: "cover", x: mark.x, y: mark.y, width: mark.width, height: mark.height };
    }
    if (mark.kind !== "pen" || !Array.isArray(mark.points) || !mark.points.length
      || !unit(mark.width) || mark.width === 0 || typeof mark.color !== "string"
      || !mark.color.length || mark.color.length > 128) throw failure("INVALID_MARK");
    return { kind: "pen", width: mark.width, color: mark.color, points: mark.points.map((point: unknown) => {
      if (!object(point) || !unit(point.x) || !unit(point.y)) throw failure("INVALID_MARK");
      return { x: point.x, y: point.y };
    }) };
  });
  return { rotation: intent.rotation, crop, marks };
}

function paintMarks(ctx: CanvasRenderingContext2D, marks: readonly PhotoEditMark[], width: number, height: number): void {
  for (const mark of marks) {
    if (mark.kind === "cover") {
      // Expand fractional edges to full pixels: no antialiased sliver of the source remains.
      const x = Math.floor(mark.x * width), y = Math.floor(mark.y * height);
      ctx.fillStyle = "#000000";
      ctx.fillRect(x, y, Math.ceil((mark.x + mark.width) * width) - x, Math.ceil((mark.y + mark.height) * height) - y);
      continue;
    }
    // Invalid CSS leaves fillStyle unchanged; two sentinels also accept valid colors
    // equal to either sentinel without accepting a silently ignored invalid color.
    ctx.fillStyle = "#000001"; ctx.fillStyle = mark.color;
    const parsed = ctx.fillStyle;
    ctx.fillStyle = "#000002"; ctx.fillStyle = mark.color;
    if (ctx.fillStyle !== parsed) throw failure("INVALID_MARK");
    ctx.strokeStyle = parsed;
    ctx.lineWidth = mark.width * Math.min(width, height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const first = mark.points[0];
    ctx.beginPath();
    if (mark.points.length === 1) {
      ctx.arc(first.x * width, first.y * height, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(first.x * width, first.y * height);
      for (const point of mark.points.slice(1)) ctx.lineTo(point.x * width, point.y * height);
      ctx.stroke();
    }
  }
}

async function render(file: File, intent: PhotoEditIntent, quality: MediaQuality | null, signal?: AbortSignal): Promise<PhotoEditResult> {
  checkAbort(signal);
  const recipe = snapshot(intent);
  if (!(file instanceof File) || !isCanvasPhotoCandidate(file.type) || !file.size || file.size > MAX_ORIGINAL_ATTACHMENT_BYTES) {
    throw failure("UNSUPPORTED_FILE");
  }
  if (typeof document === "undefined") throw failure("UNAVAILABLE");
  let url: string | null = null, image: HTMLImageElement | null = null, canvas: HTMLCanvasElement | null = null;
  try {
    image = new Image();
    const decoded = new Promise<void>((resolve, reject) => {
      image!.onload = () => resolve();
      image!.onerror = () => reject(failure("DECODE_FAILED"));
    });
    url = URL.createObjectURL(file);
    image.src = url;
    await abortable(decoded, signal);
    checkAbort(signal);
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw failure("DECODE_FAILED");
    const turned = recipe.rotation === 90 || recipe.rotation === 270;
    const natural = { width: turned ? height : width, height: turned ? width : height };
    const crop = recipe.crop ?? { x: 0, y: 0, ...natural };
    if (crop.x + crop.width > natural.width || crop.y + crop.height > natural.height) throw failure("INVALID_CROP");
    if (recipe.rotation === 0 && crop.x === 0 && crop.y === 0 && crop.width === width && crop.height === height && !recipe.marks.length) {
      return { file, width, height, changed: false };
    }
    const profile = quality === null ? null : getImageUploadProfile(quality);
    const target = compressedPhotoSize(crop.width, crop.height, profile?.maxDimension ?? PHOTO_MAX_LONG_SIDE);
    if (!Number.isSafeInteger(target.width) || !Number.isSafeInteger(target.height) || target.width < 1 || target.height < 1
      || target.width > PHOTO_MAX_LONG_SIDE || target.height > PHOTO_MAX_LONG_SIDE) throw failure("CANVAS_LIMIT");
    const encoding = profile
      ? compressedPhotoEncoding({ webpEncodes: await abortable(canvasEncodesWebp(), signal), webpQuality: profile.quality })
      : { type: PNG_TYPE, quality: undefined };
    checkAbort(signal);
    canvas = document.createElement("canvas");
    canvas.width = target.width; canvas.height = target.height;
    const ctx = canvas.getContext("2d", { alpha: encoding.type !== JPEG_TYPE });
    if (!ctx) throw failure("UNAVAILABLE");
    if (encoding.type === JPEG_TYPE) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, target.width, target.height); }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    // Draw only the result canvas; do not allocate another full-size rotated image.
    ctx.scale(target.width / crop.width, target.height / crop.height);
    ctx.translate(-crop.x, -crop.y);
    ctx.translate(natural.width / 2, natural.height / 2);
    ctx.rotate(recipe.rotation * Math.PI / 180);
    ctx.drawImage(image, -width / 2, -height / 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    paintMarks(ctx, recipe.marks, target.width, target.height);
    checkAbort(signal);
    const blob = await abortable(new Promise<Blob>((resolve, reject) => {
      canvas!.toBlob(value => value?.size ? resolve(value) : reject(failure("EXPORT_FAILED")), encoding.type, encoding.quality);
    }), signal);
    checkAbort(signal);
    const identity = encodedFileIdentity(file.name, "edit", blob.type);
    if (!identity || (quality === null && identity.type !== PNG_TYPE)) throw failure("EXPORT_FAILED");
    return { file: new File([blob], identity.name, { type: identity.type, lastModified: Date.now() }),
      width: target.width, height: target.height, changed: true };
  } finally {
    if (image) { image.onload = image.onerror = null; image.removeAttribute("src"); }
    if (url) URL.revokeObjectURL(url);
    if (canvas) canvas.width = canvas.height = 0;
  }
}

/** Lossless encoding of the bounded, flattened result; no lossy quality pass. */
export function renderPhotoEditPreview(file: File, intent: PhotoEditIntent, signal?: AbortSignal): Promise<PhotoEditResult> {
  return render(file, intent, null, signal);
}

/** A deliberate edit never falls back to the unedited file, even if the output is larger. */
export function exportPhotoEdit(file: File, intent: PhotoEditIntent, options: { signal?: AbortSignal; quality: MediaQuality }): Promise<PhotoEditResult> {
  if (!["compact", "balanced", "original"].includes(options?.quality)) return Promise.reject(failure("INVALID_QUALITY"));
  return render(file, intent, options.quality, options.signal);
}
