// How a group's channels are arranged, and who may do what with them.
//
// The rules mirror the database, read off production on 2026-09-14:
//   is_chat_admin(cid)  ->  role in ('owner', 'admin')
//   voice_channels.speak_role :: chat_member_role = owner | admin | member
//   topics.category_id / voice_channels.category_id -> a composite foreign key
//     on (chat_id, category_id) with `on delete set null (category_id)`
//
// Every row below is invented. Nothing here was read off production.
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChannelTree,
  canManageChannels,
  canSpeakInChannel,
  channelNameRemaining,
  CHANNEL_NAME_MAX,
  CHAT_ROLE_RANK,
  flattenChannelTree,
  nextPosition,
  normalizeChannelName,
  reorderPositions,
  voiceJoinVerdict,
  type ChannelCategory,
  type ServerChannel,
} from "../../artifacts/kub/src/lib/serverChannels.ts";

const category = (id: string, name: string, position: number, createdAt = "2026-09-14T09:00:00.000Z"): ChannelCategory =>
  ({ id, name, position, createdAt });

const text = (id: string, name: string, position: number, categoryId: string | null = null): ServerChannel =>
  ({ id, kind: "text", name, position, categoryId, createdAt: "2026-09-14T09:00:00.000Z" });

const voice = (
  id: string,
  name: string,
  position: number,
  categoryId: string | null = null,
  extra: Partial<ServerChannel> = {},
): ServerChannel => ({
  id,
  kind: "voice",
  name,
  position,
  categoryId,
  createdAt: "2026-09-14T09:00:00.000Z",
  maxParticipants: 10,
  speakRole: "member",
  participantCount: 0,
  ...extra,
});

// ── the rail's order ────────────────────────────────────────────────────────

test("uncategorised channels stand above the first heading", () => {
  // Not a preference. Deleting a heading nulls only `category_id`, so its rooms
  // land here — and a rail that put them last, or dropped them, would make
  // removing a heading look like removing the rooms under it.
  const tree = buildChannelTree({
    categories: [category("c1", "Общение", 0)],
    channels: [text("t1", "общий", 0, "c1"), voice("v1", "Голос", 0, null)],
  });
  assert.deepEqual(tree.map((group) => group.category?.name ?? null), [null, "Общение"]);
  assert.deepEqual(tree[0].channels.map((channel) => channel.id), ["v1"]);
});

test("a category nothing resolves is no category, not a lost channel", () => {
  // The state between two reads: the heading is gone, the channel still names
  // it. Dropping the channel here would hide a room from everybody in the group.
  const tree = buildChannelTree({
    categories: [],
    channels: [text("t1", "общий", 0, "deleted-heading")],
  });
  assert.equal(tree.length, 1);
  assert.equal(tree[0].category, null);
  assert.deepEqual(tree[0].channels.map((c) => c.id), ["t1"]);
});

test("text comes before voice inside a group, then position", () => {
  // The two kinds are separate tables with separate position sequences, so
  // ordering by position alone would interleave them by an accident of which
  // table counted first.
  const tree = buildChannelTree({
    categories: [category("c1", "Общение", 0)],
    channels: [
      voice("v1", "Голос", 0, "c1"),
      text("t2", "второй", 1, "c1"),
      text("t1", "первый", 0, "c1"),
      voice("v2", "Второй голос", 1, "c1"),
    ],
  });
  assert.deepEqual(tree[0].channels.map((c) => c.id), ["t1", "t2", "v1", "v2"]);
});

test("an empty heading is kept and an empty uncategorised group is not", () => {
  // A heading somebody made a moment ago and has not filled is a thing they are
  // in the middle of doing; a rail that hides it looks broken. An empty
  // uncategorised group is nothing at all and would draw a blank gap.
  const tree = buildChannelTree({
    categories: [category("c1", "Пусто", 0)],
    channels: [text("t1", "общий", 0, "c1")],
  });
  assert.deepEqual(tree.map((g) => g.category?.id ?? null), ["c1"]);

  const withEmptyHeading = buildChannelTree({
    categories: [category("c1", "Пусто", 0), category("c2", "Тоже пусто", 1)],
    channels: [text("t1", "общий", 0, "c1")],
  });
  assert.deepEqual(withEmptyHeading.map((g) => g.category?.id ?? null), ["c1", "c2"]);
  assert.deepEqual(withEmptyHeading[1].channels, []);
});

