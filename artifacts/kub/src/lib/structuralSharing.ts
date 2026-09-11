/**
 * Keeping what did not change the same object.
 *
 * A fetch hands back new objects for data the screen already shows. A store
 * that takes them as they come gives every subscriber a new reference for every
 * row, so a memoised row renders again although nothing about it changed — and a
 * list that is refetched on focus, on a receipt and on every message renders
 * whole each time. That was the chat list (D-088) and the second render of a
 * reopened chat (D-089).
 *
 * `shareById` puts the previous object back wherever the data is the same, and
 * hands back the previous array itself when nothing changed at all, so the store
 * can return its old state and wake nobody.
 *
 * This module imports nothing, so the unit suite reaches it directly.
 */

function isPlainRecord(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Whether two JSON-shaped values carry the same data.
 *
 * Arrays compare in order; plain objects by their own keys, where a key that
 * holds `undefined` counts as absent — the answer `JSON.stringify` would give,
 * and the one shape a fetched row and a locally patched row most often disagree
 * on. Anything else that is not a primitive (a `Set`, a `Map`, a `Date`)
 * compares by identity, which is never wrong, only sometimes pessimistic.
 */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;

  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    const left = a as readonly unknown[];
    const right = b as readonly unknown[];
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!sameData(left[index], right[index])) return false;
    }
    return true;
  }

  if (!isPlainRecord(a) || !isPlainRecord(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  let leftKeys = 0;
  for (const key of Object.keys(left)) {
    const value = left[key];
    if (value === undefined) continue;
    leftKeys += 1;
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!sameData(value, right[key])) return false;
  }
  let rightKeys = 0;
  for (const key of Object.keys(right)) {
    if (right[key] !== undefined) rightKeys += 1;
  }
  return leftKeys === rightKeys;
}

/**
 * `next`, with every element whose data equals the previous element of the same
 * id replaced by that previous element.
 *
 * Returns `previous` itself when the list did not change at all: the same
 * length, the same order and the same data. Order is part of that answer —
 * a list that only moved one row is a new array, but every row in it is still
 * the object it was, so only the rows whose data changed render.
 */
export function shareById<T>(
  previous: readonly T[],
  next: readonly T[],
  idOf: (item: T) => string,
): T[] {
  if (previous === next) return previous as T[];
  const previousById = new Map<string, T>();
  for (const item of previous) previousById.set(idOf(item), item);

  let unchanged = previous.length === next.length;
  const shared = next.map((item, index) => {
    const before = previousById.get(idOf(item));
    const kept = before !== undefined && (before === item || sameData(before, item)) ? before : item;
    if (unchanged && kept !== previous[index]) unchanged = false;
    return kept;
  });
  return unchanged ? (previous as T[]) : shared;
}
