import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const target = fileURLToPath(new URL("./media-cache-settings.test.mjs", import.meta.url));
const cases = [
  ["wrong-limit", "64/128/256 MB controls", "toHaveText"],
  ["fake-empty", "empty, loading and unavailable", "toBeEnabled"],
  ["unrequested-success", "empty, loading and unavailable", "toContainText"],
  ["missing-pending-lock", "clear locks all commands", "toBeDisabled"],
  ["unclamped-meter", "reports actual bytes", "toHaveAttribute"],
];

for (const [mutant, pattern, diagnostic] of cases) {
  test(`media cache settings rejects ${mutant} in the actual rendered component`, {timeout: 45_000}, () => {
    const env = {...process.env, KUB_QA_ALLOW_MUTATIONS: "0", MEDIA_CACHE_UI_MUTANT: mutant, MEDIA_CACHE_UI_CAPTURE_DIR: ""};
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--test", "--test-name-pattern", pattern, target], {
      env,
      encoding: "utf8", timeout: 40_000, maxBuffer: 1_000_000,
    });
    assert.ifError(result.error);
    const output = result.stdout + result.stderr;
    assert.equal(result.status, 1, output);
    assert.match(output, /tests 1\r?\n/, "the named behavioral test actually ran");
    assert.match(output, /fail 1\r?\n/, "exactly one behavioral test rejected the mutation");
    assert.ok(output.includes(diagnostic), `expected ${diagnostic} rejection, not a build/import/hook failure: ${output}`);
    assert.doesNotMatch(output, /Build failed|hook failed|ERR_UNSUPPORTED|unique mutation anchor/);
  });
}
