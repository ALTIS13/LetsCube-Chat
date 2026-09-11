import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * "Текст прыгает, когда печатаю": the source half of the frame guard.
 *
 * The behaviour is measured in `tests/e2e/composer-typing-frames.spec.ts` — the
 * newest message's clearance from the composer in every painted frame — and
 * that is the proof. It needs the DEV preview fixture server, so it does not run
 * in the default gate. This scan does, and it is weaker than it looks: it says
 * the mechanism is still written the way that measured correctly.
 */

// Comments explain the very constructs forbidden below, so they are stripped
// first — a sentence about `requestAnimationFrame` must not satisfy a scan.
const hook = readFileSync(new URL("../../artifacts/kub/src/hooks/useMeasuredHeight.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

test("the chrome's height is committed inside its ResizeObserver callback", () => {
  // Deferred to the next animation frame, the height reached the list two
  // painted frames after the composer had it: 24px of the newest message's
  // clearance gone per wrapped line, then a jump.
  const callback = hook.match(/new ResizeObserver\(\(\) => \{([\s\S]*?)\}\)/);
  assert.ok(callback, "the observer callback could not be found");
  assert.match(callback[1], /flushSync\(measure\)/, "the observer no longer commits the height before the paint");
  assert.doesNotMatch(callback[1], /requestAnimationFrame/, "the observer defers the read to a later frame again");
  assert.doesNotMatch(hook, /requestAnimationFrame\(measure\)/, "a frame-deferred measurement is back");
});
