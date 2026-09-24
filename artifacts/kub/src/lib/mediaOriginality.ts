/**
 * Whether the stored file is what the sender picked, or a copy of it (D-097).
 *
 * The viewer's file control has always acted on `message.media_url`, and that
 * is the only file there is: `stageFiles` in `ChatWindow.tsx` uploads
 * `prepareChatImageAttachment`'s output, so for a photo sent the ordinary way
 * the original never leaves the sender's device. The control is therefore
 * already opening the best file that exists — what it got wrong was the claim.
 * It said «Открыть оригинал» until D-147 renamed it, and the viewer's header
 * still marks an original with «Оригинал» while saying nothing at all about a
 * copy, so «Сохранить» on a 4 MB photograph quietly hands over a 380 KB WebP.
 *
 * Three states, and the third one is the point: a message whose metadata does
 * not say must not be made to say. Legacy rows, a round video's own metadata
 * (which carries neither `optimized` nor `original_size_bytes`), a bot's media
 * and anything opened from a surface that does not read a message row all land
 * there, and the interface stays silent rather than guessing.
 *
 * What this module does **not** do is invent an original. Keeping one for a
 * compressed send would mean uploading the picked file beside the copy — a
 * storage and a retention decision, and a second upload on every phone — which
 * is a product change, not a wording fix. See the D-097 entry in the register
 * for what that would cost.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 */

export type MediaOriginality =
  /** The stored file is what was picked: «Отправить без сжатия». */
  | "original"
  /** The stored file was re-encoded; what was picked stayed with the sender. */
  | "compressed"
  /** The metadata does not say, so nothing is claimed. */
  | "unknown";

function record(metadata: unknown): Record<string, unknown> | null {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : null;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** A MIME type without its parameters, folded, for comparing one against another. */
function bareType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const bare = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return bare.length > 0 ? bare : null;
}

/**
 * What the stored file is, read from `media_metadata` alone.
 *
 * `uncompressed` is the sender's own answer and is believed first. Otherwise
 * the file is only called a copy where something in the metadata proves it was
 * re-encoded — the flag `buildAttachmentMediaMetadata` writes, a picked size
 * larger than the stored one, or a stored type that is not the picked one. A
 * photograph the canvas could not make smaller has none of those, and it is
 * reported unknown rather than called a copy it is not.
 */
export function mediaOriginality(metadata: unknown): MediaOriginality {
  const fields = record(metadata);
  if (!fields) return "unknown";
  if (fields.uncompressed === true) return "original";

  if (fields.optimized === true) return "compressed";

  const picked = positive(fields.original_size_bytes);
  const stored = positive(fields.size_bytes);
  if (picked !== null && stored !== null && picked > stored) return "compressed";

  const pickedType = bareType(fields.original_mime_type);
  const storedType = bareType(fields.mime_type);
  if (pickedType !== null && storedType !== null && pickedType !== storedType) return "compressed";

  return "unknown";
}

export interface OriginalityNote {
  /**
   * The word beside the picture's title, where the row can hold it.
   *
   * The viewer's header is one 48px row that already carries a title, a file
   * control, a fullscreen control on a video and the way out; at 390 that row
   * is what D-147 measured down to 37 pixels of title.
   */
  badge: string;
  /**
   * The same fact in the narrowest header the product ships to.
   *
   * Measured, not guessed: at 360 a video — the one kind with a fourth
   * control — left the picture's own name **51 pixels** beside «Сжатая копия»,
   * which is four characters and an ellipsis. «Копия» is 47 pixels narrower and
   * it is the exact opposite of «Оригинал», so the pair reads as a pair. The
   * reason it is a copy is in `sentence`, which is the same on both, and in the
   * file control's own accessible name, which a screen reader gets at every
   * width.
   */
  compactBadge: string;
  /**
   * The whole sentence, for the tooltip and for a screen reader. The badge is a
   * label; this is what it means.
   */
  sentence: string;
}

const NOTES: Record<Exclude<MediaOriginality, "unknown">, OriginalityNote> = {
  original: {
    badge: "Оригинал",
    // Already short enough for 360; a second spelling would only be a second
    // thing to keep true.
    compactBadge: "Оригинал",
    sentence: "Файл отправлен без сжатия — это оригинал.",
  },
  compressed: {
    badge: "Сжатая копия",
    compactBadge: "Копия",
    // The consequence, stated once: there is nothing better to ask for.
    sentence: "Оригинал остался у отправителя: в чат отправлена сжатая копия.",
  },
};

/** What the header says about the file, or nothing where nothing is known. */
export function originalityNote(state: MediaOriginality): OriginalityNote | null {
  return state === "unknown" ? null : NOTES[state];
}

/**
 * What a screen reader hears on the file control.
 *
 * Composed here rather than in `mediaFileAction`, which answers a different
 * question — which shell this is, and whether the press leaves the app (D-147).
 * That answer is unchanged; this adds what the press will hand over. Where the
 * state is unknown the control keeps exactly the name D-147 gave it, so no
 * shell's wording moves on a message that says nothing about itself.
 */
export function mediaFileActionName(
  action: { kind: "save" | "open" | "share"; accessibleName: string },
  state: MediaOriginality,
): string {
  if (state === "unknown") return action.accessibleName;
  const what = state === "original" ? "оригинал" : "сжатую копию";
  if (action.kind === "share") {
    return state === "original"
      ? "Поделиться оригиналом или сохранить его"
      : "Поделиться сжатой копией или сохранить её";
  }
  return action.kind === "save" ? `Сохранить ${what}` : `Открыть ${what} в браузере`;
}
