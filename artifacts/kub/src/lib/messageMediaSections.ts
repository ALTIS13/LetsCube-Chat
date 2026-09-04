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
 * The division was first drawn as a strip of tabs inside a sub-view. It is a
 * vertical list of counted rows in the card's own scroll now — «1543
 * фотографии», one per line — which is why this module also owns the Russian
 * numeral agreement: the count is the label, not a badge beside one.
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

/**
 * The three Russian forms a noun takes after a number, in the order the
 * agreement rule below asks for them: «1 фотография», «2 фотографии»,
 * «5 фотографий».
 */
export type RussianPluralForms = readonly [one: string, few: string, many: string];

/**
 * Which of the three forms a count takes.
 *
 * The rule is the standard one and its awkward part is the teens: 11 through 14
 * take the «many» form even though they end in 1, 2, 3 and 4. Writing the
 * `mod 10` test first — the shape this was almost written in — produces
 * «11 фотография» and «12 фотографии», which is the mistake that makes an
 * interface read as machine-translated.
 */
export function selectRussianPluralForm(count: number, forms: RussianPluralForms): string {
  const absolute = Math.abs(Math.trunc(count));
  const teens = absolute % 100;
  if (teens >= 11 && teens <= 14) return forms[2];
  const unit = absolute % 10;
  if (unit === 1) return forms[0];
  if (unit >= 2 && unit <= 4) return forms[1];
  return forms[2];
}

/**
 * The noun each section counts, for the card's own list of rows.
 *
 * The card names a kind by counting it — «96 файлов», not «Файлы 96» — so the
 * short strip labels in `MESSAGE_MEDIA_SECTION_LABELS` are not enough on their
 * own: they are nominative headings, and a heading after a numeral is wrong in
 * Russian. Both live here so the row and the sub-view title cannot drift apart.
 *
 * `видео` is indeclinable and is the same word in all three slots on purpose;
 * that is not a placeholder waiting to be filled in.
 */
export const MESSAGE_MEDIA_COUNT_FORMS: Readonly<Record<MessageMediaKind, RussianPluralForms>> = Object.freeze({
  photo: ["фотография", "фотографии", "фотографий"] as const,
  video: ["видео", "видео", "видео"] as const,
  gif: ["GIF-анимация", "GIF-анимации", "GIF-анимаций"] as const,
  file: ["файл", "файла", "файлов"] as const,
  link: ["ссылка", "ссылки", "ссылок"] as const,
  voice: ["голосовое сообщение", "голосовых сообщения", "голосовых сообщений"] as const,
  videoMessage: ["видеосообщение", "видеосообщения", "видеосообщений"] as const,
  audio: ["аудиозапись", "аудиозаписи", "аудиозаписей"] as const,
});

/**
 * A total per kind, as counted where the rows are.
 *
 * `chat_media_counts` returns one row per kind that a chat actually holds, so a
 * kind missing from this map holds nothing — which is different from a kind
 * this map does not know about, and `null` in place of the whole map is that
 * second case: the server was not asked, or could not answer.
 */
export type MessageMediaCounts = Partial<Record<MessageMediaKind, number>>;

const MESSAGE_MEDIA_KIND_SET: ReadonlySet<string> = new Set<string>(MESSAGE_MEDIA_SECTION_ORDER);

export function isMessageMediaKind(value: unknown): value is MessageMediaKind {
  return typeof value === "string" && MESSAGE_MEDIA_KIND_SET.has(value);
}

/** One row of `chat_media_counts`, before it is trusted. */
export interface ChatMediaCountRow {
  kind?: unknown;
  total?: unknown;
}

/**
 * The RPC's rows as a map, with anything unrecognised dropped.
 *
 * A kind the server names and this build does not know is skipped rather than
 * shown as a row with no label, so deploying a migration ahead of the client
 * degrades to the old behaviour for that kind instead of rendering `undefined`.
 */
export function parseMessageMediaCounts(
  rows: readonly ChatMediaCountRow[] | null | undefined,
): MessageMediaCounts {
  const counts: MessageMediaCounts = {};
  for (const row of rows ?? []) {
    const kind = row?.kind;
    const total = typeof row?.total === "string" ? Number(row.total) : row?.total;
    if (!isMessageMediaKind(kind)) continue;
    if (typeof total !== "number" || !Number.isFinite(total) || total < 0) continue;
    counts[kind] = Math.trunc(total);
  }
  return counts;
}

