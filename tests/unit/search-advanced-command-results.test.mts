import assert from "node:assert/strict";
import test from "node:test";

import { parseAdvancedSearchQuery, shouldShowSearchCommands } from "../../artifacts/kub/src/lib/searchQuery.ts";

test("advanced message filters do not return unfiltered navigation commands", () => {
  assert.equal(shouldShowSearchCommands(parseAdvancedSearchQuery("has:image")), false);
  assert.equal(shouldShowSearchCommands(parseAdvancedSearchQuery("from:@anna")), false);
  assert.equal(shouldShowSearchCommands(parseAdvancedSearchQuery("after:2026-09-01")), false);
});

test("ordinary text and explicit command type keep command search", () => {
  assert.equal(shouldShowSearchCommands(parseAdvancedSearchQuery("чаты")), true);
  assert.equal(shouldShowSearchCommands(parseAdvancedSearchQuery("type:command")), true);
  assert.equal(shouldShowSearchCommands(parseAdvancedSearchQuery("type:message чаты")), false);
});
