import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { attachKnownSender } from "../../artifacts/kub/src/lib/realtimeMessage.ts";
import { resolveMessageActor } from "../../artifacts/kub/src/lib/messageActor.ts";

const ME = "6f8b94d6-72de-42fc-927c-ba18909b5d5c";
const THEM = "1532baab-41d9-480e-96a7-3260c99ececd";

const profile = (id: string) => ({ id, full_name: "Имя", username: "u", avatar_url: null }) as never;

/** What Realtime actually delivers: the raw row, with no joined sender. */
const realtimeRow = (userId: string | null, overrides = {}) =>
  ({
    id: "m1",
    chat_id: "c1",
    user_id: userId,
    bot_id: null,
    type: "text",
    content: "привет",
    created_at: "2026-09-04T18:00:00Z",
    ...overrides,
  }) as never;

test("the symptom: a realtime row without a sender is not recognised as you", () => {
  // This is the bug, stated as a test. `isMe` in MessageList is
  // `actor.kind === "user" && actor.id === userId`, so an invalid actor is not
  // you — your own message paints on the LEFT and hops right when the joined
  // fetch lands.
  const actor = resolveMessageActor(realtimeRow(ME));
  assert.equal(actor.kind, "invalid");
  assert.notEqual(actor.kind, "user");
});

test("your own message is recognised as yours on the first paint", () => {
  const filled = attachKnownSender(realtimeRow(ME), profile(ME));
  const actor = resolveMessageActor(filled);
  assert.equal(actor.kind, "user");
  assert.equal(actor.kind === "user" ? actor.id : null, ME);
});

test("someone else's message uses a sender already on screen", () => {
  const onScreen = [{ user_id: THEM, sender: profile(THEM) }] as never[];
  const filled = attachKnownSender(realtimeRow(THEM), profile(ME), onScreen);
  const actor = resolveMessageActor(filled);
  assert.equal(actor.kind, "user");
  assert.equal(actor.kind === "user" ? actor.id : null, THEM);
});

test("an unknown sender is left absent, never invented", () => {
  // Better a briefly anonymous bubble than a confidently wrong name.
  const filled = attachKnownSender(realtimeRow(THEM), profile(ME), []);
  assert.equal(filled.sender, undefined);
});

test("a sender that is already present is never replaced", () => {
  const row = realtimeRow(THEM, { sender: profile(THEM) });
  assert.equal(attachKnownSender(row, profile(ME)), row);
});

test("a bot message is left alone", () => {
  // `bot_id` with no `user_id`: giving it a sender would make it invalid.
  const row = realtimeRow(null, { bot_id: "b1", bot: { id: "b1", state: "active" } });
  const filled = attachKnownSender(row, profile(ME));
  assert.equal(filled.sender, undefined);
  assert.equal(resolveMessageActor(filled).kind, "bot");
});

test("a bot message cannot inherit a sender from another senderless row", () => {
  // The `!row.user_id` guard earns its place here. Both rows have a null
  // `user_id`, so a lookup keyed on that alone would match — and a bot row
  // carrying a person's `sender` resolves as INVALID, which renders nothing.
  const row = realtimeRow(null, { bot_id: "b1", bot: { id: "b1", state: "active" } });
  const poisoned = [{ user_id: null, sender: profile(THEM) }] as never[];
  const filled = attachKnownSender(row, profile(ME), poisoned);
  assert.equal(filled.sender, undefined, "a bot took a person's sender");
  assert.equal(resolveMessageActor(filled).kind, "bot");
});

test("a deleted-user message keeps its own shape", () => {
  // No user_id, no bot_id, no sender: it must stay `deleted_user`, and the
  // same senderless-lookup hazard applies.
  const row = realtimeRow(null);
  const poisoned = [{ user_id: null, sender: profile(THEM) }] as never[];
  const filled = attachKnownSender(row, profile(ME), poisoned);
  assert.equal(resolveMessageActor(filled).kind, "deleted_user");
});

test("a system message is left alone", () => {
  const row = realtimeRow(null, { type: "system" });
  const filled = attachKnownSender(row, profile(ME));
  assert.equal(resolveMessageActor(filled).kind, "system");
});

test("no current user is not a crash", () => {
  assert.equal(attachKnownSender(realtimeRow(ME), null).sender, undefined);
  assert.equal(attachKnownSender(realtimeRow(ME), undefined).sender, undefined);
});

test("the realtime handler actually calls it", () => {
  // The pure function is worthless if the insert path skips it.
  const source = readFileSync("artifacts/kub/src/hooks/useMessages.ts", "utf8");
  assert.match(
    source,
    /const provisional = attachKnownSender\(\s*\n\s*buildRealtimeMessage\(payload\.new\),/,
    "the realtime INSERT handler no longer fills the sender in",
  );
});
