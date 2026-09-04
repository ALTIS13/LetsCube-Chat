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

/**
 * D-039: what keeps a prepend from ever being painted out of place.
 *
 * The register recorded a prepend as painting one frame 1233px out, and
 * proposed correcting it from the ResizeObserver instead. Re-measured against
 * the real chat with a probe that reads geometry from a ResizeObserver created
 * after the component's own — after layout, after every correction still to
 * come, immediately before the paint — neither half of that survived:
 *
 *   - no frame is painted out of place. The 1233px reading came from a
 *     requestAnimationFrame sampler, and rAF runs BEFORE style and layout, so
 *     reading geometry there forces an early layout and reports a state that
 *     the hold loop, running later in the same rAF phase, corrects before
 *     anything is painted. Over 13 consecutive prepends: 0 painted frames more
 *     than 100px off the anchor, worst painted displacement 42px.
 *   - correcting from the ResizeObserver made it far worse. Over the same 13
 *     prepends, 11 painted a frame 1252px out, because the observer runs after
 *     the hold and restores against an anchor that `handleScroll` has since
 *     recaptured at the pre-growth position — measured, the hold moved the list
 *     4696 -> 5971 and the observer put it straight back to 4696 one
 *     millisecond later.
 *
 * These two guards are why the mechanism is the shape it is. They are source
 * scans and weaker than they look; the frame-level proof cannot live in CI,
 * because a prepend needs a signed-in chat with real history and the e2e suite
 * is unauthenticated.
 */
test("the older-history hold corrects in the frame it sees the growth", () => {
  const hold = messageList.slice(messageList.indexOf("const hold = () => {"));
  assert.match(
    hold,
    /const before = el\.scrollTop;\s*\n\s*restoreVisibleMessageAnchor\(el, anchor\);/,
    "the hold's restore was deferred or made conditional, so the growth is painted before it is corrected",
  );
  // Four frames, not two. Measured, the layout looked settled for two frames
  // and then shed 706px on the next one.
  assert.match(hold, /if \(settledFrames >= 4\) \{/, "the hold releases on a different number of settled frames");
});

test("the resize correction stays out of the older-history hold", () => {
  const observer = messageList.slice(
    messageList.indexOf("new ResizeObserver("),
    messageList.indexOf("observer.observe(content)"),
  );
  assert.match(
    observer,
    /preservingOlderScrollRef\.current/,
    "the observer no longer stands aside while older history is landing",
  );
  assert.doesNotMatch(
    observer,
    /restoreVisibleMessageAnchor/,
    "the observer restores the older-history anchor again; measured, that undoes the hold's correction a frame later and paints 1252px out",
  );
});
