import assert from "node:assert/strict";
import test from "node:test";

import { sanitizePostgrestSearch } from "../../artifacts/kub/src/lib/searchQuery.ts";

test("a typed handle searches the stored nickname without its leading at-sign", () => {
  assert.equal(sanitizePostgrestSearch("  @other_user  "), "other_user");
  assert.equal(sanitizePostgrestSearch("@@other_user"), "other_user");
});

test("profile lookup cannot turn reserved filter punctuation into query syntax", () => {
  assert.equal(sanitizePostgrestSearch("a,b(c)%"), "a b c");
  assert.equal(sanitizePostgrestSearch("   "), "");
  assert.equal(sanitizePostgrestSearch("x".repeat(81)).length, 80);
});
