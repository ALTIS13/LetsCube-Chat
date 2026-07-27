import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../rls/support-ticketing-smoke.mjs", import.meta.url),
  "utf8",
);

test("support RLS smoke can create and always clean a least-privilege operator role", () => {
  assert.match(source, /createTemporaryOperatorRole/);
  assert.match(source, /support\.view/);
  assert.match(source, /support\.claim/);
  assert.match(source, /temporaryRoleIds/);
  assert.match(source, /finally\s*\{/);
  assert.match(source, /deleteRoleFixture/);
});

test("temporary operator fallback never grants support manage", () => {
  const temporaryRoleFunction =
    source.match(/async function createTemporaryOperatorRole[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(temporaryRoleFunction, /support\.manage/);
});
