import assert from "node:assert/strict";
import test from "node:test";

import {
  chatRowProfileTarget,
  offersProfileEntry,
  privateChatCounterpart,
} from "../../artifacts/kub/src/lib/chatRowProfile.ts";

/**
 * D-283. Whose profile a chat row opens.
 *
 * The decision was four lines inside `ChatList`'s `buildActions` closure, which
 * is why nothing could reach it: `if (isPrivate)` where `isPrivate` is
 * `chat.type === "private" && !isSaved`. Two things were wrong with it and only
 * one of them was the owner's complaint.
 *
 * The complaint is covered in `tests/e2e/profile-without-entering-chat.spec.ts`,
 * because «did a conversation open» is a fact about a browser. What is covered
 * here is the other one: **a bot conversation is `type === "private"`**, so the
 * old predicate offered «Открыть профиль» on a bot row, where there is no
 * person to open — `other_user` is null and the counterpart is a `bots` entry.
 *
 * Each case below is written so that removing the branch it names turns it red.
 * Proved by mutation on 2026-09-20: dropping the bot check, dropping the saved
 * check, dropping the `members` fallback and dropping the self comparison each
 * fail at least one case here.
 */

type Row = Record<string, unknown>;

const ME = "11111111-1111-4111-8111-000000000001";
const ANNA = "11111111-1111-4111-8111-000000000002";

function profile(id: string, fullName: string): Row {
  return { id, full_name: fullName, username: null, avatar_url: null, bio: null };
}

/** A private row as `useChats` projects one: the counterpart on `other_user`. */
function privateRow(otherId: string | null, extra: Row = {}): Row {
  return {
    id: "22222222-2222-4222-8222-000000000001",
    name: null,
    type: "private",
    description: null,
    created_by: ME,
    members: [{ user_id: ME, profile: profile(ME, "Максим Орлов") }],
    other_user: otherId ? profile(otherId, "Анна Смирнова") : null,
    bots: [],
    ...extra,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const target = (chat: Row, me: string | null = ME) => chatRowProfileTarget(chat as any, me);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const offers = (chat: Row, me: string | null = ME) => offersProfileEntry(chat as any, me);

test("a private conversation opens the other person", () => {
  assert.deepEqual(target(privateRow(ANNA)), { kind: "person", userId: ANNA });
  assert.equal(offers(privateRow(ANNA)), true);
});

test("the counterpart is found through members when the row carries no other_user", () => {
  const row = privateRow(null, {
    members: [
      { user_id: ME, profile: profile(ME, "Максим Орлов") },
      { user_id: ANNA, profile: profile(ANNA, "Анна Смирнова") },
    ],
  });
  assert.deepEqual(target(row), { kind: "person", userId: ANNA });
  assert.deepEqual(privateChatCounterpart(row as never, ME), profile(ANNA, "Анна Смирнова"));
});

test("a bot conversation offers nobody, even though its type is private", () => {
  // The whole reason this module exists. `chat.type` is "private" here, so the
  // predicate this replaced said yes.
  const row = privateRow(null, {
    bots: [{ id: "bot-1", name: "Langame", username: "langame" }],
    name: "Langame",
  });
  assert.equal(row.type, "private");
  assert.deepEqual(target(row), { kind: "none", reason: "bot" });
  assert.equal(offers(row), false);
});

test("a bot conversation is refused even if a counterpart profile is somehow present", () => {
  // Order matters: the bot check stands before the private branch, exactly as
  // `getChatDisplayInfo` orders its own. A row carrying both would otherwise
  // open a person's card for a bot.
  const row = privateRow(ANNA, { bots: [{ id: "bot-1", name: "Langame", username: "langame" }] });
  assert.deepEqual(target(row), { kind: "none", reason: "bot" });
});

test("«Избранное» opens nobody", () => {
  const saved: Row = {
    id: "22222222-2222-4222-8222-000000000009",
    name: "Избранное",
    type: "private",
    description: null,
    created_by: ME,
    members: [{ user_id: ME, profile: profile(ME, "Максим Орлов") }],
    other_user: null,
    bots: [],
  };
  assert.deepEqual(target(saved), { kind: "none", reason: "saved" });
  assert.equal(offers(saved), false);
});

test("a private row whose counterpart is yourself opens nobody", () => {
  // A conversation with oneself that is not named «Избранное» — the database
  // permits it, and a card of yourself with a disabled «Открыть чат» is the
  // inert control the material contract refuses.
  assert.deepEqual(target(privateRow(ME)), { kind: "none", reason: "saved" });
});

test("a group and a channel open nobody", () => {
  for (const type of ["group", "channel"]) {
    const row = privateRow(ANNA, { type, name: "Команда проекта" });
    assert.deepEqual(target(row), { kind: "none", reason: "group" }, type);
    assert.equal(offers(row), false, type);
  }
});

test("a private row with no readable counterpart offers nothing rather than an empty card", () => {
  const row = privateRow(null, { members: [{ user_id: ME, profile: profile(ME, "Максим Орлов") }] });
  assert.deepEqual(target(row), { kind: "none", reason: "unknown-person" });
  assert.equal(offers(row), false);
});

test("a member row without a profile is not mistaken for a person", () => {
  // `chat_members` joins `profiles`, and the join can answer null under
  // row-level security. An id with no profile behind it would open a card
  // nothing could fill.
  const row = privateRow(null, {
    members: [
      { user_id: ME, profile: profile(ME, "Максим Орлов") },
      { user_id: ANNA, profile: null },
    ],
  });
  assert.deepEqual(target(row), { kind: "none", reason: "unknown-person" });
});

test("a signed-out reader is not handed somebody at random", () => {
  // With no current user every member is «somebody else», so the first one
  // wins. It must still be a real person rather than the reader's own row —
  // there is no reader.
  const row = privateRow(ANNA);
  assert.deepEqual(target(row, null), { kind: "person", userId: ANNA });
});
