import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const messageList = readFileSync(
  new URL("../../artifacts/kub/src/components/chat/MessageList.tsx", import.meta.url),
  "utf8",
);

test("older history restoration uses a rendered message anchor instead of a one-frame height delta", () => {
  assert.match(messageList, /captureVisibleMessageAnchor/);
  assert.match(messageList, /restoreVisibleMessageAnchor/);
  assert.match(messageList, /useLayoutEffect/);
  assert.doesNotMatch(
    messageList,
    /current\.scrollTop\s*=\s*beforeTop\s*\+\s*\(current\.scrollHeight\s*-\s*beforeHeight\)/,
  );
});

test("older history loading stays single-flight until the rendered anchor is restored", () => {
  assert.match(messageList, /preservingOlderScrollRef\.current/);
  assert.match(
    messageList,
    /if\s*\([\s\S]*preservingOlderScrollRef\.current[\s\S]*\)\s*return;/,
  );
});

/**
 * D-037 and D-038: the placement must happen before the frame is painted.
 *
 * These are source-level guards and are weaker than they look — say so rather
 * than let a later reader assume otherwise. The frame-level proof lives in
 * `tests/e2e/chat-entry-scroll.spec.ts`, which measures painted frames on the
 * real component; that spec covers the entry and the reflow, but it cannot
 * append a message to the DEV preview fixture, so the new-message path has only
 * this. Reverting either property here is what the register measured as three
 * painted frames 2790px out on entry and a sent bubble clipped against the
 * composer 57px below its place.
 */
test("the bottom placement runs in a layout effect rather than after the paint", () => {
  // `applyBottomNow` writes the scroll position synchronously; `scrollToBottom`
  // wraps it in a frame. Which one an effect calls decides whether the reader
  // sees the uncorrected commit first.
  assert.match(messageList, /const applyBottomNow = useCallback/);
  assert.match(
    messageList,
    /useLayoutEffect\(\(\) => \{\s*const messageCountChanged[\s\S]*?applyBottomNow\(\);/,
    "a new message is placed after the paint again",
  );
  assert.doesNotMatch(
    messageList,
    /const messageCountChanged[\s\S]{0,200}?scrollToBottom\(true\)/,
    "the new-message placement animates again, so the bubble is painted where it does not belong",
  );
});

test("the entry placement runs in a layout effect rather than after the paint", () => {
  assert.match(
    messageList,
    /useLayoutEffect\(\(\) => \{\s*const hasMessages = sortedMessages\.length > 0;/,
    "the entry placement is deferred again, so the top of history is painted first",
  );
  assert.match(messageList, /applyBottomNow\(\);\s*const cancelFrame = scrollToBottomAfterLayout\(false\);/);
  assert.match(messageList, /applyMessageTopNow\(firstUnreadMessageId\);/);
});

test("the reflow correction stays inside the ResizeObserver callback", () => {
  // A ResizeObserver runs after layout and before paint. Deferring its
  // correction by a frame is what painted the bubble's own 22px late reflow
  // (D-032) before correcting it.
  assert.match(
    messageList,
    /new ResizeObserver\(\(\) => \{[\s\S]*?applyBottomNow\(\);\s*\}\);/,
    "the resize correction is deferred by a frame again",
  );
  assert.doesNotMatch(
    messageList,
    /new ResizeObserver\(\(\) => \{[\s\S]*?requestAnimationFrame\(\(\) => scrollToBottom/,
    "the resize correction is deferred by a frame again",
  );
});

test("the entry still anchors where the contract says", () => {
  // CLAUDE.md section 11. The defect was that the correction was seen, never
  // that it happened, so the targets themselves must survive any fix.
  assert.match(messageList, /if \(firstUnreadMessageId\) \{/);
  assert.match(messageList, /initialBottomLockUntilRef\.current = Date\.now\(\) \+ 4200;/);
  assert.match(messageList, /\[120, 320, 680, 1200, 1750, 2600, 3600, 4150\]\.forEach\(scheduleBottomSettle\)/);
});
