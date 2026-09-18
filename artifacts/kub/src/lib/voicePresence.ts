/**
 * Which conversations have somebody talking in them right now.
 *
 * Slice 3 of `docs/proposals/2026-09-13-voice-channels.md` calls this «the
 * chat-list indicator», and it is the half of voice presence that was missing:
 * the call bar (D-225) tells you about **your own** call from anywhere, and
 * nothing anywhere told you about a call in a group you were not looking at. A
 * voice channel that nobody happens to be watching is a voice channel nobody
 * joins.
 *
 * This module imports one sibling that imports nothing, so `node --test` can
 * still load it. A rule inside a `"use client"` module is a rule with no test;
 * `voiceChannel.ts` records why at its own head.
 *
 * ## A room that is ringing is not a room with somebody talking in it
 *
 * Added with one-to-one calls on 2026-09-18, and it is the half of that change
 * that could have gone wrong quietly. The chat list's read used to be
 * `.gt("participant_count", 0)`, which is why a ring was invisible to the very
 * subscription it was designed to reach: a ringing room has nobody in it. The
 * read is now «somebody in it **or** a live ring», and that widening drags two
 * new shapes past this function:
 *
 *  - a room with a live ring and nobody in it — dropped by the count, as before;
 *  - a room with a live ring and the **caller** already waiting in it, which is
 *    the ordinary state of every outgoing call, because the caller joins the
 *    moment they press. Its count is 1 and it would otherwise put «1 человек в
 *    «Звонок»» on a private conversation where nobody is talking and somebody
 *    is waiting to be answered. That is the mark saying the wrong thing, and it
 *    is what `voiceRingState` is consulted for below.
 *
 * An **answered** ring is left alone on purpose: that is a call in progress, and
 * a private conversation with a call running in it should carry the same mark a
 * group does.
 *
 * ## The counter is all there is, and that is worth stating
 *
 * `voice_channels.participant_count` is denormalised — written by the SFU's
 * webhooks and reconciled twice a minute — so it can be up to one
 * reconciliation period stale. The channel rail does better: it prefers the
 * listed people over the counter, because a counter one period stale would fold
 * a room that has people in it out of sight.
 *
 * The chat list cannot do that. Listing people means reading
 * `voice_participants` for every room of every chat in the list, which is a
 * request per room for a mark the width of a glyph. So this reads the counter,
 * and the cost is named: for a few seconds after the last person leaves, a row
 * can still say somebody is there. The opposite error — a call in progress that
 * the list does not mention — is the one this exists to fix, and it is the worse
 * of the two.
 */

import { voiceRingState } from "./voiceRing.ts";

/** One room with somebody in it, as the list's own read returns it. */
export interface VoiceRoomPresence {
  readonly channelId: string;
  readonly chatId: string;
  readonly name: string;
  readonly count: number;
}

/** What one chat's row says: how many people, in how many rooms, and where. */
export interface ChatVoicePresence {
  /** People across every room of this chat. Never negative, never zero here. */
  readonly count: number;
  /** How many of its rooms have somebody in them. */
  readonly rooms: number;
  /** The busiest room's name, for the hover sentence. */
  readonly name: string;
}

/**
 * The rows, read defensively, because this is a denormalised counter.
 *
 * A row with a count of zero or less is dropped rather than clamped: zero means
 * «nobody there», which is the absence of presence rather than a presence of
 * nought, and a negative can be produced for a moment when a webhook and a
 * reconciliation disagree. `voiceOccupancyLabel` clamps negatives for the same
 * reason and this follows it.
 */
export function readVoicePresenceRows(rows: unknown, now: number): VoiceRoomPresence[] {
  if (!Array.isArray(rows)) return [];
  const out: VoiceRoomPresence[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const channelId = typeof record.id === "string" ? record.id : null;
    const chatId = typeof record.chat_id === "string" ? record.chat_id : null;
    const count = typeof record.participant_count === "number" ? record.participant_count : 0;
    if (channelId === null || chatId === null) continue;
    if (!Number.isFinite(count) || count <= 0) continue;
    // A ring the other side has not answered yet. The caller is in the room, so
    // the count says «1» and means «waiting», which is not what this mark says.
    // `now` is passed in rather than read for the reason the whole ring rule is
    // pure: the boundary between «ringing» and «expired» is something a test has
    // to be able to stand on both sides of.
    const startedAt = typeof record.ring_started_at === "string" ? Date.parse(record.ring_started_at) : NaN;
    const answeredAt = typeof record.ring_answered_at === "string" ? Date.parse(record.ring_answered_at) : NaN;
    if (
      Number.isFinite(startedAt) &&
      voiceRingState({
        startedAt,
        answeredAt: Number.isFinite(answeredAt) ? answeredAt : null,
        now,
      }) === "ringing"
    ) {
      continue;
    }
    // Archived rooms are excluded by the query, and again here: removing a room
    // sets `archived = true` rather than deleting it, so a stale read of an
    // archived room would otherwise announce a call in a room nobody can join.
    if (record.archived === true) continue;
    out.push({
      channelId,
      chatId,
      name: (typeof record.name === "string" ? record.name : "").trim() || "Голосовой канал",
      count: Math.floor(count),
    });
  }
  return out;
}

