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
    const all = this.suite?.allTests() ?? [];

    // Said before the dropped-test block, because it is the commoner case: a
    // run in which everything skipped ends "10 skipped", exit 0, and reads as
    // a green run to anyone who greps for passed/failed.
    reportSkips(all.filter((test) => !didNotRun(test)).map((test) => describeSkip(test, this.rootDir)));

    const missed = all.filter(didNotRun);
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

/** One skipped test, reduced to the two things a reader needs. */
export interface SkippedTest {
  /** `file:line > titles`, already relative and with forward slashes. */
  readonly where: string;
  /** The reason the skip was given, or `null` when it was given none. */
  readonly reason: string | null;
}

/**
 * What a skipped test looks like to this reporter.
 *
 * The reason comes from the `skip` annotation. `test.skip(condition, reason)`
 * pushes one at runtime, a declared `test.skip`/`test.fixme` carries one from
 * the declaration, and a skip thrown out of `beforeAll` carries the hook's. A
 * `reason` of `null` means the condition never said why, which is the shape
 * worth naming on its own.
 *
 * A test the run interrupted is not a skip, and is excluded on the same rule
 * `didNotRun` uses: its outcome reads `skipped` because interrupted results
 * are ignored when the outcome is computed, but nobody decided to stand it
 * aside — Ctrl+C or `--max-failures` stopped the run, which already exits
 * non-zero and says so. Written as a test first, and the first version of this
 * function did call such a test "skipped and checked nothing".
 */
export function describeSkip(
  test: Pick<TestCase, "outcome" | "titlePath" | "location" | "annotations" | "results">,
  rootDir: string,
): SkippedTest | null {
  if (test.outcome() !== "skipped") return null;
  if (test.results.some((result) => result.status === "interrupted")) return null;
  const [, project, , ...titles] = test.titlePath();
  const file = path.relative(rootDir, test.location.file).replace(/\\/g, "/");
  const annotation = test.annotations.find((entry) => entry.type === "skip");
  const description = annotation?.description?.trim();
  return {
    where: `${project ? `[${project}] ` : ""}${file}:${test.location.line} > ${titles.join(" > ")}`,
    reason: description ? description : null,
  };
}

/**
 * Names what a run skipped, grouped by the reason it gave.
 *
 * Playwright's own summary is the bare count — "10 skipped" — and its list
 * reporter prints the titles with no reason beside them, so a run in which an
 * absent `VITE_…` flag skipped a whole file looks the same as one in which two
 * mobile-only cases stood aside. Both are legitimate; telling them apart is
 * what this prints. D-210 is the register entry for specs that check nothing
 * and do not say so, and `auth-yandex-captcha.spec.ts` is the measured case:
 * ten tests, one missing environment variable, exit code 0.
 *
 * It never changes a run's status. Almost every skip in this suite is a
 * viewport or engine condition that is meant to stand aside, and failing on
 * those would only teach people to ignore the reporter.
 */
export function reportSkips(candidates: readonly (SkippedTest | null)[], log = console.log): void {
  const skipped = candidates.filter((entry): entry is SkippedTest => entry !== null);
  if (skipped.length === 0) return;

  const byReason = new Map<string, SkippedTest[]>();
  const UNSAID = "no reason was given";
  for (const entry of skipped) {
    const key = entry.reason ?? UNSAID;
    const bucket = byReason.get(key);
    if (bucket) bucket.push(entry);
    else byReason.set(key, [entry]);
  }

  const lines: string[] = ["", `${skipped.length} test(s) were skipped and checked nothing:`];
  for (const [reason, entries] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`  ${entries.length} × ${reason}`);
    for (const entry of entries.slice(0, 4)) lines.push(`      ${entry.where}`);
    if (entries.length > 4) lines.push(`      … and ${entries.length - 4} more`);
  }
  lines.push("", "A skipped test is not a passing one. Supply the prerequisite, or accept the gap knowingly.", "");
  log(lines.join("\n"));
}
