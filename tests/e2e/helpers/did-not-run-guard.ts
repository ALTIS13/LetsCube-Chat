import path from "node:path";
import type { FullConfig, FullResult, Reporter, Suite, TestCase } from "@playwright/test/reporter";

/**
 * A test that never executed must not count as a green run, and must be named.
 *
 * Playwright drops tests rather than running them in a few situations — the rest
 * of a `describe.serial` group after one of its members failed, and what is left
 * of a suite whose `beforeAll` threw. It gives each of them a `skipped` result
 * whether or not anyone asked for a skip, and prints the lot as a bare count:
 * "6 did not run", with no names. Finding out which six meant re-running files
 * one at a time.
 *
 * On its own a dropped test never fails a run either. The runner's failure
 * tracker counts only `unexpected` outcomes, and a test whose results are all
 * `skipped` has the outcome `skipped`, which `TestCase.ok()` accepts. In the
 * ordinary cascades that does not matter, because the test that tripped them is
 * a failure itself and the run is already red — there, this reporter's job is
 * the names. It matters when the trigger is not counted. Measured on 1.59.1: a
 * setup failure absorbed by `test.fail()` tests, one of which stops its worker
 * with an error raised outside any `expect`, ends with "2 did not run, 3 passed"
 * and exit code 0. Only in that case is the result overridden.
 *
 * The classification is deliberately the one the built-in summary uses for its
 * "did not run" line (`reporters/base.js`, `generateSummary`), so the two can
 * never disagree: a skipped outcome, no `interrupted` result, and either no
 * result at all or a test that was never declared skippable. A runtime
 * `test.skip(...)`, a declared `test.skip`/`test.fixme`, and a skip thrown from
 * `beforeAll` all set `expectedStatus` to `skipped`, so none of them is listed.
 *
 * An interrupted run (Ctrl+C) or one stopped by `--max-failures` legitimately
 * leaves tests unexecuted and already exits non-zero. Those tests are still
 * named, but the result is left exactly as the runner decided it.
 *
 * `--list` is the one run where every test has no result and none was dropped:
 * nothing was meant to execute. A run in which no test ended at all is left
 * alone — measured, the first version of this reporter failed `--list` and
 * called every test in the listing "never executed".
 */
export default class DidNotRunGuard implements Reporter {
  private suite: Suite | undefined;
  private rootDir = process.cwd();
  private anyTestEnded = false;

  onBegin(config: FullConfig, suite: Suite) {
    this.suite = suite;
    this.rootDir = config.rootDir;
  }

  onTestEnd() {
    // Dropped tests are reported through here too — the runner hands each one a
    // `skipped` result — so this is false only when nothing was run at all.
    this.anyTestEnded = true;
  }

  onEnd(result: FullResult) {
    if (!this.anyTestEnded) return;
    const missed = (this.suite?.allTests() ?? []).filter(didNotRun);
    if (missed.length === 0) return;

    const lines = missed.map((test) => {
      const [, project, , ...titles] = test.titlePath();
      const file = path.relative(this.rootDir, test.location.file).replace(/\\/g, "/");
      return `  - ${project ? `[${project}] ` : ""}${file}:${test.location.line} > ${titles.join(" > ")}`;
    });
    console.log(
      [
        "",
        `${missed.length} test(s) never executed and were reported as "did not run":`,
        ...lines,
        "",
        "These were dropped by the runner, not skipped by a condition in the test.",
        "The first failure above them in the same file or group is usually why.",
        "",
      ].join("\n"),
    );

    if (result.status === "passed") return { status: "failed" as const };
  }
}

/** Exactly the rule the built-in summary counts as "did not run". */
export function didNotRun(test: Pick<TestCase, "outcome" | "results" | "expectedStatus">): boolean {
  if (test.outcome() !== "skipped") return false;
  if (test.results.some((result) => result.status === "interrupted")) return false;
  return test.results.length === 0 || test.expectedStatus !== "skipped";
}
