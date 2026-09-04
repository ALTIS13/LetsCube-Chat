import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync("artifacts/kub/src/index.css", "utf8");

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} is gone`);
  return css.slice(start, css.indexOf("\n}", start));
}

/**
 * D-036. A `linear-gradient(colour 1px, transparent 1px)` paints its rule at the
 * TOP of every tile, and the background is anchored to the element's own padding
 * box — so with no offset there is a line at y=0 and x=0, on the element's own
 * edge, sharing it with whatever border is there.
 *
 * Measured on a reproduction of the profile panel: the header's bottom border
 * and the summary block's first lattice rule both landed on y=57.
 */
test("the subtle lattice does not paint a rule on the block's own edge", () => {
  const subtle = rule(".kub-grid-subtle");
  const position = /background-position:\s*([^;]+);/.exec(subtle)?.[1]?.trim();
  assert.ok(position, ".kub-grid-subtle has no background-position, so it starts at 0 0 again");

  const [x, y] = position.split(/\s+/).map((v) => Number.parseInt(v, 10));
  assert.ok(Number.isFinite(x) && Number.isFinite(y), `unreadable offset: ${position}`);

  const size = /background-size:\s*(\d+)px/.exec(subtle)?.[1];
  const cell = Number.parseInt(size ?? "", 10);
  assert.ok(Number.isFinite(cell) && cell > 0, "the lattice lost its tile size");

  // The rule lands at `offset % cell`. Zero means it sits on the edge.
  assert.notEqual(((x % cell) + cell) % cell, 0, "a vertical rule sits on the left edge");
  assert.notEqual(((y % cell) + cell) % cell, 0, "a horizontal rule sits on the top edge");
});

test("the lattice is still a lattice", () => {
  // Guards against "fixing" the collision by deleting the grid.
  const subtle = rule(".kub-grid-subtle");
  assert.match(subtle, /linear-gradient\(color-mix/, "the horizontal rules are gone");
  assert.match(subtle, /linear-gradient\(90deg/, "the vertical rules are gone");
  assert.match(subtle, /background-size:\s*56px 56px/, "the tile size changed");
});

test("the full-screen background is deliberately left alone", () => {
  // `.kub-grid-bg` has the same zero offset, but it is only used on
  // `min-h-screen` shells where the edge in question is the viewport's, with no
  // adjacent border to collide with. Recorded so the difference reads as a
  // decision rather than as an oversight.
  const bg = rule(".kub-grid-bg");
  assert.match(bg, /background-position:\s*0 0, 0 0, 0 0, 0 0;/);
});
