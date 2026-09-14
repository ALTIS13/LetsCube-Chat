/**
 * A group's channels, arranged the way a server arranges them.
 *
 * The product already had the pieces and used almost none of them. `topics` is
 * a text channel with a name, an emoji, a position and an archive flag;
 * `voice_channels` is a room with a name, a position, a seat limit and a
 * `speak_role`; both carry "admins manage ..." at the RLS layer, so an
 * administrator could always have had as many as they liked. What the interface
 * did was read one voice channel (`.limit(1)`) and draw the text ones as a
 * horizontal strip of capsules -- a forum's shape, where one conversation has
 * threads beside it.
 *
 * A server is the other shape: one place holds **many** rooms, they are listed
 * vertically under headings, and the list itself is the navigation. That is the
 * difference the owner asked for, and it is a difference in mechanics rather
 * than in wording:
 *
 *   - a voice channel is a **place**, not a call. It exists when empty, it is
 *     named, and joining it is one click with no ringing and nobody to accept.
 *     Several stand side by side and people choose between them;
 *   - who is inside is **public to the group**, listed under the channel's own
 *     name, so the rail answers "where is everyone" without anybody being asked;
 *   - switching rooms is one click on another room, not leave-then-join;
 *   - headings group the rooms, and collapse.
 *
 * This module holds the arrangement and the rules. It imports nothing, so
 * `node --test` reaches every branch without a browser.
 *
 * Two facts of the schema are load-bearing here, both read off production on
 * 2026-09-14 rather than assumed:
 *
 *   1. A channel's category is scoped to the channel's own chat by a composite
 *      foreign key on `(chat_id, category_id)`. Nothing in the client can put a
 *      channel under another group's heading, so nothing here defends against
 *      it -- and a category id that does not resolve is treated as no category
 *      rather than as an error, because that is what a deleted heading leaves.
 *   2. Deleting a category nulls only `category_id`
 *      (`on delete set null (category_id)`), so its channels survive and land
 *      in the uncategorised group. The rail must therefore always be able to
 *      draw that group, even in a server whose every channel was categorised a
 *      moment ago.
 */

export type ChannelKind = "text" | "voice";

/** Exactly `chat_member_role`, in rank order, least first. */
export const CHAT_ROLE_RANK = ["member", "admin", "owner"] as const;
export type ChatRole = (typeof CHAT_ROLE_RANK)[number];

export interface ChannelCategory {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  /** Tie-break, so two headings at the same position keep a stable order. */
  readonly createdAt?: string | null;
}

export interface ServerChannel {
  readonly id: string;
  readonly kind: ChannelKind;
  readonly name: string;
  readonly position: number;
  readonly categoryId: string | null;
  readonly createdAt?: string | null;
  /** Text channels only: the emoji `topics.emoji` carries, if any. */
  readonly emoji?: string | null;
  /** Text channels only: the one the group started with, which cannot be removed. */
  readonly isGeneral?: boolean;
  /** Voice channels only. */
  readonly maxParticipants?: number | null;
  readonly speakRole?: ChatRole | null;
  readonly participantCount?: number | null;
}

export interface ChannelGroup {
  /** `null` for the channels that sit above the first heading. */
  readonly category: ChannelCategory | null;
  readonly channels: readonly ServerChannel[];
}

// ---------------------------------------------------------------------------
// Arrangement
// ---------------------------------------------------------------------------

function byPosition<T extends { position: number; createdAt?: string | null; id: string }>(
  a: T,
  b: T,
): number {
  if (a.position !== b.position) return a.position - b.position;
  const left = a.createdAt ?? "";
  const right = b.createdAt ?? "";
  if (left !== right) return left < right ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The rail, in the order it is drawn.
 *
 * Uncategorised channels come **first**, above every heading, which is where a
 * server puts them and also where a channel that has just lost its heading has
 * to appear -- otherwise deleting a category would look like deleting the rooms
 * under it.
 *
 * Within a group, **text before voice**, then by position. Not decoration: the
 * two kinds are separate tables with separate position sequences, so
 * interleaving them by position alone would order them by an accident of which
 * table counted first. Discord keeps the same split for the same reason.
 *
 * An empty uncategorised group is dropped, an empty **category** is kept: a
 * heading somebody made and has not filled yet is a thing they are in the
 * middle of doing, and a rail that hides it looks broken.
 */
export function buildChannelTree(input: {
  categories: readonly ChannelCategory[];
  channels: readonly ServerChannel[];
}): ChannelGroup[] {
  const categories = [...input.categories].sort(byPosition);
  const known = new Set(categories.map((category) => category.id));

  const live = input.channels.filter((channel) => !isArchived(channel));
  const bucket = new Map<string, ServerChannel[]>();
  const loose: ServerChannel[] = [];

  for (const channel of live) {
    const id = channel.categoryId;
    // A category id nothing resolves is no category: that is what a heading
    // deleted between the two reads leaves behind, and it must not hide a room.
    if (!id || !known.has(id)) {
      loose.push(channel);
      continue;
    }
    const list = bucket.get(id);
    if (list) list.push(channel);
    else bucket.set(id, [channel]);
  }

  const order = (list: ServerChannel[]) =>
    [...list].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "text" ? -1 : 1;
      return byPosition(a, b);
    });

  const groups: ChannelGroup[] = [];
  if (loose.length > 0) groups.push({ category: null, channels: order(loose) });
  for (const category of categories) {
    groups.push({ category, channels: order(bucket.get(category.id) ?? []) });
  }
  return groups;
}

