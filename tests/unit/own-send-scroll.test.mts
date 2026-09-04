import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync("artifacts/kub/src/components/chat/MessageList.tsx", "utf8");

function newMessageEffect(): string {
  const start = source.indexOf("const messageCountChanged = prevMessageCountRef.current");
  assert.notEqual(start, -1, "the new-message effect is gone or was renamed");
  const end = source.indexOf("}, [isTyping,", start);
  assert.ok(end > start, "the effect's dependency list moved");
  return source.slice(start, end);
}

/**
 * Who is allowed to move the reader, and when.
 *
 * The owner stated the rule directly: at the bottom, an incoming message
 * should pull you down; scrolled up, it should not. That is what
 * `isAtBottomRef` has always done and it must keep doing it.
 *
 * The defect was narrower. `isAtBottomRef` is written by the scroll handler, so
 * it lags — scroll events are asynchronous, and between two quick sends the
 * composer resizes the container without producing one. A send arriving while
 * the flag was briefly stale was treated as somebody else's message: no scroll,
 * just the counter, and the bubble painted below the fold under the composer.
 * That is why the first send looked right and the second did not.
 */

test("your own send goes to the bottom regardless of the lagging flag", () => {
  const effect = newMessageEffect();
  assert.match(effect, /iJustSent/, "the own-send path is gone");
  assert.match(
    effect,
    /if \(isAtBottomRef\.current \|\| iJustSent\) \{\s*\n\s*applyBottomNow\(\);/,
    "an own send no longer forces the bottom",
  );
});

test("someone else's message still only counts when you are reading above", () => {
  // The contract from section 11 of CLAUDE.md, and the owner's own statement of
  // it. `iJustSent` requires the last message to be yours, so an incoming one
  // cannot satisfy it.
  const effect = newMessageEffect();
  assert.match(effect, /lastMessageIsMine = lastActor\?\.kind === "user" && lastActor\.id === userId/);
  assert.match(
    effect,
    /\} else if \(messageCountChanged && !preservingOlderScrollRef\.current && !loadingOlderRef\.current\) \{\s*\n\s*setNewCount/,
    "the counter branch for other people's messages was changed",
  );
});

test("loading older history is not mistaken for a send", () => {
  // A prepend changes the count and leaves your own message last, so a
  // count-based test would jump to the bottom in the middle of one — the exact
  // thing the prepend hold exists to prevent. Identity of the LAST message is
  // what distinguishes them.
  const effect = newMessageEffect();
  assert.match(effect, /lastMessageChanged = prevLastMessageIdRef\.current !== lastMessageId/);
  assert.match(
    effect,
    /iJustSent =\s*\n\s*lastMessageChanged &&\s*\n\s*lastMessageIsMine &&\s*\n\s*!preservingOlderScrollRef\.current &&\s*\n\s*!loadingOlderRef\.current;/,
    "the own-send path lost one of its guards",
  );
});

test("the effect sees the messages, not only how many there are", () => {
  // Keyed on the array: the last message's identity can change while the count
  // does not — an optimistic row being replaced by the server row does exactly
  // that.
  assert.match(source, /\}, \[isTyping, sortedMessages, applyBottomNow, userId\]\);/);
});

test("a bot's message is not treated as yours", () => {
  // `resolveMessageActor` returns `{kind:"bot"}` for those, and a bare
  // `user_id === userId` test would have been wrong for a message with no
  // `user_id` at all.
  const effect = newMessageEffect();
  assert.match(effect, /resolveMessageActor\(lastMessage\)/);
  assert.ok(
    !/lastMessage\?\.user_id === userId/.test(effect),
    "the own-message test bypasses the actor rules again",
  );
});
