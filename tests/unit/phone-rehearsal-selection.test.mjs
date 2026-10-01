import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../rehearsal/phone-search-item74/rehearse.mjs", import.meta.url));
test("phone SQL rehearsal has a nonempty syntax control", () => {
  const result = spawnSync(process.execPath, [runner, "--syntax-only"], { encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS SUMMARY checks=1 skips=0/);
});
test("an unmatched phone SQL rehearsal selector cannot claim success", () => {
  const result = spawnSync(process.execPath, [runner, "--syntax-only", "--only=definitely-no-such-check"], {
    encoding: "utf8", timeout: 15000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no checks matched the requested rehearsal stage/);
  assert.doesNotMatch(result.stdout, /PASS SUMMARY|TARGET/);
});
