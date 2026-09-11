import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { qaMutationsAllowed } from "../e2e/helpers/auth.ts";

/**
 * The switch between a spec that writes into production and one that skips.
 *
 * The owner's QA file carried `KUB_QA_ALLOW_MUTATIONS=1` until 2026-09-11, and a
 * QA file may carry it again, so the property that matters most is precedence: a
 * `0` in the process environment has to win over the file, or there is no way to
 * run the suite without writing real messages.
 */

function withQaFile(contents: string | null, env: string | undefined, run: () => void) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "qa-mutation-gate-"));
  const file = path.join(directory, "qa.env");
  if (contents !== null) writeFileSync(file, contents);
  const saved = { file: process.env.KUB_QA_ENV_FILE, flag: process.env.KUB_QA_ALLOW_MUTATIONS };
  process.env.KUB_QA_ENV_FILE = file;
  if (env === undefined) delete process.env.KUB_QA_ALLOW_MUTATIONS;
  else process.env.KUB_QA_ALLOW_MUTATIONS = env;
  try {
    run();
  } finally {
    if (saved.file === undefined) delete process.env.KUB_QA_ENV_FILE;
    else process.env.KUB_QA_ENV_FILE = saved.file;
    if (saved.flag === undefined) delete process.env.KUB_QA_ALLOW_MUTATIONS;
    else process.env.KUB_QA_ALLOW_MUTATIONS = saved.flag;
    rmSync(directory, { recursive: true, force: true });
  }
}

test("a 0 in the environment silences a 1 in the QA file", () => {
  withQaFile("KUB_QA_ALLOW_MUTATIONS=1\n", "0", () => assert.equal(qaMutationsAllowed(), false));
});

test("the QA file decides when the environment does not say", () => {
  withQaFile("KUB_QA_ALLOW_MUTATIONS=1\n", undefined, () => assert.equal(qaMutationsAllowed(), true));
  withQaFile("KUB_QA_ALLOW_MUTATIONS=1\n", "", () => assert.equal(qaMutationsAllowed(), true));
});

test("a 1 in the environment allows writes whatever the file says", () => {
  withQaFile("KUB_QA_ALLOW_MUTATIONS=0\n", "1", () => assert.equal(qaMutationsAllowed(), true));
});

test("writes are refused unless something says exactly 1", () => {
  withQaFile(null, undefined, () => assert.equal(qaMutationsAllowed(), false));
  withQaFile("KUB_QA_OWNER_EMAIL=owner@example.test\n", undefined, () =>
    assert.equal(qaMutationsAllowed(), false),
  );
  withQaFile("KUB_QA_ALLOW_MUTATIONS=true\n", undefined, () => assert.equal(qaMutationsAllowed(), false));
  withQaFile(null, "yes", () => assert.equal(qaMutationsAllowed(), false));
});
