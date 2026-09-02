import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * How long someone stares at an unexplained spinner before the app offers a way
 * out.
 *
 * The startup screen shows a bare "Загрузка" and only later reveals a panel
 * with "Повторить" and "Выйти". That panel appears BELOW the spinner and does
 * not interrupt the load, so a long delay before it buys nothing — it only
 * leaves a person with no options while a stalled session restore hangs.
 *
 * Twelve seconds was the original wait. It is also what turned a recoverable
 * state into lost measurements: the QA harness escapes a stalled boot through
 * that same "Выйти", and could not reach it in time.
 */

const app = readFileSync(new URL("../../artifacts/kub/src/App.tsx", import.meta.url), "utf8");

test("the escape appears within a few seconds, not after a dozen", () => {
  const match = app.match(/setTimeout\(\(\) => setSlow\(true\), (\d+)\)/);
  assert.ok(match, "the slow-loading timer could not be found");
  const ms = Number(match[1]);
  assert.ok(
    ms <= 8000,
    `a person waits ${ms}ms with no explanation and no way out before the panel appears`,
  );
  // And not so short that it fires during an ordinary cold start, which would
  // make a normal load look like a fault.
  assert.ok(ms >= 4000, `${ms}ms would show a failure panel during a normal slow start`);
});

test("an error shows the panel immediately rather than waiting out the timer", () => {
  // Waiting when the answer is already known would be pure delay.
  assert.match(
    app,
    /if \(error\) \{\s*setSlow\(true\);\s*return;\s*\}/,
    "an error must reveal the panel at once",
  );
});

test("the panel offers both a retry and a way out", () => {
  // The escape is what breaks a stalled session restore; the retry is for a
  // request that simply failed. Losing either leaves one of those states stuck.
  assert.match(app, /Повторить/, "the retry action is missing");
  assert.match(app, /Выйти/, "the sign-out escape is missing");
});
