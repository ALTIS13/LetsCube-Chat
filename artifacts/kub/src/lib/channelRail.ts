/**
 * What the channel rail decides, stated without React and without a browser.
 *
 * `lib/serverChannels.ts` holds the arrangement and the permissions — how the
 * groups come out, who may manage them, whether somebody may join a room. This
 * module holds the rest of the rail's rules, the ones that only exist because
 * the rail is drawn inside **this** product rather than beside a fresh schema:
 *
 *   - a database row is not a channel yet. `topics` and `voice_channels` are two
 *     tables with different columns and one shape on screen;
 *   - the conversation itself is a channel with **no row**. A group that is not
 *     a forum has no `topics` row at all, and a forum's general stream is
 *     `selectedTopicId = null` rather than the id of its `is_general` row
 *     (`useTopics.ts` forces that, and has since topics shipped). The rail is
 *     the navigation, so it has to be able to draw the stream you are reading
 *     whether or not a row exists for it;
 *   - which of several rooms the call capsule speaks for. With one voice channel
 *     that question had no content; with several, answering it wrongly ends a
 *     live call, because `voiceCallLostItsChannel` reads «this chat's channel is
 *     not the one I am in» as «an administrator ended it»;
 *   - whether there is room for a column at all, measured against the pane.
 *
 * It imports nothing but types, so `node --test` loads it directly and
 * `tests/unit/server-channel-rail.test.mts` reaches every branch. The lesson is
 * CLAUDE.md's: a check that cannot be reached from a test is a gap in the module
 * boundary, not in the suite.
 */

import type { ChannelCategory, ChatRole, ServerChannel } from "./serverChannels";

/**
 * The id the rail gives the conversation when no `topics` row describes it.
 *
 * Not a uuid, and deliberately not one: it must never be mistaken for a row by
 * anything that writes. `topicIdForChannel` maps it back to `null`, which is
 * what the store holds for the general stream, so nothing downstream ever sees
 * it. A uuid-shaped sentinel would eventually be sent somewhere as a filter.
 */
export const GENERAL_CHANNEL_ID = "general";

/** What the general stream is called where the product already names it. */
export const GENERAL_CHANNEL_NAME = "Общие";

// ---------------------------------------------------------------------------
// Rows to channels
// ---------------------------------------------------------------------------

/** `public.topics`, as much of it as the rail reads. */
export interface TopicRow {
  id: string;
  name: string;
  emoji?: string | null;
  is_general?: boolean | null;
  position?: number | null;
  archived?: boolean | null;
  category_id?: string | null;
  created_at?: string | null;
}

/** `public.voice_channels`, as much of it as the rail reads. */
export interface VoiceChannelRow {
  id: string;
  name: string;
  position?: number | null;
  max_participants?: number | null;
  speak_role?: string | null;
  participant_count?: number | null;
  archived?: boolean | null;
  category_id?: string | null;
  created_at?: string | null;
}

/** `public.chat_channel_categories`, as much of it as the rail reads. */
export interface ChannelCategoryRow {
  id: string;
  name: string;
  position?: number | null;
  created_at?: string | null;
}

