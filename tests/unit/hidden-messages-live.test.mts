import assert from "node:assert/strict";
import test from "node:test";

import { HiddenMessagesLive, readHideEvent } from "../../artifacts/kub/src/lib/hiddenMessagesLive.ts";

// Tracker item 58: a return to a conversation skips the hidden-ids read only
// when the account's hides channel is proved live and every row held was
// verified under it.

function clock(start = 1_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

function live() {
  const time = clock();
  const hides = new HiddenMessagesLive(time.now);
  hides.joined();
  time.advance(10);
  hides.pingReturned();
  time.advance(10);
  return { hides, time };
}

test("a joined channel is not trusted until its own ping comes back", () => {
  const time = clock();
  const hides = new HiddenMessagesLive(time.now);
  hides.joined();
  hides.markVerified("chat", ["a", "b"], time.now());
  assert.equal(hides.isLive(), false);
  assert.equal(hides.canSkip("chat", ["a", "b"]), false, "SUBSCRIBED alone stood in for a read");
  time.advance(5);
  hides.pingReturned();
  assert.equal(hides.isLive(), true);
  // The read made before the ping proves nothing about what was hidden meanwhile.
  assert.equal(hides.canSkip("chat", ["a", "b"]), false);
});

test("a ping nobody asked for does not make the channel live", () => {
  const hides = new HiddenMessagesLive(clock().now);
  hides.pingReturned();
  assert.equal(hides.isLive(), false);
});

test("rows verified by a read begun while live are drawn without another", () => {
  const { hides, time } = live();
  hides.markVerified("chat", ["a", "b"], time.now());
  assert.equal(hides.canSkip("chat", ["a", "b"]), true);
  assert.equal(hides.canSkip("chat", ["a"]), true);
  assert.equal(hides.canSkip("other", ["a"]), false, "one chat's reads vouch for another");
});

test("a row nobody verified sends the return back to the read", () => {
  const { hides, time } = live();
  hides.markVerified("chat", ["a", "b"], time.now());
  assert.equal(hides.canSkip("chat", ["a", "b", "c"]), false);
  // One that arrived live joins the verified set.
  hides.markVerified("chat", ["c"], time.now());
  assert.equal(hides.canSkip("chat", ["a", "b", "c"]), true);
});

test("a read that began before the channel went live is not counted", () => {
  const time = clock();
  const hides = new HiddenMessagesLive(time.now);
  const readStartedAt = time.now();
  time.advance(10);
  hides.joined();
  hides.pingReturned();
  hides.markVerified("chat", ["a"], readStartedAt);
  assert.equal(hides.canSkip("chat", ["a"]), false);
});

test("a gap ends it, and the next live session starts from a new read", () => {
  const { hides, time } = live();
  hides.markVerified("chat", ["a"], time.now());
  hides.lost();
  assert.equal(hides.canSkip("chat", ["a"]), false, "a gap was trusted");
  hides.joined();
  time.advance(10);
  hides.pingReturned();
  assert.equal(hides.canSkip("chat", ["a"]), false, "a read from before the gap vouched for after it");
  time.advance(10);
  hides.markVerified("chat", ["a"], time.now());
  assert.equal(hides.canSkip("chat", ["a"]), true);
});

test("an unhide forgets its chat, so the message is read back", () => {
  const { hides, time } = live();
  hides.markVerified("chat", ["a", "b"], time.now());
  const heard: unknown[] = [];
  const stop = hides.subscribe((event) => heard.push(event));
  hides.heard({ chatId: "chat", messageId: "a", hidden: true });
  assert.equal(hides.canSkip("chat", ["b"]), true, "a hide heard live keeps the chat verified");
  hides.heard({ chatId: "chat", messageId: "a", hidden: false });
  assert.equal(hides.canSkip("chat", ["b"]), false);
  stop();
  hides.heard({ chatId: "chat", messageId: "b", hidden: true });
  assert.equal(heard.length, 2, "a listener that left was still told");
});

test("only the database's own payload is read as a hide", () => {
  assert.deepEqual(readHideEvent({ message_id: "m", chat_id: "c", hidden: true, id: "x" }), {
    chatId: "c",
    messageId: "m",
    hidden: true,
  });
  assert.equal(readHideEvent({ message_id: "m", chat_id: "c", hidden: "true" }), null);
  assert.equal(readHideEvent({ message_id: "m", hidden: true }), null);
  assert.equal(readHideEvent({ ping: true }), null);
  assert.equal(readHideEvent(null), null);
});
