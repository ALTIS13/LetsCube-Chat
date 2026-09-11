import assert from "node:assert/strict";
import test from "node:test";

import { sameData, shareById } from "../../artifacts/kub/src/lib/structuralSharing.ts";

/**
 * D-088 and D-089: what a refetch hands back must not be new where nothing is.
 *
 * The store keeps the previous object wherever the data is the same, and its
 * previous array when nothing changed, because a memoised row only skips a
 * render when its props are the same objects. These are the two answers that
 * decide it.
 */

test("primitives compare by value, and null is not undefined", () => {
  assert.equal(sameData(1, 1), true);
  assert.equal(sameData("a", "a"), true);
  assert.equal(sameData(Number.NaN, Number.NaN), true);
  assert.equal(sameData(1, "1"), false);
  assert.equal(sameData(null, undefined), false);
  assert.equal(sameData(null, {}), false);
});

test("objects compare by their data, in any key order", () => {
  assert.equal(sameData({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }), true);
  assert.equal(sameData({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [2, 1] } }), false);
  assert.equal(sameData({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(sameData({ a: 1, b: 2 }, { a: 1 }), false);
  assert.equal(sameData({ a: { deep: "x" } }, { a: { deep: "y" } }), false);
});

test("a key holding undefined is absent, but a key holding null is not", () => {
  // A fetched chat with no preview carries `last_message: undefined`; a patched
  // one may not carry the key at all. Those are the same chat.
  assert.equal(sameData({ a: 1, b: undefined }, { a: 1 }), true);
  assert.equal(sameData({ a: 1 }, { a: 1, b: undefined }), true);
  assert.equal(sameData({ a: 1, b: null }, { a: 1 }), false);
  assert.equal(sameData({ a: 1, b: undefined }, { a: 1, b: null }), false);
});

test("arrays are not records, and other objects compare by identity", () => {
  assert.equal(sameData([], {}), false);
  assert.equal(sameData([1, [2]], [1, [2]]), true);
  assert.equal(sameData([1, 2], [1, 2, 3]), false);
  const set = new Set([1]);
  assert.equal(sameData(set, set), true);
  assert.equal(sameData(new Set([1]), new Set([1])), false);
  assert.equal(sameData(new Date(0), new Date(0)), false);
});

const row = (id: string, text: string) => ({ id, text, sender: { id: "u1", name: "Аня" } });
const byId = (item: { id: string }) => item.id;

test("a refetch of identical data gives back the previous array", () => {
  const previous = [row("a", "one"), row("b", "two")];
  const refetched = [row("a", "one"), row("b", "two")];
  assert.equal(shareById(previous, refetched, byId), previous);
});

test("one changed row is the only new object", () => {
  const previous = [row("a", "one"), row("b", "two"), row("c", "three")];
  const refetched = [row("a", "one"), row("b", "changed"), row("c", "three")];
  const shared = shareById(previous, refetched, byId);
  assert.notEqual(shared, previous);
  assert.equal(shared[0], previous[0]);
  assert.equal(shared[1], refetched[1]);
  assert.equal(shared[2], previous[2]);
});

test("a reordered list is a new array of the same objects", () => {
  const previous = [row("a", "one"), row("b", "two")];
  const shared = shareById(previous, [row("b", "two"), row("a", "one")], byId);
  assert.notEqual(shared, previous);
  assert.equal(shared[0], previous[1]);
  assert.equal(shared[1], previous[0]);
});

test("added and removed rows change the array and keep the rest", () => {
  const previous = [row("a", "one"), row("b", "two")];
  const grown = shareById(previous, [row("a", "one"), row("b", "two"), row("c", "new")], byId);
  assert.equal(grown.length, 3);
  assert.equal(grown[0], previous[0]);
  assert.equal(grown[1], previous[1]);
  const shrunk = shareById(previous, [row("b", "two")], byId);
  assert.equal(shrunk.length, 1);
  assert.equal(shrunk[0], previous[1]);
});

test("the same array in is the same array out", () => {
  const previous = [row("a", "one")];
  assert.equal(shareById(previous, previous, byId), previous);
});
