import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync("artifacts/kub/src/components/chat/MessageInput.tsx", "utf8");

/**
 * The composer's height must change in the same frame as its text.
 *
 * The bug this pins: `handleSend` called `setText("")`, which React queues, and
 * then wrote `style.height = "auto"` directly to the DOM, which applies at once.
 * The composer therefore collapsed BEFORE the message it was sending existed —
 * the list grew into the freed space and painted, and the bubble arrived in a
 * later frame. Two staggered layout changes where the reader expects one.
 *
 * It survived the scroll-placement fix (`5fc88c9`) because that corrected where
 * the list puts itself, not the fact that its container changed size early, and
 * it was reported still jerking after that shipped.
 *
 * These are source assertions because this repository has no DOM harness. They
 * are written to fail on the shape of the bug, not on the presence of a word.
 */

function composerBody(): string {
  const start = source.indexOf("export function MessageInput");
  assert.notEqual(start, -1, "MessageInput is gone");
  return source.slice(start);
}

test("the height is derived from the text in a layout effect", () => {
  // `useEffect` would run after paint and reintroduce the stagger; a layout
  // effect runs after React writes the DOM and before the browser paints.
  assert.match(
    source,
    /useLayoutEffect\(\(\) => \{[\s\S]{0,400}?el\.style\.height = `\$\{Math\.min\(el\.scrollHeight, MAX_COMPOSER_HEIGHT_PX\)\}px`;[\s\S]{0,80}?\}, \[text\]\);/,
    "the composer no longer sizes itself from `text` in a layout effect",
  );
});

test("nothing writes the height imperatively any more", () => {
  // One place owns the height. Any second writer can run at a different moment
  // than the commit that changed the text, which is exactly the defect.
  const body = composerBody();
  const writes = [...body.matchAll(/\.style\.height\s*=/g)];
  assert.equal(
    writes.length,
    2,
    `expected exactly the two writes inside the layout effect, found ${writes.length}`,
  );

  // And neither of them is inside the send path.
  const sendStart = body.indexOf("const handleSend");
  const sendEnd = body.indexOf("const handleKeyDown", sendStart);
  assert.ok(sendStart > 0 && sendEnd > sendStart, "handleSend is gone or moved");
  const sendPath = body.slice(sendStart, sendEnd);
  assert.ok(
    !/\.style\.height\s*=/.test(sendPath),
    "handleSend sets the height itself again, ahead of the message it is sending",
  );
});

test("the send path still returns focus to the composer", () => {
  // Removing the height write must not take the focus call with it.
  const body = composerBody();
  const sendStart = body.indexOf("const handleSend");
  const sendEnd = body.indexOf("const handleKeyDown", sendStart);
  const sendPath = body.slice(sendStart, sendEnd);
  assert.match(sendPath, /textareaRef\.current\.focus\(\)/, "sending no longer refocuses the composer");
});

test("there is no second sizer on the input event", () => {
  // `onInput={handleInput}` sized it a second way. The textarea is controlled by
  // `text`, so the layout effect already covers typing.
  assert.ok(!/onInput=\{handleInput\}/.test(source), "the input handler is sizing it again");
  assert.ok(!/const handleInput = \(\) => \{/.test(source), "handleInput is back");
});

test("the growth limit is a named constant, not a literal in two places", () => {
  assert.match(source, /const MAX_COMPOSER_HEIGHT_PX = \d+;/);
  const literals = [...source.matchAll(/Math\.min\(el\.scrollHeight, 140\)/g)];
  assert.equal(literals.length, 0, "the limit is hard-coded again");
});
