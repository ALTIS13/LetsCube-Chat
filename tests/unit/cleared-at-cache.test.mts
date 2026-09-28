import assert from "node:assert/strict";
import test from "node:test";

import { ClearedAtCache } from "../../artifacts/kub/src/lib/clearedAtCache.ts";

const OLD_MARK = "2026-09-01T09:00:00.000Z";
const NEW_MARK = "2026-09-03T18:00:00.000Z";

test("sidebar mark is reused only for the exact user/chat pair and less than 3 seconds", async () => {
  let now = 1_000;
  const cache = new ClearedAtCache(() => now);
  const read = cache.beginMembershipRead();
  cache.seedFromMembershipRead("user-a", [{ chat_id: "chat-a", cleared_at: OLD_MARK }], read);
  assert.equal(cache.hasFresh("chat-a", "user-a"), true);

  let directReads = 0;
  const load = async () => { directReads += 1; return { value: NEW_MARK, ok: true }; };
  assert.equal(await cache.getOrLoad("chat-a", "user-a", load), OLD_MARK);
  assert.equal(directReads, 0);

  assert.equal(await cache.getOrLoad("chat-a", "user-b", load), NEW_MARK);
  assert.equal(await cache.getOrLoad("chat-b", "user-a", load), NEW_MARK);
  assert.equal(directReads, 2);

  now = 4_000;
  assert.equal(cache.hasFresh("chat-a", "user-a"), false);
  assert.equal(await cache.getOrLoad("chat-a", "user-a", load), NEW_MARK);
  assert.equal(directReads, 3);
});

test("a membership read started before clear cannot recache the old mark", async () => {
  let now = 1_000;
  const cache = new ClearedAtCache(() => now);
  const oldRead = cache.beginMembershipRead();
  now = 1_100;
  cache.evictChat("chat-a");
  cache.seedFromMembershipRead("user-a", [{ chat_id: "chat-a", cleared_at: null }], oldRead);

  let directReads = 0;
  assert.equal(await cache.getOrLoad("chat-a", "user-a", async () => {
    directReads += 1;
    return { value: NEW_MARK, ok: true };
  }), NEW_MARK);
  assert.equal(directReads, 1);
});

test("clear evicts an in-flight direct read and retries against the new mark", async () => {
  const cache = new ClearedAtCache(() => 1_000);
  let finishOldRead!: (value: { value: string | null; ok: boolean }) => void;
  let directReads = 0;
  const load = () => {
    directReads += 1;
    if (directReads === 1) return new Promise<{ value: string | null; ok: boolean }>((resolve) => { finishOldRead = resolve; });
    return Promise.resolve({ value: NEW_MARK, ok: true });
  };
  const pending = cache.getOrLoad("chat-a", "user-a", load);
  cache.evictChat("chat-a");
  finishOldRead({ value: null, ok: true });

  assert.equal(await pending, NEW_MARK);
  assert.equal(directReads, 2);
  assert.equal(await cache.getOrLoad("chat-a", "user-a", load), NEW_MARK);
  assert.equal(directReads, 2);
});

test("failed direct reads are unknown, not an uncleared null, and are not cached", async () => {
  const cache = new ClearedAtCache(() => 1_000);
  let directReads = 0;
  const load = async () => {
    directReads += 1;
    return directReads === 1 ? { value: null, ok: false } : { value: NEW_MARK, ok: true };
  };
  assert.equal(await cache.getOrLoad("chat-a", "user-a", load), undefined);
  assert.equal(cache.hasFresh("chat-a", "user-a"), false);
  assert.equal(await cache.getOrLoad("chat-a", "user-a", load), NEW_MARK);
  assert.equal(directReads, 2);
});

// Tracker item 58: coming back to a conversation re-read its «cleared for me»
// mark before drawing it, one of two round trips in a row. While this user's
// own membership rows are heard live, a change to the mark arrives as an
// event that evicts it, so a mark read under that channel stays usable.
test("a mark read while the own-membership channel is live stays usable past three seconds", async () => {
  let now = 1_000;
  const cache = new ClearedAtCache(() => now);
  cache.setLive(true);
  now = 1_500;
  let directReads = 0;
  const load = async () => { directReads += 1; return { value: OLD_MARK, ok: true }; };
  assert.equal(await cache.getOrLoad("chat-a", "user-a", load), OLD_MARK);

  now = 60_000;
  assert.equal(cache.hasFresh("chat-a", "user-a"), true);
  assert.equal(await cache.getOrLoad("chat-a", "user-a", load), OLD_MARK);
  assert.equal(directReads, 1);

  // The event for a change evicts it, as it always did.
  cache.evictChat("chat-a");
  assert.equal(cache.hasFresh("chat-a", "user-a"), false);
});

test("a gap in the channel, or a mark read before it joined, falls back to three seconds", async () => {
  let now = 1_000;
  const cache = new ClearedAtCache(() => now);
  const read = cache.beginMembershipRead();
  cache.seedFromMembershipRead("user-a", [{ chat_id: "chat-a", cleared_at: OLD_MARK }], read);
  now = 1_200;
  // Joined after the read: a change between the two was never heard.
  cache.setLive(true);
  now = 5_000;
  assert.equal(cache.hasFresh("chat-a", "user-a"), false);

  let directReads = 0;
  const load = async () => { directReads += 1; return { value: NEW_MARK, ok: true }; };
  assert.equal(await cache.getOrLoad("chat-a", "user-a", load), NEW_MARK);
  assert.equal(directReads, 1);
  now = 30_000;
  assert.equal(cache.hasFresh("chat-a", "user-a"), true);

  // Found dead, or rejoined after a gap: what was read before is not trusted.
  cache.setLive(false);
  assert.equal(cache.hasFresh("chat-a", "user-a"), false);
  cache.setLive(true);
  now = 40_000;
  assert.equal(cache.hasFresh("chat-a", "user-a"), false);
});