test("headings are ordered by position, and ties break the same way twice", () => {
  const tree = buildChannelTree({
    categories: [
      category("b", "Б", 5, "2026-09-14T10:00:00.000Z"),
      category("a", "А", 5, "2026-09-14T09:00:00.000Z"),
      category("z", "Я", 1),
    ],
    channels: [],
  });
  assert.deepEqual(tree.map((g) => g.category?.id), ["z", "a", "b"]);
});

test("an archived channel is not on the rail", () => {
  const tree = buildChannelTree({
    categories: [],
    channels: [
      { ...text("t1", "живой", 0) },
      { ...text("t2", "в архиве", 1), archived: true } as ServerChannel,
    ],
  });
  assert.deepEqual(flattenChannelTree(tree).map((c) => c.id), ["t1"]);
});

// ── who may do what ─────────────────────────────────────────────────────────

test("managing channels is exactly is_chat_admin and nothing wider", () => {
  assert.equal(canManageChannels("owner"), true);
  assert.equal(canManageChannels("admin"), true);
  assert.equal(canManageChannels("member"), false);
  assert.equal(canManageChannels(null), false);
  assert.equal(canManageChannels(""), false);
  // A permission is not a role — the same distinction `lib/moderationAccess.ts`
  // exists to keep. `chats.moderate` makes somebody staff in the client and
  // nothing at all to `is_chat_admin`.
  assert.equal(canManageChannels("chats.moderate"), false);
  assert.deepEqual([...CHAT_ROLE_RANK], ["member", "admin", "owner"]);
});

test("speaking is decided by the room's own speak_role", () => {
  const everyone = voice("v", "Все", 0, null, { speakRole: "member" });
  const staffOnly = voice("v", "Штаб", 0, null, { speakRole: "admin" });
  const ownerOnly = voice("v", "Эфир", 0, null, { speakRole: "owner" });

  assert.equal(canSpeakInChannel(everyone, "member"), true);
  assert.equal(canSpeakInChannel(staffOnly, "member"), false);
  assert.equal(canSpeakInChannel(staffOnly, "admin"), true);
  assert.equal(canSpeakInChannel(ownerOnly, "admin"), false);
  assert.equal(canSpeakInChannel(ownerOnly, "owner"), true);
  // A room with no rule recorded lets everybody speak, which is the column's
  // own default.
  assert.equal(canSpeakInChannel({ speakRole: null }, "member"), true);
});

test("«полно» and «слушать можно, говорить нельзя» are different answers", () => {
  // Collapsing them into one refusal is how a room nobody may speak in gets
  // mistaken for a room nobody may enter.
  const full = voice("v", "Полно", 0, null, { maxParticipants: 4, participantCount: 4 });
  assert.equal(voiceJoinVerdict({ channel: full, role: "member" }), "full");
  // Somebody already inside is not taking a new seat.
  assert.equal(voiceJoinVerdict({ channel: full, role: "member", alreadyInside: true }), "ok");

  const listen = voice("v", "Штаб", 0, null, { speakRole: "admin", participantCount: 1 });
  assert.equal(voiceJoinVerdict({ channel: listen, role: "member" }), "listen-only");
  assert.equal(voiceJoinVerdict({ channel: listen, role: "admin" }), "ok");

  assert.equal(voiceJoinVerdict({ channel: listen, role: null }), "not-a-member");
  // No limit recorded is no limit, not a limit of zero.
  const unlimited = voice("v", "Без предела", 0, null, { maxParticipants: 0, participantCount: 99 });
  assert.equal(voiceJoinVerdict({ channel: unlimited, role: "member" }), "ok");
});

// ── names ───────────────────────────────────────────────────────────────────

