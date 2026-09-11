import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseRules } from "./helpers/css.mjs";

/**
 * The opaque fallback is for a browser that cannot frost at all.
 *
 * Both glass surfaces — `.kub-glass` / `.kub-glass-strong` and `.kub-panel` —
 * swap their translucent fill for an opaque one under an `@supports not (…)`.
 * The condition used to name only the unprefixed `backdrop-filter`. Safari
 * before 18 frosts only through `-webkit-backdrop-filter`, so read literally
 * that condition put a flat fill on every iPhone still on iOS 17 while the
 * prefixed material rendered fine underneath it.
 *
 * Measured before changing it: the stylesheet actually served in production
 * already carried `not ((-webkit-backdrop-filter:blur(1px)) or
 * (backdrop-filter:blur(1px)))`, because Lightning CSS adds the prefixed
 * branch for the browsers in the build's target list. So this is insurance
 * rather than a repair — the source now says what the shipped file says,
 * instead of depending on a target list to say it.
 */

const css = readFileSync(new URL("../../artifacts/kub/src/index.css", import.meta.url), "utf8");

const NORMALISED = "not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))";

/** `@supports` preludes are compared with the spacing around brackets taken out. */
const squeeze = (prelude) => prelude.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();

for (const selector of [".kub-glass", ".kub-glass-strong", ".kub-panel"]) {
  test(`${selector} falls back to an opaque fill only where neither spelling frosts`, () => {
    const fallbacks = parseRules(css).filter(
      (rule) => rule.selectors.includes(selector) && rule.at.some((prelude) => /backdrop-filter/.test(prelude)),
    );
    assert.equal(fallbacks.length, 1, `${selector} has ${fallbacks.length} no-frosting fallbacks, not 1`);

    const conditions = fallbacks[0].at.filter((prelude) => /backdrop-filter/.test(prelude));
    assert.equal(conditions.length, 1);
    assert.equal(
      squeeze(conditions[0].replace(/^@supports\s+/, "")),
      squeeze(NORMALISED),
      `${selector}'s fallback fires on "${conditions[0]}"; a browser that frosts through one spelling would lose the material`,
    );
  });
}
