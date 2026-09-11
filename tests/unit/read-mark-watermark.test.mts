import assert from "node:assert/strict";
import test from "node:test";

import { laterTimestamp, timestampMicros } from "../../artifacts/kub/src/lib/readMarkWatermark.ts";

/**
 * A read report carries the newest drawn message's `created_at` as the server
 * wrote it. The server counts a message read when the pointer is at or past
 * that value to the microsecond; a report rounded to a JavaScript millisecond
 * would leave the newest message unread.
 */

const BASE = Date.parse("2026-09-11T10:00:00Z") * 1000;

test("the microseconds PostgREST sends are kept, in every shape it sends them", () => {
  assert.equal(timestampMicros("2026-09-11T10:00:00.123456+00:00"), BASE + 123456);
  assert.equal(timestampMicros("2026-09-11 10:00:00.123456+00"), BASE + 123456);
  assert.equal(timestampMicros("2026-09-11T13:00:00.5+03:00"), BASE + 500000);
  assert.equal(timestampMicros("2026-09-11T13:00:00+0300"), BASE);
  assert.equal(timestampMicros("2026-09-11T10:00:00Z"), BASE);
  assert.equal(timestampMicros("2026-09-11T10:00:00.123Z"), BASE + 123000);
  assert.equal(timestampMicros("2026-09-11T10:00:00.1234567Z"), BASE + 123456, "digits past the sixth are dropped, not rounded up");
});

test("anything that is not a timestamp is null", () => {
  assert.equal(timestampMicros("not a time"), null);
  assert.equal(timestampMicros("2026-09-11"), null);
  assert.equal(timestampMicros(""), null);
  assert.equal(timestampMicros(null), null);
  assert.equal(timestampMicros(undefined), null);
});

test("two messages in the same millisecond are still ordered, and the original string is kept", () => {
  const earlier = "2026-09-11T10:00:00.123100+00:00";
  const later = "2026-09-11T10:00:00.123900+00:00";
  assert.equal(new Date(earlier).getTime(), new Date(later).getTime(), "the premise: a Date cannot tell them apart");
  assert.equal(laterTimestamp(earlier, later), later);
  assert.equal(laterTimestamp(later, earlier), later);
  assert.equal(laterTimestamp(null, later), later);
  assert.equal(laterTimestamp(earlier, "garbage"), earlier);
  assert.equal(laterTimestamp(null, undefined), null);
});