function positionOf(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * A text channel.
 *
 * `archived` is carried through rather than filtered here, because
 * `buildChannelTree` is the one place that drops archived rows and two places
 * deciding the same thing is how they come to disagree.
 */
export function textChannelFromTopic(row: TopicRow): ServerChannel & { archived?: boolean } {
  return {
    id: row.id,
    kind: "text",
    name: row.name,
    position: positionOf(row.position),
    categoryId: row.category_id ?? null,
    createdAt: row.created_at ?? null,
    emoji: row.emoji ?? null,
    isGeneral: row.is_general === true,
    archived: row.archived === true,
  };
}

/**
 * A voice room.
 *
 * `speak_role` is narrowed to the enum rather than trusted: the column is
 * `chat_member_role`, but this value has travelled through PostgREST as a
 * string, and `canSpeakInChannel` falls back to «member» for anything it does
 * not recognise. Passing an unrecognised string through would make the fallback
 * silent instead of deliberate.
 */
export function voiceChannelFromRow(row: VoiceChannelRow): ServerChannel & { archived?: boolean } {
  const speakRole = row.speak_role;
  return {
    id: row.id,
    kind: "voice",
    name: row.name,
    position: positionOf(row.position),
    categoryId: row.category_id ?? null,
    createdAt: row.created_at ?? null,
    maxParticipants: typeof row.max_participants === "number" ? row.max_participants : null,
    speakRole:
      speakRole === "owner" || speakRole === "admin" || speakRole === "member"
        ? (speakRole as ChatRole)
        : null,
    participantCount: typeof row.participant_count === "number" ? row.participant_count : 0,
    archived: row.archived === true,
  };
}

export function categoryFromRow(row: ChannelCategoryRow): ChannelCategory {
  return {
    id: row.id,
    name: row.name,
    position: positionOf(row.position),
    createdAt: row.created_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// The conversation itself
// ---------------------------------------------------------------------------

/**
 * The channels with the conversation guaranteed to be among them.
 *
 * A group that is not a forum has no `topics` row, so without this the rail of
 * a group whose only extra channel is a voice room would list the room and not
 * the conversation the person is reading — a navigation that cannot navigate
 * back to where you already are.
 *
 * Position -1 so it sorts above every real row in its group, which is where the
 * general channel sits in the product today (`useTopics` orders
 * `is_general` first) and where a server puts it.
 */
export function withGeneralChannel(channels: readonly ServerChannel[]): ServerChannel[] {
  if (channels.some((channel) => channel.kind === "text" && channel.isGeneral === true)) {
    return [...channels];
  }
  return [
    {
      id: GENERAL_CHANNEL_ID,
      kind: "text",
      name: GENERAL_CHANNEL_NAME,
      position: -1,
      categoryId: null,
      emoji: null,
      isGeneral: true,
    },
    ...channels,
  ];
}

/**
 * Whether this group gets a rail instead of the topic strip.
 *
 * «More than the one general topic»: anything at all besides the conversation.
 * A heading on its own counts — somebody made it and is in the middle of
 * filling it, and a group where the only evidence of that disappears has no way
 * to show them what they did.
 *
 * Archived rows are not channels. They are excluded here as well as in
 * `buildChannelTree`, because a group whose every extra channel is archived
 * would otherwise be offered a rail listing one row.
 */
export function railIsOffered(
  channels: readonly (ServerChannel & { archived?: boolean })[],
  categories: readonly ChannelCategory[],
): boolean {
  if (categories.length > 0) return true;
  return channels.some(
    (channel) => channel.archived !== true && !(channel.kind === "text" && channel.isGeneral === true),
  );
}

/**
 * Which text channel is being read, as a rail row's id.
 *
 * The store holds `null` for the general stream, so «nothing selected» and
 * «the conversation» are the same value there and have to be told apart here.
 * A selected id that no longer names a live channel — the row was archived or
 * removed while it was open — falls back to the conversation, which is what
 * `useTopics` does to the store a moment later anyway.
 */
export function currentTextChannelId(
  channels: readonly ServerChannel[],
  selectedTopicId: string | null,
): string | null {
  const text = channels.filter((channel) => channel.kind === "text");
  if (selectedTopicId) {
    const chosen = text.find((channel) => channel.id === selectedTopicId);
    if (chosen) return chosen.id;
  }
  return text.find((channel) => channel.isGeneral === true)?.id ?? text[0]?.id ?? null;
}

/**
 * What to write to `setSelectedTopicId` for this row.
 *
 * `null` for the general channel, whether it is a real row or this module's
 * sentinel. Writing the real `is_general` row's id would be undone within a
 * render: `useTopics` resets the store to `null` whenever the selected topic is
 * the general one, so the rail would highlight a row the store immediately
 * unselects.
 */
export function topicIdForChannel(channel: Pick<ServerChannel, "id" | "isGeneral">): string | null {
  if (channel.isGeneral === true || channel.id === GENERAL_CHANNEL_ID) return null;
  return channel.id;
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/**
 * Which of this chat's rooms the call capsule speaks for.
 *
 * **The room the call is in wins.** This is not a nicety: `voiceCallLostItsChannel`
 * hangs up when this chat's channel is not the one the call is in, because a
 * deleted row is how an administrator ends a voice chat. While there was one
 * room the question could not arise; with several, answering «the first one»
 * would end a live call the moment anybody joined the second.
 *
 * When the call is elsewhere — another chat, or nowhere — the first room is the
 * answer, and that is also correct for the hang-up rule: if the call's own room
 * is gone from this chat's list, no room here has its id, so the verdict is the
 * same whichever one is named.
 */
export function voiceChannelForCall(
  channels: readonly ServerChannel[],
  callChannelId: string | null,
): ServerChannel | null {
  const rooms = channels.filter((channel) => channel.kind === "voice");
  if (callChannelId) {
    const here = rooms.find((room) => room.id === callChannelId);
    if (here) return here;
  }
  return rooms[0] ?? null;
}

/**
 * Whether the capsule under the chat header may name a room at all.
 *
 * Three states, and the middle one is the whole of this rule:
 *
 *   - **a call is running in one of this chat's rooms** — always named. It is
 *     the only mute and the only «Выйти» there is, and it must not disappear
 *     from under somebody who is still audible;
 *   - **this group has exactly one room** — named, and offered. That is the
 *     shipped behaviour and it is still honest: «the voice chat of this group»
 *     means something when there is one of them, and `tests/e2e/voice-call.spec.ts`
 *     drives the whole join from it;
 *   - **this group has several** — nothing. A capsule that says «Курилка ·
 *     Никого нет · Присоединиться» beside a rail listing three rooms is naming
 *     whichever came first, which is not a fact about the group. Photographed in
 *     the rail's first capture; the rail is the way in once there is a choice to
 *     make.
 */
export function capsuleNamesARoom(
  channels: readonly ServerChannel[],
  callChannelId: string | null,
): boolean {
  const rooms = channels.filter((channel) => channel.kind === "voice");
  if (callChannelId && rooms.some((room) => room.id === callChannelId)) return true;
  return rooms.length === 1;
}

/**
 * The seats, as the row prints them, or null when the room has no limit.
 *
 * The row's own counter, not the length of the participant list: that is the
 * number the gateway compares against `max_participants` before it mints a
 * token, so it is the number a refusal will be made on. `voiceJoinVerdict` uses
 * the same one for the same reason.
 */
export function seatLabel(
  channel: Pick<ServerChannel, "maxParticipants" | "participantCount">,
): string | null {
  const limit = channel.maxParticipants ?? 0;
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const inside = Math.max(0, channel.participantCount ?? 0);
  return `${inside}/${limit}`;
}

// ---------------------------------------------------------------------------
// Collapsing
// ---------------------------------------------------------------------------

/**
 * What still shows under a collapsed heading.
 *
 * A server keeps two kinds of row visible in a folded category: the channel you
 * are reading, and a room with people in it. Both are the same idea — folding a
 * heading hides what is quiet, never what is happening — and without it
 * collapsing a category can hide the conversation that is open, which reads as
 * the rail losing your place.
 */
export function channelsShownWhileCollapsed(
  channels: readonly ServerChannel[],
  kept: { textChannelId: string | null; occupiedVoiceIds: readonly string[] },
): ServerChannel[] {
  const occupied = new Set(kept.occupiedVoiceIds);
  return channels.filter((channel) =>
    channel.kind === "text" ? channel.id === kept.textChannelId : occupied.has(channel.id),
  );
}

// ---------------------------------------------------------------------------
// Room for a column
// ---------------------------------------------------------------------------

/** The rail's width as a column, in CSS pixels. */
export const CHANNEL_RAIL_WIDTH = 224;

/**
 * The narrowest the conversation may be left.
 *
 * 360 is not chosen: it is the narrowest viewport in `playwright.config.ts`
 * (`chromium-mobile-360`, the 720x1600 phone three defects came in from), so it
 * is the width the conversation is already checked at on every run. A
 * conversation squeezed below a width nothing tests is a conversation nobody
 * has looked at.
 */
export const CONVERSATION_MIN_WIDTH = 360;

/**
 * Whether the pane can hold the rail as a column, or has to open it as a sheet.
 *
 * Measured against the **pane**, never the viewport, for the reason
 * `paneFitsProfileColumn` is: the chat list is dragged by hand, so at one window
 * width the pane has many. A `md:` breakpoint would put a 224px column into a
 * 336px pane at exactly 768, leaving 112px of conversation.
 */
export function paneFitsChannelRail(paneWidth: number): boolean {
  if (!Number.isFinite(paneWidth)) return false;
  return paneWidth - CHANNEL_RAIL_WIDTH >= CONVERSATION_MIN_WIDTH;
}