test("a name is trimmed, collapsed and cut by code point", () => {
  assert.equal(normalizeChannelName("  Общий   чат  "), "Общий чат");
  assert.equal(normalizeChannelName("   "), null);
  assert.equal(normalizeChannelName(null), null);
  assert.equal(normalizeChannelName(undefined), null);

  // `char_length` in Postgres counts characters; `String.length` counts UTF-16
  // code units and an emoji costs two. A cut by `.slice()` would hand the
  // constraint a name of 64 characters that measures 64 and a name of 33
  // emoji that measures 33 — and would cut a surrogate pair in half.
  const emoji = "🧊".repeat(CHANNEL_NAME_MAX + 10);
  const cut = normalizeChannelName(emoji) ?? "";
  assert.equal(Array.from(cut).length, CHANNEL_NAME_MAX);
  assert.ok(cut.length > CHANNEL_NAME_MAX, "the cut was made in code units rather than characters");
  assert.equal(Array.from(cut).every((point) => point === "🧊"), true, "a pair was cut in half");

  assert.equal(channelNameRemaining(""), CHANNEL_NAME_MAX);
  assert.equal(channelNameRemaining("🧊🧊"), CHANNEL_NAME_MAX - 2);
});

test("a name is not silently rewritten into a slug", () => {
  // Discord lowercases and hyphenates text channel names. This product names
  // everything else in ordinary Russian sentence case, and a field that
  // rewrites what somebody typed is a field they stop trusting.
  assert.equal(normalizeChannelName("Общий Чат"), "Общий Чат");
  assert.equal(normalizeChannelName("Общий Чат")?.includes("-"), false);
});

// ── positions ───────────────────────────────────────────────────────────────

test("a new row goes one past the last, not at the count", () => {
  // Positions are not contiguous: after a removal the count collides with a row
  // that is still there, and a list whose order depends on a tie-break reorders
  // itself when two rows are made in the same millisecond.
  assert.equal(nextPosition([{ position: 0 }, { position: 5 }, { position: 2 }]), 6);
  assert.equal(nextPosition([]), 0);
  // And it never answers with a negative position, whatever it was handed. The
  // column is `integer not null default 0` and everything written by this
  // product counts from zero, so a row below zero is data nobody meant; the
  // answer is still a place at the end of the list rather than a second
  // oddity beside the first.
  assert.equal(nextPosition([{ position: -3 }]), 0);
  // A value that is not a number at all is ignored rather than poisoning the
  // arithmetic into NaN, which would write a null and drop the row to the top.
  assert.equal(nextPosition([{ position: Number.NaN }, { position: 2 }]), 3);
});

test("a move renumbers the run and writes only what changed", () => {
  const rows = [
    { id: "a", position: 0 },
    { id: "b", position: 1 },
    { id: "c", position: 2 },
  ];
  assert.deepEqual(reorderPositions(rows, "c", 0), [
    { id: "c", position: 0 },
    { id: "a", position: 1 },
    { id: "b", position: 2 },
  ]);
  // A drag that lands where it started writes nothing at all.
  assert.deepEqual(reorderPositions(rows, "b", 1), []);
  // An index past either end lands at the end it was dragged towards.
  assert.deepEqual(reorderPositions(rows, "a", 99).at(-1), { id: "a", position: 2 });
  assert.deepEqual(reorderPositions(rows, "c", -5).at(0), { id: "c", position: 0 });
  // A row that is not in the list moves nothing.
  assert.deepEqual(reorderPositions(rows, "missing", 0), []);
});

test("only the rows that actually move are written", () => {
  // A short drag near the end of a long rail must not rewrite the whole rail.
  // Every write is a request that can be refused on its own, and a list of
  // twenty channels reordered by one place would otherwise send twenty.
  const rows = [
    { id: "a", position: 0 },
    { id: "b", position: 1 },
    { id: "c", position: 2 },
    { id: "d", position: 3 },
  ];
  assert.deepEqual(reorderPositions(rows, "d", 2), [
    { id: "d", position: 2 },
    { id: "c", position: 3 },
  ]);
});

test("a run that was already out of step is renumbered from zero", () => {
  // Positions drift after enough removals. Nudging would preserve the drift;
  // renumbering the whole run is what keeps the list from ending up at numbers
  // no human would choose.
  const drifted = [
    { id: "a", position: 3 },
    { id: "b", position: 9 },
    { id: "c", position: 40 },
  ];
  assert.deepEqual(reorderPositions(drifted, "c", 0), [
    { id: "c", position: 0 },
    { id: "a", position: 1 },
    { id: "b", position: 2 },
  ]);
});