function isArchived(channel: ServerChannel & { archived?: boolean }): boolean {
  return channel.archived === true;
}

/** Every channel of the rail, flattened in drawing order. */
export function flattenChannelTree(groups: readonly ChannelGroup[]): ServerChannel[] {
  return groups.flatMap((group) => [...group.channels]);
}

// ---------------------------------------------------------------------------
// Who may do what
// ---------------------------------------------------------------------------

function rank(role: string | null | undefined): number {
  const index = (CHAT_ROLE_RANK as readonly string[]).indexOf((role ?? "").trim());
  return index < 0 ? -1 : index;
}

/**
 * Whether this member may add, rename, move or remove channels and headings.
 *
 * Mirrors `public.is_chat_admin`, which is `role in ('owner', 'admin')` and
 * nothing else -- deliberately not the wider client notion of staff, for the
 * same reason the moderation queue is not (`lib/moderationAccess.ts`): a
 * control the database will refuse is worse than no control.
 */
export function canManageChannels(role: string | null | undefined): boolean {
  return rank(role) >= rank("admin");
}

/** Whether this member may speak in the room, as `speak_role` decides. */
export function canSpeakInChannel(
  channel: Pick<ServerChannel, "speakRole">,
  role: string | null | undefined,
): boolean {
  return rank(role) >= rank(channel.speakRole ?? "member");
}

export type VoiceJoinVerdict = "ok" | "full" | "listen-only" | "not-a-member";

/**
 * Whether this person can join the room, and if not, which of the three.
 *
 * `full` and `listen-only` are different answers and must not be one: the first
 * says come back later, the second says you are welcome now but will not be
 * heard. Collapsing them into "нельзя" is how a room nobody may speak in gets
 * mistaken for a room nobody may enter.
 *
 * The seat count is compared against the row's own counter rather than the
 * length of the participant list, because the row's is what the gateway
 * compares against `max_participants` before it mints a token -- so it is the
 * number the refusal will actually be made on.
 */
export function voiceJoinVerdict(input: {
  channel: Pick<ServerChannel, "maxParticipants" | "speakRole" | "participantCount">;
  role: string | null | undefined;
  /** Already inside: switching seats is not a new seat. */
  alreadyInside?: boolean;
}): VoiceJoinVerdict {
  if (rank(input.role) < 0) return "not-a-member";
  const limit = input.channel.maxParticipants ?? 0;
  const inside = Math.max(0, input.channel.participantCount ?? 0);
  if (!input.alreadyInside && limit > 0 && inside >= limit) return "full";
  return canSpeakInChannel(input.channel, input.role) ? "ok" : "listen-only";
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** `chat_channel_categories_name_length`, and the same bound both kinds use. */
export const CHANNEL_NAME_MAX = 64;

/**
 * A channel name as the insert may carry it, or null when there is none.
 *
 * Trimmed and cut **by code point**, because the CHECK behind it counts
 * characters (`char_length`) while `String.length` counts UTF-16 code units,
 * and an emoji costs two of those. The same cut `normalizeReportNote` makes,
 * for the same reason.
 *
 * Deliberately **not** lowercased or hyphenated. Discord does that to text
 * channel names; this product's groups are named in Russian in ordinary
 * sentence case everywhere else, and a field that silently rewrites what
 * somebody typed is a field they stop trusting.
 */
export function normalizeChannelName(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").replace(/\s+/gu, " ").trim();
  if (!trimmed) return null;
  const points = Array.from(trimmed);
  return points.length <= CHANNEL_NAME_MAX ? trimmed : points.slice(0, CHANNEL_NAME_MAX).join("");
}

/** How many characters are left, counted the way the constraint counts them. */
export function channelNameRemaining(value: string | null | undefined): number {
  return CHANNEL_NAME_MAX - Array.from((value ?? "").trim()).length;
}

/**
 * The next position for a new channel or heading.
 *
 * One past the last, rather than the count: positions are not required to be
 * contiguous, and after a few removals the count would collide with a row that
 * is still there. A collision is not fatal -- `byPosition` breaks ties by
 * creation time -- but a list whose order depends on a tie-break is a list that
 * reorders itself when two rows are made in the same millisecond.
 */
export function nextPosition(existing: readonly { position: number }[]): number {
  let highest = -1;
  for (const row of existing) {
    if (Number.isFinite(row.position) && row.position > highest) highest = row.position;
  }
  return highest + 1;
}

/**
 * The positions to write to move one row to a new index within its list.
 *
 * Returns only the rows whose position actually changes, so a drag that lands
 * where it started writes nothing. The whole run is renumbered from zero rather
 * than nudged, which is what keeps a list that has been reordered many times
 * from drifting into positions no human would choose.
 */
export function reorderPositions<T extends { id: string; position: number }>(
  rows: readonly T[],
  movedId: string,
  toIndex: number,
): { id: string; position: number }[] {
  const from = rows.findIndex((row) => row.id === movedId);
  if (from < 0) return [];
  const target = Math.max(0, Math.min(rows.length - 1, Math.trunc(toIndex)));
  if (target === from) return [];

  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);

  const writes: { id: string; position: number }[] = [];
  next.forEach((row, index) => {
    if (row.position !== index) writes.push({ id: row.id, position: index });
  });
  return writes;
}
