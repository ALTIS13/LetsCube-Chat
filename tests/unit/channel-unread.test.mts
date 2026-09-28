import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERAL_CHANNEL_KEY,
  channelKeyForTopic,
  channelReadKey,
  channelToBump,
  readUnreadCounts,
  unreadBadgeLabel,
} from "../../artifacts/kub/src/lib/channelUnread.ts";

// Tracker item 54, the unread half: each channel of a server carries its own
// count, keyed as `20260929090000_channel_reads.sql` keys it.

const ME = "11111111-1111-4111-8111-000000000001";
const ANNA = "11111111-1111-4111-8111-000000000002";
const GENERAL_TOPIC = "44444444-4444-4444-8444-000000000001";
const CHECKS = "44444444-4444-4444-8444-000000000002";

test("the general channel is «general» whether it is a topic row or the rail's own", () => {
  assert.equal(channelReadKey({ id: GENERAL_TOPIC, isGeneral: true }), GENERAL_CHANNEL_KEY);
  assert.equal(channelReadKey({ id: "general" }), GENERAL_CHANNEL_KEY);
  assert.equal(channelReadKey({ id: CHECKS, isGeneral: false }), CHECKS);
});

test("a message is counted under its topic, or under «general» when it has none or the general one", () => {
  assert.equal(channelKeyForTopic(null, [GENERAL_TOPIC]), GENERAL_CHANNEL_KEY);
  assert.equal(channelKeyForTopic(undefined, []), GENERAL_CHANNEL_KEY);
  assert.equal(channelKeyForTopic(GENERAL_TOPIC, [GENERAL_TOPIC]), GENERAL_CHANNEL_KEY);
  assert.equal(channelKeyForTopic(CHECKS, [GENERAL_TOPIC]), CHECKS);
});

test("the badge says nothing, the number, or «99+»", () => {
  for (const nothing of [0, -1, null, undefined, Number.NaN]) assert.equal(unreadBadgeLabel(nothing), null);
  assert.equal(unreadBadgeLabel(1), "1");
  assert.equal(unreadBadgeLabel(99), "99");
  assert.equal(unreadBadgeLabel(100), "99+");
});

test("the database's answer is read row by row, and anything else is no counts", () => {
  const counts = readUnreadCounts([
    { channel: "general", unread: 2 },
    { channel: CHECKS, unread: 5 },
    { channel: 3, unread: 1 },
    { channel: "x", unread: "7" },
    null,
  ]);
  assert.deepEqual([...counts.entries()], [["general", 2], [CHECKS, 5]]);
  assert.equal(readUnreadCounts({ message: "function not found" }).size, 0);
});

test("a message heard live adds to its channel unless it is the reader's, a notice, deleted, or where they are reading", () => {
  const anna = { user_id: ANNA, bot_id: null, topic_id: CHECKS, type: "text", deleted_at: null };
  assert.equal(channelToBump(anna, ME, GENERAL_CHANNEL_KEY, [GENERAL_TOPIC]), CHECKS);
  assert.equal(channelToBump(anna, ME, CHECKS, [GENERAL_TOPIC]), null, "the channel on screen counted");
  assert.equal(channelToBump({ ...anna, user_id: ME }, ME, GENERAL_CHANNEL_KEY, []), null, "the reader's own counted");
  assert.equal(channelToBump({ ...anna, type: "system", user_id: null }, ME, GENERAL_CHANNEL_KEY, []), null);
  assert.equal(channelToBump({ ...anna, deleted_at: "2026-09-29T09:00:00Z" }, ME, GENERAL_CHANNEL_KEY, []), null);
  // A bot writes without a user id and is still somebody else.
  assert.equal(channelToBump({ ...anna, user_id: null, bot_id: "b" }, ME, GENERAL_CHANNEL_KEY, []), CHECKS);
  assert.equal(channelToBump({ ...anna, topic_id: null }, ME, CHECKS, [GENERAL_TOPIC]), GENERAL_CHANNEL_KEY);
});