export interface MessageMediaSection<TRow extends MessageMediaRow> {
  kind: MessageMediaKind;
  label: string;
  items: TRow[];
  /**
   * How many of this kind the chat holds — the server's total when one is
   * known, and only otherwise `items.length`.
   */
  count: number;
  /** How many are held here, which can be fewer than `count`. */
  loadedCount: number;
  /**
   * More of this kind exist than are held here.
   *
   * This is per section on purpose. The sub-view's «show more» used to key off
   * the media page counter, so it appeared under «Ссылки» — a section that
   * counter cannot extend — and offered to fetch something that was already
   * complete.
   */
  hasMore: boolean;
  /**
   * What to print beside the label. `12+` only when the total is a guess:
   * «at least 12» is true of a partial page either way, where a bare `12`
   * beside 300 photos is not. With a server total there is nothing to hedge.
   */
  countLabel: string;
  /**
   * The whole row, count and noun together: «1543 фотографии». This is what the
   * card prints — the count is not a badge beside a label, it is the label.
   */
  countedLabel: string;
}

/** `12`, or `12+` while the list is still incomplete. */
export function formatMediaCount(count: number, hasMore = false): string {
  return hasMore ? `${count}+` : `${count}`;
}

/**
 * «1543 фотографии», or «24+ фотографии» while rows are still unloaded.
 *
 * The noun agrees with the number that is actually printed, not with some
 * unknown larger total: `24+` is read as «at least 24», and «24+ фотографий»
 * would disagree with the 24 standing next to it.
 */
export function formatMediaCountLabel(
  kind: MessageMediaKind,
  count: number,
  hasMore = false,
): string {
  return `${formatMediaCount(count, hasMore)} ${selectRussianPluralForm(count, MESSAGE_MEDIA_COUNT_FORMS[kind])}`;
}

export interface BuildMediaSectionsOptions {
  /** More media rows exist on the server than were loaded. */
  hasMore?: boolean;
  /**
   * More link rows exist on the server than were loaded.
   *
   * Separate from `hasMore` because links are ordinary text messages fetched by
   * their own query: one flag standing for both is how «Ссылки» came to offer
   * more when it had everything.
   */
  hasMoreLinks?: boolean;
  /**
   * Exact per-kind totals from `chat_media_counts`, or null when the server was
   * not asked. With them a kind gets a row because the chat holds it, not
   * because a page happened to contain it.
   */
  counts?: MessageMediaCounts | null;
}

/**
 * Divide the chat's media into the sections it actually holds.
 *
 * A section with nothing in it is never returned. Offering «0 ссылок» in a chat
 * that has never contained a link is a row that does nothing, and eight of them
 * is the whole card spent on emptiness.
 *
 * Which sections exist comes from the server's totals when there are any, and
 * only otherwise from the loaded rows. That distinction is the point: counted
 * from one page of 24, a chat whose newest messages are all photos has no
 * «Файлы» row while holding ninety-six files, and a list that looks like an
 * inventory is then making a false claim by omission.
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

  const counts = options.counts ?? null;
  const sections: MessageMediaSection<TRow>[] = [];
  for (const kind of MESSAGE_MEDIA_SECTION_ORDER) {
    const items = grouped.get(kind) ?? [];
    const total = counts?.[kind];
    const totalKnown = typeof total === "number";
    if (items.length === 0 && !(totalKnown && total > 0)) continue;
    // A total below what is already on screen would print a number the reader
    // can disprove by counting, so the larger of the two wins.
    const count = totalKnown ? Math.max(total, items.length) : items.length;
    const hasMore = totalKnown
      ? items.length < count
      : (kind === "link" ? options.hasMoreLinks === true : options.hasMore === true);
    // Only a guessed total is hedged with `+`.
    const partial = !totalKnown && hasMore;
    sections.push({
      kind,
      label: MESSAGE_MEDIA_SECTION_LABELS[kind],
      items,
      count,
      loadedCount: items.length,
      hasMore,
      countLabel: formatMediaCount(count, partial),
      countedLabel: formatMediaCountLabel(kind, count, partial),
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
 * rather than leaving the sub-view showing nothing under a title naming a kind
 * this chat no longer has.
 */
export function resolveActiveMediaSection<TRow extends MessageMediaRow>(
  sections: readonly MessageMediaSection<TRow>[],
  requested: MessageMediaKind | null,
): MessageMediaKind | null {
  if (sections.length === 0) return null;
  if (requested && sections.some((section) => section.kind === requested)) return requested;
  return sections[0].kind;
}
