import assert from "node:assert/strict";
import test from "node:test";

import {
  NO_PROFILE_CHAT_CONTEXT,
  profileChatContext,
  profileContextHasStanding,
  type ProfileContextChat,
} from "../../artifacts/kub/src/lib/profileChatContext.ts";

/**
 * What a person's card may say about the place it was opened from.
 *
 * Discord keys its profile on `(userId, guildId)` rather than on a person, and
 * this is the second half of that pair. It is not decoration: measured at 1440
 * on 2026-09-21, before it existed, the compact card was **450 px** tall and
 * the full card **446** — the summary taller than the thing it summarised,
 * because outside a conversation the full card had nothing of its own to say.
 */

const ANNA = "u-anna";

function group(role: string | null, type: "group" | "channel" | "private" = "group"): ProfileContextChat {
  return {
    id: "c1",
    type,
    members: role === null ? [] : [{ user_id: ANNA, role, joined_at: "2026-09-03T10:00:00.000Z" }],
  };
}

test("a group reports the standing and the join date", () => {
  assert.deepEqual(profileChatContext(group("admin"), ANNA), {
    standing: "admin",
    joinedAt: "2026-09-03T10:00:00.000Z",
    channel: false,
  });
});

test("a channel is a place too, with its own word", () => {
  const context = profileChatContext(group("owner", "channel"), ANNA);
  assert.equal(context.standing, "owner");
  assert.equal(context.channel, true);
});

test("an ordinary member is a standing, and the label decides what to draw", () => {
  // `chatRoleLabel("member", …)` answers "" and the card draws nothing for it,
  // so «Участник» is never printed as though it were a title. The join date
  // still is, which is the fact worth having.
  const context = profileChatContext(group("member"), ANNA);
  assert.equal(context.standing, "member");
  assert.equal(context.joinedAt, "2026-09-03T10:00:00.000Z");
});

test("a private conversation reports nothing at all", () => {
  // Whoever opens a private chat becomes its owner — the whole subject of
  // `20260911120000_private_chat_owner_delete_repair.sql` — so «Владелец» there
  // is an artefact of who pressed first, not a fact about a person. D-283 wrote
  // this refusal down; it is now a rule rather than a consequence of the
  // overlay knowing no chat.
  assert.deepEqual(profileChatContext(group("owner", "private"), ANNA), NO_PROFILE_CHAT_CONTEXT);
});

test("no chat and no person are both nothing", () => {
  assert.deepEqual(profileChatContext(null, ANNA), NO_PROFILE_CHAT_CONTEXT);
  assert.deepEqual(profileChatContext(undefined, ANNA), NO_PROFILE_CHAT_CONTEXT);
  assert.deepEqual(profileChatContext(group("owner"), null), NO_PROFILE_CHAT_CONTEXT);
  assert.deepEqual(profileChatContext(group("owner"), undefined), NO_PROFILE_CHAT_CONTEXT);
});

test("a person absent from the copy we hold gets no invented standing", () => {
  // The chat is still a group, so the vocabulary is known; the standing is not.
  // «Участник» by default would be a claim nobody checked.
  const context = profileChatContext(group(null), ANNA);
  assert.equal(context.standing, null);
  assert.equal(context.joinedAt, null);
  assert.equal(context.channel, false);
  assert.equal(profileContextHasStanding(context), false);
});

test("a member row with a role nobody recognises is a member, not a title", () => {
  const context = profileChatContext(group("moderator"), ANNA);
  assert.equal(context.standing, "member");
});

test("a chat with no members array at all is safe", () => {
  assert.deepEqual(profileChatContext({ id: "c1", type: "group" }, ANNA), {
    standing: null,
    joinedAt: null,
    channel: false,
  });
});

test("the standing predicate answers for what it is asked", () => {
  assert.equal(profileContextHasStanding(profileChatContext(group("owner"), ANNA)), true);
  assert.equal(profileContextHasStanding(NO_PROFILE_CHAT_CONTEXT), false);
});
