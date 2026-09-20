import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  messageAuthorOpensProfile,
  messageAuthorProfileTarget,
} from "../../artifacts/kub/src/lib/messageAuthorProfile.ts";
import type { MessageActor } from "../../artifacts/kub/src/lib/messageActor.ts";
import type { BotProfile, Profile } from "../../artifacts/kub/src/types/database.ts";

/**
 * Whose profile a message's face and name open.
 *
 * The opener this exists for is Discord's commonest: §15.1 enumerated the
 * importers of its popout wrapper (module 342296) and the list starts with a
 * message author's avatar and a message author's username, as two separate
 * anchors. Ours drew both in inert elements.
 *
 * The refusals are §8's rule — a control that cannot work is absent, not inert
 * — and each of them names a real actor kind `resolveMessageActor` can produce.
 */

const PERSON = { id: "u1", full_name: "Анна" } as unknown as Profile;
const BOT = { id: "b1", display_name: "Langame", username: "langame", state: "active" } as unknown as BotProfile;

test("a person's face opens that person", () => {
  const actor: MessageActor = { kind: "user", id: "u1", profile: PERSON };
  assert.deepEqual(messageAuthorProfileTarget(actor), { kind: "person", userId: "u1" });
  assert.equal(messageAuthorOpensProfile(actor), true);
});

test("your own messages open your own card", () => {
  // Not a refusal. Hiding it would make the conversation inconsistent for
  // exactly one reader; the card refuses «Открыть чат» and keeps the rest,
  // which is the rule `MemberCard` already states.
  const actor: MessageActor = { kind: "user", id: "me", profile: { ...PERSON, id: "me" } as Profile };
  assert.deepEqual(messageAuthorProfileTarget(actor), { kind: "person", userId: "me" });
});

test("a bot's face opens nothing, and that is D-263's to change", () => {
  const actor: MessageActor = { kind: "bot", id: "b1", bot: BOT };
  assert.deepEqual(messageAuthorProfileTarget(actor), { kind: "none", reason: "bot" });
  assert.equal(messageAuthorOpensProfile(actor), false);
});

test("a deleted author has no row to read", () => {
  assert.deepEqual(messageAuthorProfileTarget({ kind: "deleted_bot", id: "b2" }), {
    kind: "none",
    reason: "deleted",
  });
  assert.deepEqual(messageAuthorProfileTarget({ kind: "deleted_user" }), {
    kind: "none",
    reason: "deleted",
  });
});

test("nobody wrote a system message", () => {
  assert.deepEqual(messageAuthorProfileTarget({ kind: "system" }), {
    kind: "none",
    reason: "system",
  });
});

test("an actor that could not be resolved is not guessed at", () => {
  // `resolveMessageActor` answers `invalid` for a row carrying both a `user_id`
  // and a `bot_id`, and for a `sender` that is not the `user_id`. Drawing a
  // card from either would be inventing a person.
  assert.deepEqual(messageAuthorProfileTarget({ kind: "invalid" }), {
    kind: "none",
    reason: "invalid",
  });
  assert.equal(messageAuthorOpensProfile({ kind: "invalid" }), false);
});

/**
 * The wiring, scanned rather than described.
 *
 * The decision above is worthless if the bubble still draws an inert element,
 * and worse than worthless if it draws a pressable one for an actor this module
 * refused.
 */
const BUBBLE = readFileSync(
  new URL("../../artifacts/kub/src/components/chat/MessageBubble.tsx", import.meta.url),
  "utf8",
);

test("the bubble asks this module and opens the profile as a glance", () => {
  assert.ok(BUBBLE.includes("messageAuthorProfileTarget"));
  // «glance», because the person is incidental to the message being read. The
  // surface that answers is `resolveProfileTier`'s business, not the bubble's.
  assert.match(BUBBLE, /openUserProfile\(authorProfileUserId, "glance",/);
  // Two anchors, as Discord's two importers are, and both go through the one
  // helper that measures the box.
  const calls = (BUBBLE.match(/openAuthorProfile\(event\.currentTarget\)/g) ?? []).length;
  assert.equal(calls, 3, "the avatar's click, and the name's click and its Enter/Space");
  assert.ok(BUBBLE.includes('data-testid="message-author-avatar"'));
  assert.ok(BUBBLE.includes('data-message-author="true"'));
});

test("the bubble measures the box the popout will stand beside", () => {
  // The correction of 2026-09-21: the small tier is a popout **beside what you
  // pressed**, and the box is what makes that possible. Measured at the moment
  // of the press rather than held in state — the list scrolls, and a rectangle
  // from a second ago points at the wrong row.
  assert.match(BUBBLE, /trigger\.getBoundingClientRect\(\)/);
  for (const edge of ["top", "bottom", "left", "right"]) {
    assert.match(BUBBLE, new RegExp(`${edge}: box\.${edge}`), `the anchor drops ${edge}`);
  }
});

test("the bubble hands over the place it was read from", () => {
  // Discord keys its profile on `(userId, guildId)`. The conversation is the
  // guild here, and it is what lets the full card say a standing and a join
  // date — the difference that stopped the summary being taller than the thing
  // it summarised. `lib/profileChatContext.ts` decides what may be said with it.
  assert.ok(BUBBLE.includes("message.chat_id ?? null"));
});

test("the face is a button only when there is somebody behind it", () => {
  assert.ok(
    BUBBLE.includes("authorProfileUserId ? ("),
    "the avatar must fall back to the plain element when the actor opens nothing",
  );
  assert.ok(BUBBLE.includes('data-testid="message-author-avatar"'));
});
