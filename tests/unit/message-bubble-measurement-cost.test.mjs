import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * What every message on screen costs to measure.
 *
 * Each bubble measures where its timestamp should sit, and that measurement
 * runs once per message. Anything expensive inside it is therefore multiplied
 * by the size of the screenful — which is how a per-bubble `document.fonts.ready`
 * became 304ms of self time in a CPU profile of chat switching, the second
 * largest non-idle entry, and 291 getter calls across four switches.
 */

const raw = readFileSync(
  new URL("../../artifacts/kub/src/components/chat/MessageBubble.tsx", import.meta.url),
  "utf8",
);

// Comments describe the very thing these tests forbid, so they are stripped
// first. An earlier version matched its own explanatory comment and failed on
// correct code.
const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("font readiness is asked once for the page, not once per message", () => {
  assert.match(source, /let fontsReadyPromise/, "the shared promise is missing");
  const reads = source.match(/document\.fonts[^\r\n]*?\.ready/g) ?? [];
  assert.equal(
    reads.length,
    1,
    `expected exactly one fonts.ready read — the one filling the shared promise — found ${reads.length}`,
  );
  // And that read must be the shared one, not a call inside the per-message effect.
  const effect = source.match(/useLayoutEffect\(\(\) => \{[\s\S]*?\}, \[bubbleRef, measure/);
  assert.ok(effect, "the measurement effect could not be found");
  assert.doesNotMatch(
    effect[0],
    /document\.fonts/,
    "the per-message effect must go through the shared promise",
  );
});

test("a resize is observed on the nodes that can change independently, not on every nested one", () => {
  const observe = source.match(/new ResizeObserver\(schedule\)[\s\S]{0,320}?observe\(node as Element\)\);/);
  assert.ok(observe, "the resize observation could not be found");
  // Count the entries in the array, not the refs mentioned: one entry may name
  // a fallback (`a ?? b`) and that is still one observed node.
  const list = observe[0].match(/\[([\s\S]*?)\]\s*\.filter/);
  assert.ok(list, "the observed-node list could not be found");
  const entries = list[1].split(",").map((entry) => entry.trim()).filter(Boolean);
  assert.ok(
    entries.length <= 2,
    `observing ${entries.length} nested nodes turns one resize into ${entries.length} measurements per message: ${entries.join(" | ")}`,
  );
});

test("the measurement is skipped entirely when there is nothing to place", () => {
  // A bubble with no meta must not pay for any of this.
  assert.match(
    source,
    /if \(!hasMeta \|\| !textEl/,
    "the measurement must return early when the bubble has no meta",
  );
});
