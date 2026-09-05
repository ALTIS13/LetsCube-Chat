import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MOTION_MS, feedbackDuration } from "../../artifacts/kub/src/lib/motion.ts";
// The application's classes live in `@layer components`, so a rule's closing
// brace is indented and no longer delimits it. See tests/unit/helpers/css.mjs.
import { atRuleTexts, parseRules, ruleBody } from "./helpers/css.mjs";

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
  const blocks = atRuleTexts(css, /^@media \(prefers-reduced-motion: reduce\)$/);
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
  assert.match(
    ruleBody(css, ".kub-interactive:active:not(:disabled)"),
    /transform:\s*scale\(\.?0?\.98\)/,
  );
  const blocks = atRuleTexts(css, /^@media \(prefers-reduced-motion: reduce\)$/);
  assert.match(
    blocks.join("\n"),
    /\.kub-interactive:active:not\(:disabled\)\s*\{\s*transform:\s*none/,
    "the press transform must be removed under reduced motion",
  );
});

/**
 * Every rule the sheet gives `.name` outside a media or supports query.
 *
 * All of them, not the first: a class is routinely split across rules — the
 * material writes `.kub-glass, .kub-glass-strong` for what the two share and
 * then a rule each for the fill — and the regex this replaces only ever looked
 * at whichever came first. Checking each one is what makes the assertion below
 * mean "no rule of this class hard-codes a duration" rather than "the first
 * one does not".
 */
function unconditionalRules(className: string): string[] {
  return parseRules(css)
    .filter((rule) => rule.at.length === 0 && rule.selectors.includes(`.${className}`))
    .map((rule) => rule.body);
}

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
      /\bduration-\d+\b/,
      `${name} still writes a literal Tailwind duration; it drifts from MOTION_MS silently`,
    );

    // The contract is that a shared control's timing comes from the tokens, not
    // that it carries one particular class name. Naming `kub-interactive`
    // directly was too narrow: the tooltip moved to `kub-tooltip`, which is
    // equally driven by `--kub-motion-fast`, and a name check would have called
    // that a regression. So the classes are resolved out of the stylesheet and
    // each one that carries a transition must take a motion token. A new class
    // that hard-codes `140ms` fails here, which is the drift this test exists
    // to catch.
    const timed = [...source.matchAll(/\bkub-[a-z-]+\b/g)]
      .map((match) => match[0])
      .filter((value, index, all) => all.indexOf(value) === index)
      .flatMap((className) =>
        unconditionalRules(className).map((rule) => ({ className, rule })),
      )
      .filter((entry) => /transition|animation/.test(entry.rule));

    assert.ok(
      timed.length > 0,
      `${name} carries no shared class that the stylesheet gives a transition`,
    );

    for (const { className, rule } of timed) {
      assert.match(
        rule,
        /var\(--kub-motion-[a-z]+\)/,
        `.${className}, used by ${name}, takes no motion token at all`,
      );
      // Every duration must be a token, not merely one of them. Checking only
      // that a token appears somewhere let a rule keep one token property and
      // hard-code the other — which is exactly how drift starts.
      const withoutTokens = rule.replace(/var\(--[\w-]+\)/g, "");
      assert.doesNotMatch(
        withoutTokens,
        /\d+m?s\b/,
        `.${className}, used by ${name}, hard-codes a duration beside its tokens`,
      );
    }
  }
});

/**
 * A tooltip bubble must leave the layout when it is not being shown. Kept in
 * the flow at zero opacity it still counted towards the page's scroll width:
 * measured, the invisible bubble on the sidebar's right-most button made the
 * messenger 393px wide inside a 390px viewport, which the audit reported as
 * clipped content.
 *
 * `display` is what has to change, so the fade needs `allow-discrete` and a
 * `@starting-style` to survive it. All three are asserted together, because
 * the first without the others is a tooltip that appears with no transition
 * at all.
 */
test("a tooltip is out of the layout until it is shown", () => {
  const rest = ruleBody(css, ".kub-tooltip");
  assert.match(rest, /display:\s*none/, "an invisible tooltip must not occupy the layout");

  const shown = ruleBody(css, ".group:hover > .kub-tooltip");
  assert.match(shown, /display:\s*block/);
  assert.match(shown, /opacity:\s*1/);

  assert.match(rest, /allow-discrete/, "the fade is cancelled by display:none without this");
  assert.match(css, /@starting-style\s*\{[\s\S]*?\.kub-tooltip/);
  assert.match(css, /\.group:focus-within > \.kub-tooltip/, "the keyboard must reach it too");
});
