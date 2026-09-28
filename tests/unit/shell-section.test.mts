import assert from "node:assert/strict";
import test from "node:test";

import { SHELL_SECTION_ROWS, shellSection, shellSectionPath } from "../../artifacts/kub/src/lib/shellSection.ts";
import { isMessengerRoute } from "../../artifacts/kub/src/lib/chatRoute.ts";

// Tracker item 41: «Мои боты» and «Задачи» open beside the lists, as Discord's
// home rows open their pages, rather than replacing the whole window.

test("a section is its exact path, with a query or a trailing slash", () => {
  assert.equal(shellSection("/bots"), "bots");
  assert.equal(shellSection("/bots?bot=abc"), "bots");
  assert.equal(shellSection("/bots/"), "bots");
  assert.equal(shellSection("/tasks"), "tasks");
  assert.equal(shellSection("/tasks#today"), "tasks");
});

test("the public documentation and near matches are not sections", () => {
  assert.equal(shellSection("/bots/docs"), null);
  assert.equal(shellSection("/botsx"), null);
  assert.equal(shellSection("/task"), null);
  assert.equal(shellSection("/"), null);
  assert.equal(shellSection("/chat/11111111-1111-4111-8111-111111111111"), null);
  assert.equal(shellSection("/admin"), null);
});

test("a section is not the messenger's own address, so the chat address rules leave it alone", () => {
  // `reconcileChatAddress` answers idle outside the messenger, which is what
  // keeps a conversation open behind a section, as walking into «Задачи» and
  // back always has.
  for (const row of SHELL_SECTION_ROWS) {
    assert.equal(isMessengerRoute(shellSectionPath(row.section)), false, row.section);
    assert.equal(shellSection(shellSectionPath(row.section)), row.section);
  }
});
