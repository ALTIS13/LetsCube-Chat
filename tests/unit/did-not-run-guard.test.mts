import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import DidNotRunGuard, { didNotRun } from "../e2e/helpers/did-not-run-guard.ts";

/**
 * The reporter that names the tests Playwright dropped instead of running.
 *
 * Two things are pinned. First, that its rule IS the built-in summary's rule:
 * each shape below goes through Playwright's own `TerminalReporter`, and the
 * guard must list exactly the tests that reporter counts as "did not run". If an
 * upgrade changes that classification, this fails rather than the two quietly
 * disagreeing. Second, that it overrides a run's result only when the run
 * would otherwise pass — an interrupted or already failed run keeps the status
 * the runner gave it.
 *
 * The end-to-end half — a real runner exiting 0 with dropped tests, and 1 with
 * the guard — is recorded in docs/QA_RESULTS.md, because it needs a throwaway
 * Playwright project and a worker that stops itself.
 */

const require = createRequire(import.meta.url);
const { TerminalReporter } = createRequire(require.resolve("@playwright/test"))(
  "playwright/lib/reporters/base",
) as {
  TerminalReporter: new () => {
    onBegin(suite: unknown): void;
    generateSummary(): { didNotRun: number; skipped: number; interrupted: unknown[] };
  };
};

type Status = "passed" | "failed" | "timedOut" | "skipped" | "interrupted";

const ROOT = path.resolve("fixture-root");

function fakeTest(title: string, expectedStatus: Status, statuses: Status[], line = 12) {
  const results = statuses.map((status) => ({ status }));
  return {
    title,
    expectedStatus,
    results,
    retries: Math.max(0, statuses.length - 1),
    location: { file: path.join(ROOT, "tests", "e2e", "sample.spec.ts"), line, column: 3 },
    titlePath: () => ["", "chromium-desktop-1440", "tests/e2e/sample.spec.ts", "two devices", title],
    // Playwright's `computeTestCaseOutcome`, so both classifiers see the same outcome.
    outcome() {
      let expected = 0;
      let unexpected = 0;
      for (const result of results) {
        if (result.status === "interrupted" || result.status === "skipped") continue;
        if (result.status === expectedStatus) expected += 1;
        else unexpected += 1;
      }
      if (expected === 0 && unexpected === 0) return "skipped";
      if (unexpected === 0) return "expected";
      if (expected === 0) return "unexpected";
      return "flaky";
    },
  };
}

function suiteOf(tests: ReturnType<typeof fakeTest>[]) {
  return { allTests: () => tests };
}

const SHAPES = [
  { name: "dropped by a serial cascade", test: fakeTest("dropped", "passed", ["skipped"]), dropped: true },
  { name: "never started before --max-failures", test: fakeTest("never started", "passed", []), dropped: true },
  { name: "an expected failure that was dropped", test: fakeTest("expected fail", "failed", ["skipped"]), dropped: true },
  { name: "dropped on every retry", test: fakeTest("dropped twice", "passed", ["skipped", "skipped"]), dropped: true },
  { name: "skipped at runtime or from beforeAll", test: fakeTest("skipped", "skipped", ["skipped"]), dropped: false },
  { name: "interrupted by Ctrl+C", test: fakeTest("interrupted", "passed", ["interrupted"]), dropped: false },
  { name: "dropped, then run on retry", test: fakeTest("recovered", "passed", ["skipped", "passed"]), dropped: false },
  { name: "passed", test: fakeTest("passed", "passed", ["passed"]), dropped: false },
  { name: "failed", test: fakeTest("failed", "passed", ["failed"]), dropped: false },
  { name: "failed as expected", test: fakeTest("failed as expected", "failed", ["failed"]), dropped: false },
];

for (const shape of SHAPES) {
  test(`the guard and the built-in summary agree: ${shape.name}`, () => {
    const builtIn = new TerminalReporter();
    builtIn.onBegin(suiteOf([shape.test]));
    const summary = builtIn.generateSummary();

    assert.equal(didNotRun(shape.test), shape.dropped, "the guard's classification");
    assert.equal(summary.didNotRun, shape.dropped ? 1 : 0, "Playwright's own 'did not run' count");
  });
}

function endRun(
  tests: ReturnType<typeof fakeTest>[],
  status: string,
  t: { mock: { method: Function } },
  options: { listOnly?: boolean } = {},
) {
  const lines: string[] = [];
  t.mock.method(console, "log", (message: string) => lines.push(message));
  const guard = new DidNotRunGuard();
  guard.onBegin({ rootDir: ROOT } as never, suiteOf(tests) as never);
  // As the runner does: every test that received a result, dropped ones
  // included, is reported as ended. `--list` reports none.
  if (!options.listOnly) {
    for (const test of tests) if (test.results.length > 0) guard.onTestEnd();
  }
  const override = guard.onEnd({ status } as never);
  return { override, output: lines.join("\n") };
}

test("a run that would pass with a dropped test fails, and the test is named", (t) => {
  const { override, output } = endRun(
    [fakeTest("passed", "passed", ["passed"], 10), fakeTest("dropped", "passed", ["skipped"], 12)],
    "passed",
    t,
  );

  assert.deepEqual(override, { status: "failed" });
  assert.match(output, /1 test\(s\) never executed/);
  assert.match(output, /- \[chromium-desktop-1440\] tests\/e2e\/sample\.spec\.ts:12 > two devices > dropped/);
  assert.doesNotMatch(output, /sample\.spec\.ts:10/, "a test that ran is not listed");
});

test("an already failed run keeps its result, and the dropped tests are still named", (t) => {
  const { override, output } = endRun(
    [fakeTest("failed", "passed", ["failed"], 10), fakeTest("dropped", "passed", ["skipped"], 12)],
    "failed",
    t,
  );

  assert.equal(override, undefined);
  assert.match(output, /sample\.spec\.ts:12 > two devices > dropped/);
});

for (const status of ["interrupted", "timedout"]) {
  test(`a ${status} run is not rewritten`, (t) => {
    const { override } = endRun(
      [fakeTest("passed first", "passed", ["passed"]), fakeTest("never started", "passed", [])],
      status,
      t,
    );
    assert.equal(override, undefined);
  });
}

test("a --list run, where nothing ran, is neither failed nor listed", (t) => {
  const { override, output } = endRun(
    [fakeTest("listed one", "passed", []), fakeTest("listed two", "passed", [])],
    "passed",
    t,
    { listOnly: true },
  );

  assert.equal(override, undefined);
  assert.equal(output, "");
});

test("legitimate skips neither fail the run nor print anything", (t) => {
  const { override, output } = endRun(
    [
      fakeTest("skipped at runtime", "skipped", ["skipped"]),
      fakeTest("interrupted", "passed", ["interrupted"]),
      fakeTest("passed", "passed", ["passed"]),
    ],
    "passed",
    t,
  );

  assert.equal(override, undefined);
  assert.equal(output, "");
});
