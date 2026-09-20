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

/**
 * The file with its prose taken out.
 *
 * Every negative assertion below reads this rather than `source`. A doc comment
 * that *names* the shape it replaced — «the field used to carry
 * `max-h-[140px]`» — reads to a regular expression exactly like the shape being
 * refused, so a guard written against the raw text goes red on its own
 * explanation. That has happened in this repository before and is recorded as
 * «a grep that matched a comment».
 *
 * Block comments go whole; a line comment only counts where it opens the line,
 * so a `//` inside a string or a URL is left alone.
 */
const code: string = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

function composerBody(): string {
  const start = source.indexOf("export function MessageInput");
  assert.notEqual(start, -1, "MessageInput is gone");
  return source.slice(start);
}

test("the height is derived from the text in a layout effect", () => {
  // `useEffect` would run after paint and reintroduce the stagger; a layout
  // effect runs after React writes the DOM and before the browser paints.
  //
  // The ceiling moved from a module constant to `maxComposerHeight`, six lines
  // of whatever size the reader chose (D-289), and it joined `text` in the
  // dependencies — a size changed under a standing draft has to re-measure the
  // field that draft is standing in. The contract this pins is unchanged: one
  // layout effect, deriving the height, clamped.
  assert.match(
    source,
    /useLayoutEffect\(\(\) => \{[\s\S]{0,400}?el\.style\.height = `\$\{Math\.min\(el\.scrollHeight, maxComposerHeight\)\}px`;/,
    "the composer no longer sizes itself from `text` in a layout effect",
  );
  assert.match(
    source,
    /\}, \[maxComposerHeight, text\]\);/,
    "the layout effect no longer re-measures when either the text or the size changes",
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
  assert.ok(!/onInput=\{handleInput\}/.test(code), "the input handler is sizing it again");
  assert.ok(!/const handleInput = \(\) => \{/.test(code), "handleInput is back");
});

test("the growth limit is one number, computed, and written down in one place", () => {
  // It used to be a module constant — and, beside it, `max-h-[140px]` on the
  // element: a pair that can drift, and did nothing to the reader who had
  // enlarged the text, because 140px is five lines at 16 and three and a half
  // at 22 (D-289).
  assert.match(
    source,
    /const maxComposerHeight = composerMaxHeight\(messageTextSize\);/,
    "the ceiling is no longer computed from the reader's own size",
  );
  assert.ok(
    !/const MAX_COMPOSER_HEIGHT_PX/.test(code),
    "the fixed ceiling is back beside the computed one",
  );
  // Neither the old number nor any other may be written into the clamp.
  const literals = [...code.matchAll(/Math\.min\(el\.scrollHeight, \d+\)/g)];
  assert.equal(literals.length, 0, "the limit is hard-coded again");
  // And the element must not carry a second ceiling of its own: a CSS
  // `max-height` beside the clamp is the same pair in a different spelling.
  assert.ok(!/max-h-\[\d+px\]/.test(code), "a fixed CSS ceiling is back on the field");
  assert.ok(!/maxHeight:/.test(code), "a second ceiling is back on the field");
});

test("the field takes its face and leading from the conversation's own class", () => {
  // The defect D-289 closed: `text-base sm:text-sm` made the composer 16px on a
  // phone and 14 from 640px up, while the body had already moved to 16 and
  // gained a 13–22 setting the field ignored.
  assert.match(source, /"kub-message-text relative min-w-0 flex-1/, "the field stopped reading the message size");
  assert.ok(!/text-base sm:text-sm/.test(code), "the fixed pair is back on the field");
});
