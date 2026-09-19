import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import DidNotRunGuard, { describeSkip, didNotRun, reportSkips } from "../e2e/helpers/did-not-run-guard.ts";

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

function fakeTest(
  title: string,
  expectedStatus: Status,
  statuses: Status[],
  line = 12,
  annotations: { type: string; description?: string }[] = [],
) {
  const results = statuses.map((status) => ({ status }));
  return {
    title,
    expectedStatus,
    results,
    // Playwright always hands a reporter this array; a runtime
    // `test.skip(condition, reason)` appends `{ type: "skip", description }`.
    annotations,
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

test("legitimate skips do not fail the run, but they are named with their reason", (t) => {
  const { override, output } = endRun(
    [
      fakeTest("skipped at runtime", "skipped", ["skipped"], 12, [
        { type: "skip", description: "VITE_AUTH_CAPTCHA_PROVIDER=yandex is required" },
      ]),
      fakeTest("interrupted", "passed", ["interrupted"]),
      fakeTest("passed", "passed", ["passed"]),
    ],
    "passed",
    t,
  );

  assert.equal(override, undefined, "a skip is not a failure");
  assert.match(output, /1 test\(s\) were skipped and checked nothing/);
  assert.match(output, /1 × VITE_AUTH_CAPTCHA_PROVIDER=yandex is required/);
  assert.match(output, /sample\.spec\.ts:12 > two devices > skipped at runtime/);
  assert.doesNotMatch(output, /interrupted/, "an interrupted test is not a skip");
  assert.doesNotMatch(output, /never executed/, "nothing was dropped here");
});

test("a run with no skips at all says nothing about skips", (t) => {
  const { output } = endRun([fakeTest("passed", "passed", ["passed"])], "passed", t);
  assert.equal(output, "");
});

/*
 * D-210: the shape this exists for. `auth-yandex-captcha.spec.ts` ends "10
 * skipped", exit 0, and the list reporter prints the ten titles with no reason
 * beside any of them — so the one missing environment variable behind all ten
 * is invisible. Grouping by reason is what makes it visible, and a skip that
 * never said why has to be named as that rather than folded in with the rest.
 */
test("skips are grouped by the reason they gave, commonest first", () => {
  const lines: string[] = [];
  reportSkips(
    [
      { where: "a.spec.ts:1 > one", reason: "the flag is missing" },
      { where: "b.spec.ts:2 > two", reason: "the flag is missing" },
      { where: "c.spec.ts:3 > three", reason: null },
    ],
    (message: string) => lines.push(message),
  );
  const output = lines.join("\n");

  assert.match(output, /3 test\(s\) were skipped and checked nothing/);
  assert.ok(
    output.indexOf("2 × the flag is missing") < output.indexOf("1 × no reason was given"),
    "the commonest reason is printed first",
  );
  assert.match(output, /1 × no reason was given/);
  assert.match(output, /a\.spec\.ts:1 > one/);
  assert.match(output, /c\.spec\.ts:3 > three/);
});

test("a long group is truncated by count rather than printed in full", () => {
  const lines: string[] = [];
  reportSkips(
    Array.from({ length: 9 }, (_, index) => ({ where: `a.spec.ts:${index} > case`, reason: "one reason" })),
    (message: string) => lines.push(message),
  );
  const output = lines.join("\n");

  assert.match(output, /9 × one reason/);
  assert.match(output, /… and 5 more/);
});

test("nothing is printed when nothing was skipped", () => {
  const lines: string[] = [];
  reportSkips([null, null], (message: string) => lines.push(message));
  assert.deepEqual(lines, []);
});

test("describeSkip reads the reason off the skip annotation, and only a skip's", () => {
  const skipped = fakeTest("skipped", "skipped", ["skipped"], 44, [
    { type: "fixme", description: "not this one" },
    { type: "skip", description: "  the fixture server is not running  " },
  ]);
  const described = describeSkip(skipped, ROOT);
  assert.equal(described?.reason, "the fixture server is not running", "trimmed, and from the skip annotation");
  assert.match(described?.where ?? "", /sample\.spec\.ts:44/);

  const unsaid = fakeTest("skipped", "skipped", ["skipped"], 45, [{ type: "skip" }]);
  assert.equal(describeSkip(unsaid, ROOT)?.reason, null, "a skip with no description says so");

  assert.equal(describeSkip(fakeTest("passed", "passed", ["passed"]), ROOT), null, "a test that ran is not a skip");
});