/**
 * One entry per chat, folded from its rooms.
 *
 * **The count is the total across rooms, not the busiest room's.** A group with
 * two people in «Общая» and three in «Планёрка» has five people talking in it,
 * and the row is answering «is anything happening here», not «which room». The
 * room's name is kept for the hover sentence, where there is space to be
 * specific, and the busiest one is the one named because it is the one somebody
 * looking for company would join.
 *
 * Ties are broken by name so the sentence cannot change between two reads that
 * say the same thing — the same rule `orderVoiceParticipants` applies to two
 * people with one name.
 */
export function chatVoicePresence(
  rooms: readonly VoiceRoomPresence[],
): Map<string, ChatVoicePresence> {
  const busiest = new Map<string, VoiceRoomPresence>();
  const totals = new Map<string, { count: number; rooms: number }>();

  for (const room of rooms) {
    const running = totals.get(room.chatId) ?? { count: 0, rooms: 0 };
    totals.set(room.chatId, { count: running.count + room.count, rooms: running.rooms + 1 });

    const held = busiest.get(room.chatId);
    if (
      !held ||
      room.count > held.count ||
      (room.count === held.count && room.name.localeCompare(held.name, "ru") < 0)
    ) {
      busiest.set(room.chatId, room);
    }
  }

  const out = new Map<string, ChatVoicePresence>();
  for (const [chatId, total] of totals) {
    const room = busiest.get(chatId);
    if (!room) continue;
    out.set(chatId, { count: total.count, rooms: total.rooms, name: room.name });
  }
  return out;
}

/**
 * The hover sentence, which is where the specifics go.
 *
 * The mark itself is a glyph and a number, because a chat row has room for
 * about that much. Everything else — which room, and whether there is more than
 * one — belongs here, and «ещё N» rather than a list because a group with six
 * occupied rooms would otherwise put a paragraph in a tooltip.
 */
export function voicePresenceTitle(presence: ChatVoicePresence): string {
  const people = `${presence.count} ${peopleWord(presence.count)}`;
  if (presence.rooms <= 1) return `${people} в «${presence.name}»`;
  const others = presence.rooms - 1;
  return `${people} в «${presence.name}» и ещё в ${others} ${roomsWord(others)}`;
}

/**
 * Russian plural agreement, for the two words this module needs.
 *
 * Written out rather than taken from `Intl.PluralRules`, because the shape is
 * the ordinary three-form rule and a formatter would be a dependency in a
 * module whose whole point is importing nothing.
 *
 * **11 to 14 are the trap, and they are the reason this is a function rather
 * than a ternary.** They take the many-form against what their last digit would
 * say: «11 человек», not «11 человека»; «12 человек», not «12 человека». The
 * first version of this had every branch returning «человек» — correct for 1,
 * 5 and 11, and wrong for every 2, 3 and 4 in the language — which is exactly
 * the mistake `tests/unit/voice-presence.test.mjs` walks 1 to 125 to catch.
 */
function peopleWord(count: number): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return "человек";
  const mod10 = count % 10;
  if (mod10 === 1) return "человек";
  if (mod10 >= 2 && mod10 <= 4) return "человека";
  return "человек";
}

/** «в 1 канале», «в 2 каналах», «в 11 каналах» — the prepositional case. */
function roomsWord(count: number): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return "каналах";
  return count % 10 === 1 ? "канале" : "каналах";
}

/**
 * The next answer, sharing everything that did not change.
 *
 * This is the whole of the chat list's render-cost promise, and it is here
 * rather than in the hook because a rule inside a `"use client"` module is a
 * rule with no test — `voiceChannel.ts` records why at its own head.
 *
 * `useSyncExternalStore` compares snapshots with `Object.is`, and a row
 * subscribes to **its own** entry. The read rebuilds every entry from rows, so
 * without this each entry would be a new object on every event and every row
 * with a call in it would render whenever anybody anywhere joined or left one.
 * `useVoiceSpeaking` was measured at 190 face renders for 10 speaker changes
 * before it became a primitive per person; this is the same fix applied to a
 * map.
 *
 * Two guarantees, and the test pins both:
 *
 *  - when nothing changed at all, **the held map itself** comes back, so the
 *    store can skip notifying its listeners entirely;
 *  - when one conversation's call changed, every other conversation's entry is
 *    the same object it was, so only that one row renders.
 */
export function mergeVoicePresence(
  held: ReadonlyMap<string, ChatVoicePresence>,
  next: ReadonlyMap<string, ChatVoicePresence>,
): ReadonlyMap<string, ChatVoicePresence> {
  const merged = new Map<string, ChatVoicePresence>();
  // A size change is a change even when every surviving entry matches: a call
  // that ended leaves the others untouched and must still reach the list.
  let changed = next.size !== held.size;
  for (const [chatId, entry] of next) {
    const before = held.get(chatId);
    if (
      before &&
      before.count === entry.count &&
      before.rooms === entry.rooms &&
      before.name === entry.name
    ) {
      merged.set(chatId, before);
    } else {
      merged.set(chatId, entry);
      changed = true;
    }
  }
  return changed ? merged : held;
}
