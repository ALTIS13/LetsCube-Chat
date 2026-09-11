import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  chatMemberSignature,
  sameChat,
  sameChatList,
  shareChatList,
  type ChatSnapshot,
} from "../../artifacts/kub/src/lib/chatListChange.ts";
import { getUserPresenceState, USER_ONLINE_THRESHOLD_MS } from "../../artifacts/kub/src/lib/presence.ts";

const PEER = "1532baab-41d9-480e-96a7-3260c99ececd";
const FRESH = "2026-09-04T18:00:00Z";

function chat(overrides: Partial<ChatSnapshot> = {}): ChatSnapshot {
  return {
    id: "c1",
    name: "Собеседник",
    unread_count: 0,
    last_message: { id: "m1", created_at: "2026-09-04T18:00:00Z" },
    members: [
      { user_id: PEER, role: "member", last_read_at: null, profile: { online_at: "2026-09-04T18:00:00Z" } },
    ],
    other_user: { online_at: "2026-09-04T18:00:00Z" },
    ...overrides,
  };
}

function withPresence(at: string): ChatSnapshot {
  return chat({
    members: [{ user_id: PEER, role: "member", last_read_at: null, profile: { online_at: at } }],
    other_user: { online_at: at },
  });
}

test("the reported bug: a refetch carrying only fresh presence is not discarded", () => {
  // `setChats` returns the previous state when this says "same", throwing the
  // fetched rows away. The old signature covered `last_read_at` but not
  // `online_at`, so returning to a backgrounded tab showed the peer's read
  // receipt updating while their "был(а) N минут назад" kept counting up from a
  // timestamp 38 minutes stale — until the page was reloaded.
  const before = withPresence("2026-09-04T18:00:00Z");
  const after = withPresence("2026-09-04T18:38:00Z");
  assert.equal(sameChat(before, after), false, "the fresh presence would be discarded");
  assert.equal(sameChatList([before], [after]), false);
});

test("a read receipt is still noticed", () => {
  // The half that always worked, kept honest.
  const before = chat();
  const after = chat({
    members: [
      {
        user_id: PEER,
        role: "member",
        last_read_at: "2026-09-04T18:39:00Z",
        profile: { online_at: "2026-09-04T18:00:00Z" },
      },
    ],
  });
  assert.equal(sameChat(before, after), false);
});

test("presence is compared finely enough to survive the online threshold", () => {
  // A coarser comparison would be cheaper. It would also be wrong: anything
  // wide enough to be worth having can hold someone at «в сети» after they have
  // gone. This pins the two states either side of the threshold as different.
  const now = Date.parse("2026-09-04T18:00:00Z");
  const online = new Date(now - USER_ONLINE_THRESHOLD_MS + 5_000).toISOString();
  const offline = new Date(now - USER_ONLINE_THRESHOLD_MS - 5_000).toISOString();
  assert.equal(getUserPresenceState({ online_at: online }, now).isOnline, true);
  assert.equal(getUserPresenceState({ online_at: offline }, now).isOnline, false);
  assert.equal(sameChat(withPresence(online), withPresence(offline)), false, "«в сети» and «был(а)» compare equal");
});

test("the header's own field is compared, not only the members array", () => {
  // `ChatHeader` reads `chat.other_user`. A private chat whose peer went online
  // must not be judged unchanged because `members` happened to agree.
  const before = chat({ other_user: { online_at: "2026-09-04T18:00:00Z" } });
  const after = chat({ other_user: { online_at: "2026-09-04T18:38:00Z" } });
  assert.equal(sameChat(before, after), false);
});

test("an identical list is still identical", () => {
  // The filter exists for a reason: without it every poll replaces the array
  // and re-renders the sidebar.
  assert.equal(sameChatList([chat()], [chat()]), true);
  assert.equal(sameChatList([], []), true);
});

test("member order from the server is not a change", () => {
  const a = chat({
    members: [
      { user_id: "a", profile: { online_at: "2026-09-04T18:00:00Z" } },
      { user_id: "b", profile: { online_at: "2026-09-04T18:01:00Z" } },
    ],
  });
  const b = chat({
    members: [
      { user_id: "b", profile: { online_at: "2026-09-04T18:01:00Z" } },
      { user_id: "a", profile: { online_at: "2026-09-04T18:00:00Z" } },
    ],
  });
  assert.equal(sameChat(a, b), true);
});

test("a member signature carries presence", () => {
  const quiet = chatMemberSignature({ user_id: PEER, profile: { online_at: "2026-09-04T18:00:00Z" } });
  const fresh = chatMemberSignature({ user_id: PEER, profile: { online_at: "2026-09-04T18:38:00Z" } });
  assert.notEqual(quiet, fresh);
  // A member with no profile must not throw or collide with one that has none.
  assert.equal(chatMemberSignature({ user_id: PEER }), chatMemberSignature({ user_id: PEER, profile: null }));
});

test("a shorter or longer list is a change", () => {
  assert.equal(sameChatList([chat()], []), false);
  assert.equal(sameChatList([], [chat()]), false);
});

test("a fetch that changes one chat keeps every other chat's object", () => {
  // D-088: taking the fetched list whole rendered every row for one change.
  const previous = [chat({ id: "a" }), chat({ id: "b" }), chat({ id: "c" })];
  const fetched = [chat({ id: "a" }), chat({ id: "b", unread_count: 3 }), chat({ id: "c" })];
  const kept = shareChatList(previous, fetched);
  assert.notEqual(kept, previous);
  assert.equal(kept[0], previous[0]);
  assert.equal(kept[1], fetched[1]);
  assert.equal(kept[2], previous[2]);
  assert.equal(shareChatList(previous, [chat({ id: "a" }), chat({ id: "b" }), chat({ id: "c" })]), previous);
});

test("a field the signature does not name still counts as a change", () => {
  // The presence bug in general form: the store no longer judges a row by a
  // list of fields, so a field outside the list cannot be thrown away.
  const previous = [chat({ id: "a", other_user: { online_at: FRESH, avatar_url: "old.webp" } as ChatSnapshot["other_user"] })];
  const fetched = [chat({ id: "a", other_user: { online_at: FRESH, avatar_url: "new.webp" } as ChatSnapshot["other_user"] })];
  assert.equal(sameChatList(previous, fetched), true, "the signature cannot see an avatar");
  assert.equal(shareChatList(previous, fetched)[0], fetched[0], "but the store must take it");
});

test("the store defers to this module rather than keeping its own copy", () => {
  // The bug was a hand-maintained field list drifting from what is rendered.
  // One copy, and it is this one — and since D-088 it compares all the data.
  const store = readFileSync("artifacts/kub/src/store/app.store.ts", "utf8");
  assert.match(store, /import \{ shareChatList \} from '@\/lib\/chatListChange'/);
  assert.match(store, /shareChatList\(state\.chats, chats\)/, "setChats no longer keeps unchanged chats");
  assert.ok(
    !/function sameChatList\(/.test(store),
    "app.store.ts has grown its own chat comparison again",
  );
  assert.ok(
    !/chatMemberReceiptSignature/.test(store),
    "the receipts-only signature is back in the store",
  );
});
