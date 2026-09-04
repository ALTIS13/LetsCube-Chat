/**
 * What kind of thing a message actually is, and how a shared-media list is
 * divided by it.
 *
 * The contact card used to show one undifferentiated grid: a voice note, a PDF
 * and a photo were the same tile, and finding the file somebody sent last week
 * meant scrolling past every picture in the chat. The reference product divides
 * the same rows into counted sections, and the division is entirely derivable
 * from rows the panel already loads — so it belongs here, apart from the
 * component, where `node --test` can reach it.
 *
 * Two predicates below were lifted out of `ChatWindow.tsx` rather than copied.
 * A second copy of "is this a voice message" drifts from the first one silently,
 * and then the playback layer and the gallery disagree about the same row.
 */

/**
 * The shape this module needs from a message row.
 *
 * Structural on purpose: `Message` from the generated database types and
 * `MessageWithSender` from the chat both satisfy it, and neither has to be
 * imported here — this file must stay loadable by the Node test runner, where
 * the `@/` alias does not resolve.
 */
export interface MessageMediaRow {
  id: string;
  type: string | null;
  content?: string | null;
  media_url?: string | null;
  media_metadata?: unknown;
}

function metadataString(message: MessageMediaRow, key: string): string | null {
  const metadata = message.media_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

/** A round "кружок", not an ordinary video. */
export function isRoundVideoMessageContent(message: MessageMediaRow): boolean {
  return (
    metadataString(message, "kind") === "video_message" ||
    metadataString(message, "shape") === "round" ||
    /^Видео-сообщение(?:\s|\(|$)/i.test(message.content?.trim() ?? "")
  );
}

/** A recorded voice note, as opposed to an audio file that was attached. */
export function isVoiceMessageContent(message: MessageMediaRow): boolean {
  const mediaUrl = message.media_url?.toLowerCase() ?? "";
  const content = message.content?.toLowerCase() ?? "";
  return /\.(webm|ogg|oga|mp3|wav|m4a|aac)(\?|#|$)/.test(mediaUrl) || content.includes("голосовое") || content.includes("voice");
}

/**
 * The sections a shared-media list can offer.
 *
 * `videoMessage` is deliberately not folded into `video`: a round message and a
 * recorded clip are different things to look for, and the predicate that tells
 * them apart already exists. `audio` is the leftover bucket for an attached
 * track that is not a voice note.
 */
export type MessageMediaKind =
  | "photo"
  | "video"
  | "gif"
  | "file"
  | "link"
  | "voice"
  | "videoMessage"
  | "audio";

/** Photos first, because that is what most people open the gallery for. */
export const MESSAGE_MEDIA_SECTION_ORDER: readonly MessageMediaKind[] = Object.freeze([
  "photo",
  "video",
  "gif",
  "file",
  "link",
  "voice",
  "videoMessage",
  "audio",
]);

export const MESSAGE_MEDIA_SECTION_LABELS: Readonly<Record<MessageMediaKind, string>> = Object.freeze({
  photo: "Фото",
  video: "Видео",
  gif: "GIF",
  file: "Файлы",
  link: "Ссылки",
  voice: "Голосовые",
  videoMessage: "Видеосообщения",
  audio: "Аудио",
});

/** Which sections are shown as a grid of tiles rather than as a list of rows. */
export const MESSAGE_MEDIA_GRID_KINDS: readonly MessageMediaKind[] = Object.freeze([
  "photo",
  "video",
  "gif",
  "videoMessage",
]);

export function isGridMediaKind(kind: MessageMediaKind): boolean {
  return MESSAGE_MEDIA_GRID_KINDS.includes(kind);
}

/**
 * The first http(s) link in a piece of text, or null.
 *
 * Trailing punctuation is trimmed: a link at the end of a sentence is followed
 * by a full stop that is not part of the address, and «(см. https://x.ru)» ends
 * with a bracket that would 404.
 */
export function extractFirstLink(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = /https?:\/\/[^\s<>"'`]+/i.exec(text);
  if (!match) return null;
  const trimmed = match[0].replace(/[.,;:!?)\]}»"']+$/, "");
  return trimmed.length > "https://".length ? trimmed : null;
}

/**
 * Which section a row belongs to, or null when it belongs to none.
 *
 * A row with no `media_url` is not media, whatever its type says — that is how
 * a deleted attachment or a half-written row would otherwise arrive in the
 * grid as a broken tile. Text is the one exception: it carries links, which
 * have no media of their own.
 */
export function classifyMessageMedia(message: MessageMediaRow): MessageMediaKind | null {
  const type = message.type;
  if (type === "text") {
    return extractFirstLink(message.content) ? "link" : null;
  }
  if (!message.media_url) return null;
  if (type === "image") return looksLikeGif(message) ? "gif" : "photo";
  if (type === "video") {
    if (isRoundVideoMessageContent(message)) return "videoMessage";
    return looksLikeGif(message) ? "gif" : "video";
  }
  if (type === "audio") return isVoiceMessageContent(message) ? "voice" : "audio";
  if (type === "file") return "file";
  return null;
}

function looksLikeGif(message: MessageMediaRow): boolean {
  const source = `${message.content ?? ""} ${message.media_url ?? ""}`.toLowerCase();
  return source.includes(".gif");
}

export interface MessageMediaSection<TRow extends MessageMediaRow> {
  kind: MessageMediaKind;
  label: string;
  items: TRow[];
  /** How many are held here. Always `items.length`; named so a caller reads it. */
  count: number;
  /**
   * What to print beside the label. `12+` when more rows are still unloaded,
   * because the exact total is not known until they are — and «at least 12» is
   * true either way, where a bare `12` beside 300 photos is not.
   */
  countLabel: string;
}

/** `12`, or `12+` while the list is still incomplete. */
export function formatMediaCount(count: number, hasMore = false): string {
  return hasMore ? `${count}+` : `${count}`;
}

export interface BuildMediaSectionsOptions {
  /** More rows exist on the server than were loaded. */
  hasMore?: boolean;
}

/**
 * Divide loaded rows into the sections that are actually populated.
 *
 * A section with nothing in it is never returned. Offering «Ссылки 0» in a chat
 * that has never contained a link is a tab that does nothing, and six of them
 * is the whole width of the card spent on emptiness.
 */
export function buildMessageMediaSections<TRow extends MessageMediaRow>(
  rows: readonly TRow[],
  options: BuildMediaSectionsOptions = {},
): MessageMediaSection<TRow>[] {
  const grouped = new Map<MessageMediaKind, TRow[]>();
  for (const row of rows) {
    const kind = classifyMessageMedia(row);
    if (!kind) continue;
    const bucket = grouped.get(kind);
    if (bucket) bucket.push(row);
    else grouped.set(kind, [row]);
  }

  const sections: MessageMediaSection<TRow>[] = [];
  for (const kind of MESSAGE_MEDIA_SECTION_ORDER) {
    const items = grouped.get(kind);
    if (!items || items.length === 0) continue;
    sections.push({
      kind,
      label: MESSAGE_MEDIA_SECTION_LABELS[kind],
      items,
      count: items.length,
      countLabel: formatMediaCount(items.length, options.hasMore === true),
    });
  }
  return sections;
}

/**
 * Which section to show, given the one that was asked for.
 *
 * The requested section can stop existing while it is open — «Очистить историю
 * у себя» empties every section, and loading a further page can only add. So a
 * request that no longer matches falls back to the first section that does
 * rather than leaving the gallery showing nothing with tabs above it.
 */
export function resolveActiveMediaSection<TRow extends MessageMediaRow>(
  sections: readonly MessageMediaSection<TRow>[],
  requested: MessageMediaKind | null,
): MessageMediaKind | null {
  if (sections.length === 0) return null;
  if (requested && sections.some((section) => section.kind === requested)) return requested;
  return sections[0].kind;
}
