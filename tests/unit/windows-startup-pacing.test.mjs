import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The startup scene's stage list must read as progress.
 *
 * The shell verifies the connection faster than a person can read: measured on
 * the real client, all four stages completed within about 300ms — 75ms each —
 * and the scene then sat still for the remaining 1.9s of its minimum display
 * time. A flicker followed by a long hold is what "it starts jerkily"
 * describes.
 *
 * The pacing is in CSS on purpose. The startup UI carries a contract forbidding
 * `setTimeout` and `setInterval`, so the scene can never invent progress it has
 * not been told about; a JavaScript version of this broke that rule. A
 * transition delay can only make a change appear LATER, never earlier, so it
 * cannot show a stage as done before the shell has said so.
 *
 * Verified on the real document: the four markers turn green at +249, +435,
 * +655 and +854ms rather than together.
 */

const css = readFileSync(new URL("../../windows-tauri/ui/startup.css", import.meta.url), "utf8");
const js = readFileSync(new URL("../../windows-tauri/ui/startup.js", import.meta.url), "utf8");

test("the stage markers transition rather than switching instantly", () => {
  const marker = css.match(/\.stages li::before \{([^}]*)\}/);
  assert.ok(marker, "the stage marker rule is missing");
  assert.match(marker[1], /transition:\s*background/, "the marker's colour must transition");
});

test("each stage is delayed further than the one before it", () => {
  const delays = [...css.matchAll(/\.stages li:nth-child\((\d)\)[^{]*\{\s*transition-delay:\s*(\d+)ms/g)].map(
    (match) => ({ child: Number(match[1]), delay: Number(match[2]) }),
  );
  assert.ok(delays.length >= 3, `expected a stagger across the stages, found ${delays.length} delays`);
  const sorted = [...delays].sort((a, b) => a.child - b.child);
  for (let index = 1; index < sorted.length; index += 1) {
    assert.ok(
      sorted[index].delay > sorted[index - 1].delay,
      `stage ${sorted[index].child} is not delayed further than stage ${sorted[index - 1].child}`,
    );
  }
  // And the whole run has to stay well inside the scene's minimum display time,
  // or the last stage would still be arriving as the scene fades.
  assert.ok(
    sorted[sorted.length - 1].delay <= 1200,
    `the last stage waits ${sorted[sorted.length - 1].delay}ms, which risks outliving the scene`,
  );
});

test("reduced motion removes the stagger rather than keeping a slow one", () => {
  const blocks = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g) ?? [];
  assert.ok(blocks.length > 0, "no reduced-motion block was found");
  const combined = blocks.join("\n");
  assert.match(combined, /\.stages li[\s\S]*?transition:\s*none/, "the transition must be removed");
  assert.match(combined, /transition-delay:\s*0s/, "and so must the delay, or the change still waits");
});

test("the scene still contains no timers", () => {
  // The rule this pacing had to be designed around: a startup scene that can
  // schedule its own progress can show a stage as done before it is.
  assert.doesNotMatch(js, /setTimeout|setInterval/, "the startup script must not schedule anything");
});
