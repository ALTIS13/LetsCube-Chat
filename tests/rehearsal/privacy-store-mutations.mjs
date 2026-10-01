import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceUrl = new URL("../../artifacts/kub/src/lib/privacyPreferences.ts", import.meta.url);
const testUrl = new URL("../unit/privacy-write-safety.test.mts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const test = await readFile(testUrl, "utf8");
const directory = await mkdtemp(join(tmpdir(), "letscube-privacy-mutations-"));
const mutants = [
  ["unknown first read accepted", " && loadedFor === userId", ""],
  ["whole stale row written", "gateway.write(account, { presenceVisible: visible })", "gateway.write(account, state.preferences)"],
  ["concurrent local writes", "const operation = writeTail.then", "const operation = Promise.resolve().then"],
  ["old session rollback", "accountEpoch === epoch && activeUserId === account) settle", "activeUserId === account) settle"],
  ["refresh racing a pending write", "return writeTail.then(() => {", "return Promise.resolve().then(() => {"],
];

function run() {
  const result = spawnSync(process.execPath, ["--test", join(directory, "safety.test.mts")], {
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.error, undefined);
  return result;
}

try {
  await writeFile(join(directory, "safety.test.mts"), test.replace(
    "../../artifacts/kub/src/lib/privacyPreferences.ts",
    pathToFileURL(join(directory, "privacyPreferences.ts")).href,
  ));
  // Type-only imports are erased; absolute paths also keep this valid if the
  // module acquires runtime imports later. The real checkout is never edited.
  const isolated = source.replaceAll("\"./presenceStatus.ts\"", JSON.stringify(fileURLToPath(new URL("./presenceStatus.ts", sourceUrl))))
    .replaceAll("\"./phoneFindability.ts\"", JSON.stringify(fileURLToPath(new URL("./phoneFindability.ts", sourceUrl))));
  await writeFile(join(directory, "privacyPreferences.ts"), isolated);
  const control = run();
  assert.equal(control.status, 0, control.stdout + control.stderr);
  console.log("PASS unmodified privacy-store control");
  for (const [label, before, after] of mutants) {
    assert.equal(isolated.split(before).length, 2, `unique mutation anchor: ${label}`);
    await writeFile(join(directory, "privacyPreferences.ts"), isolated.replace(before, after));
    const result = run();
    assert.notEqual(result.status, 0, `${label}: survived`);
    assert.match(result.stdout + result.stderr, /AssertionError|ERR_ASSERTION/, `${label}: must fail an assertion, not parsing`);
    console.log(`KILLED ${label}`);
  }
} finally {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("letscube-privacy-mutations-"));
  await rm(directory, { recursive: true, force: true });
}
