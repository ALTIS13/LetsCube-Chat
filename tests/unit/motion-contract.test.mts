import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MOTION_MS, feedbackDuration } from "../../artifacts/kub/src/lib/motion.ts";

/**
 * The approved motion contract: five semantic timings and one transient success
 * duration, with reduced motion shortening feedback rather than removing it.
 *
 * The durations are named rather than numeric at the call sites, so this is the
 * one place the numbers are allowed to live. A component that writes its own
 * `duration-150` is outside the system and drifts from it silently.
 */

test("motion timings match the approved semantic contract", () => {
  assert.deepEqual(MOTION_MS, { instant: 90, fast: 140, standard: 220, emphasis: 320, feedback: 2400 });
});

test("reduced motion shortens transient feedback rather than removing it", () => {
  assert.equal(feedbackDuration("success", false), 2400);
  assert.equal(feedbackDuration("success", true), 1600);
  // Every kind is treated the same: the reduction is about movement, not about
  // how long a person is given to read the result.
  for (const kind of ["success", "info", "warning", "error"] as const) {
    assert.equal(feedbackDuration(kind, false), 2400, `${kind} should use the full duration`);
    assert.equal(feedbackDuration(kind, true), 1600, `${kind} should use the reduced duration`);
  }
});

test("the timings are frozen so a caller cannot edit the contract at runtime", () => {
  assert.throws(() => {
    (MOTION_MS as unknown as Record<string, number>).standard = 1;
  }, TypeError);
});

const css = readFileSync(new URL("../../artifacts/kub/src/index.css", import.meta.url), "utf8");

test("the CSS variables carry the same numbers as the module", () => {
  const expected: Record<string, string> = {
    "kub-motion-instant": "90ms",
    "kub-motion-fast": "140ms",
    "kub-motion-standard": "220ms",
    "kub-motion-emphasis": "320ms",
    "kub-motion-feedback": "2400ms",
  };
  for (const [name, value] of Object.entries(expected)) {
    const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
    assert.ok(match, `--${name} is not defined`);
    assert.equal(match[1].trim(), value, `--${name} disagrees with MOTION_MS`);
  }
  assert.match(css, /--kub-ease-standard:\s*cubic-bezier/);
  assert.match(css, /--kub-ease-emphasis:\s*cubic-bezier/);
});

test("reduced motion collapses the movement durations but not the feedback one", () => {
  const blocks = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g) ?? [];
  assert.ok(blocks.length > 0, "no reduced-motion block was found");

  const combined = blocks.join("\n");
  for (const name of ["kub-motion-instant", "kub-motion-fast", "kub-motion-standard", "kub-motion-emphasis"]) {
    assert.match(
      combined,
      new RegExp(`--${name}:\\s*1ms;`),
      `--${name} must collapse under reduced motion`,
    );
  }
  // Feedback is how long a result stays readable. Collapsing it would remove the
  // feedback itself, which reduced motion is explicitly not meant to do.
  assert.doesNotMatch(
    combined,
    /--kub-motion-feedback:\s*1ms;/,
    "reduced motion must not collapse the transient feedback duration",
  );
});

test("the interactive press state is removed under reduced motion", () => {
  assert.match(css, /\.kub-interactive:active:not\(:disabled\)\s*\{\s*transform:\s*scale\(\.?0?\.98\)/);
  const blocks = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g) ?? [];
  assert.match(
    blocks.join("\n"),
    /\.kub-interactive:active:not\(:disabled\)\s*\{\s*transform:\s*none/,
    "the press transform must be removed under reduced motion",
  );
});

const controls = ["KubButton", "KubModal", "KubTooltip"].map((name) => ({
  name,
  source: readFileSync(
    new URL(`../../artifacts/kub/src/components/kub/${name}.tsx`, import.meta.url),
    "utf8",
  ),
}));

test("the shared controls take their timing from the system, not from a literal", () => {
  for (const { name, source } of controls) {
    assert.doesNotMatch(
      source,
      /duration-\d+/,
      `${name} still writes a literal Tailwind duration; it drifts from MOTION_MS silently`,
    );
    assert.match(source, /kub-interactive/, `${name} does not carry the shared interactive timing`);
  }
});
