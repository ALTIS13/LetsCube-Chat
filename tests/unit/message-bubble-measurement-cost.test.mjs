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
  // Every `observe()` the effect makes, not only the ones named in the array.
  //
  // This used to read the array literal alone, and a third node added as its
  // own `observer.observe(textFlowRef.current)` statement beside it left all of
  // this green — measured, on the whole file. The limit was written down and
  // not defended.
  const effect = source.match(/useLayoutEffect\(\(\) => \{[\s\S]*?\}, \[bubbleRef, measure[^\]]*\]\);/);
  assert.ok(effect, "the measurement effect could not be found");
  const body = effect[0];
  assert.equal(
    (body.match(/new ResizeObserver\(/g) ?? []).length,
    1,
    "the measurement keeps exactly one observer; a second one would double every delivery",
  );

  // A site fed from an array contributes that array's entries — one entry may
  // name a fallback (`a ?? b`) and that is still one observed node. Every other
  // site contributes the single node it names.
  const fromArray = [
    ...body.matchAll(/\[([^[\]]*)\]\s*\.filter\([\s\S]{0,60}?\)\s*\.forEach\(\([\s\S]{0,80}?\.observe\(/g),
  ];
  const sites = (body.match(/\.observe\(/g) ?? []).length;
  assert.ok(sites > 0, "nothing is observed at all, so a bubble that re-wraps later never re-measures");

  const named = fromArray.flatMap((match) =>
    match[1].split(",").map((entry) => entry.trim()).filter(Boolean),
  );
  const direct = sites - fromArray.length;
  const nodes = named.length + direct;
  assert.ok(
    nodes <= 2,
    `observing ${nodes} nested nodes multiplies every message on screen: ${[...named, `${direct} named outside any array`].join(" | ")}`,
  );

  // The scan cannot see what the running chat registers, which is why the
  // number it protects is measured in tests/e2e/message-meta-observer-cost.spec.ts.
});

test("the measurement is skipped entirely when there is nothing to place", () => {
  // A bubble with no meta must not pay for any of this.
  assert.match(
    source,
    /if \(!hasMeta \|\| !textEl/,
    "the measurement must return early when the bubble has no meta",
  );
});
