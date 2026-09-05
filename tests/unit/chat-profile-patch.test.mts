import assert from "node:assert/strict";
import test from "node:test";

import { applyProfileToChats } from "../../artifacts/kub/src/lib/chatProfilePatch.ts";
import { sameChatList } from "../../artifacts/kub/src/lib/chatListChange.ts";
import { getUserPresenceState } from "../../artifacts/kub/src/lib/presence.ts";

const PEER = "1532baab-41d9-480e-96a7-3260c99ececd";
const OTHER = "9d4a5c31-0b1e-4f77-9a52-2f0c5a7ee111";
const STALE = "2026-09-05T10:00:00.000Z";
const FRESH = "2026-09-05T10:05:00.000Z";

function chat(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    name: "Собеседник",
    unread_count: 0,
    other_user: { id: PEER, full_name: "Собеседник", online_at: STALE },
    members: [
      { user_id: PEER, role: "member", last_read_at: null, profile: { id: PEER, online_at: STALE } },
      { user_id: OTHER, role: "member", last_read_at: null, profile: { id: OTHER, online_at: STALE } },
    ],
    ...overrides,
  };
}

test("refreshes the peer's presence on the chat the header reads", () => {
  const before = [chat()];
  const after = applyProfileToChats(before, { id: PEER, online_at: FRESH });

  assert.ok(after, "a chat referencing this profile must be patched");
  assert.equal(after[0].other_user.online_at, FRESH);
  assert.equal(after[0].members[0].profile.online_at, FRESH);
  // The member who did not move must be left exactly alone.
  assert.equal(after[0].members[1].profile.online_at, STALE);
  assert.equal(after[0].members[1], before[0].members[1]);
});

test("keeps fields the realtime row does not carry", () => {
  const after = applyProfileToChats([chat()], { id: PEER, online_at: FRESH });
  assert.ok(after);
  assert.equal(after[0].other_user.full_name, "Собеседник");
  assert.equal(after[0].name, "Собеседник");
  assert.equal(after[0].unread_count, 0);
  assert.equal(after[0].members[0].role, "member");
});

/**
 * The reason this returns `null` instead of an equal array.
 *
 * The handler feeding it is subscribed to every `profiles` UPDATE the client can
 * see, so it runs once a minute for every heartbeat in the system and almost
 * none of those belong to anyone in this list. Returning a fresh array each time
 * would push a store write per stranger's heartbeat.
 */
test("returns null when the profile belongs to nobody in the list", () => {
  assert.equal(applyProfileToChats([chat()], { id: "someone-else", online_at: FRESH }), null);
});

test("returns null for a row with no id, rather than patching everything", () => {
  assert.equal(applyProfileToChats([chat()], { online_at: FRESH }), null);
  assert.equal(applyProfileToChats([chat()], { id: null, online_at: FRESH }), null);
  assert.equal(applyProfileToChats([chat()], null), null);
  assert.equal(applyProfileToChats([chat()], undefined), null);
});

test("leaves untouched chats identical by reference", () => {
  const mine = chat();
  const theirs = chat({ id: "c2", other_user: { id: OTHER, online_at: STALE }, members: [] });
  const after = applyProfileToChats([mine, theirs], { id: PEER, online_at: FRESH });
  assert.ok(after);
  assert.notEqual(after[0], mine, "the matching chat is replaced");
  assert.equal(after[1], theirs, "a chat with no reference to the profile is reused");
});

test("patches a chat that has members but no other_user", () => {
  const group = chat({ other_user: null });
  const after = applyProfileToChats([group], { id: PEER, online_at: FRESH });
  assert.ok(after, "a group chat still carries the member's presence");
  assert.equal(after[0].members[0].profile.online_at, FRESH);
  assert.equal(after[0].other_user, null);
});

test("patches other_user when the chat carries no members array", () => {
  const bare = chat({ members: undefined });
  const after = applyProfileToChats([bare], { id: PEER, online_at: FRESH });
  assert.ok(after);
  assert.equal(after[0].other_user.online_at, FRESH);
});

test("an empty list yields null", () => {
  assert.equal(applyProfileToChats([], { id: PEER, online_at: FRESH }), null);
});

/**
 * The end the user actually sees.
 *
 * A patch that `sameChatList` judges identical is discarded by `setChats`, so
 * the two have to be checked together: the whole outage was a fresh presence
 * value arriving and being thrown away. And the value has to cross the
 * threshold that decides the Russian label, not merely differ.
 */
test("the patched list is not judged identical, and reads as online again", () => {
  const now = new Date(FRESH).getTime();
  const before = [chat()];
  const after = applyProfileToChats(before, { id: PEER, online_at: FRESH });
  assert.ok(after);

  assert.equal(
    sameChatList(before, after),
    false,
    "setChats would discard a patch the comparison calls identical",
  );
  assert.equal(getUserPresenceState(before[0].other_user, now).label, "был(а) 5 мин назад");
  assert.equal(getUserPresenceState(after[0].other_user, now).label, "в сети");
  assert.equal(getUserPresenceState(after[0].other_user, now).isOnline, true);
});
