import assert from "node:assert/strict";

/**
 * Reading `artifacts/kub/src/index.css` without assuming how deeply a rule is
 * nested.
 *
 * Every test here used to delimit a rule with `/\.name\s*\{([\s\S]*?)\n\}/` —
 * "up to the first closing brace at the start of a line". That worked only
 * while the application's classes sat at column zero. They now live in
 * `@layer components`, so a rule's own brace is indented and the first
 * column-zero brace closes the whole layer: the extraction silently returned
 * the rest of the file. One test failed outright; five more kept passing on
 * over-captured text, which is worse, because a contract they no longer checked
 * still reported green.
 *
 * So extents are found by balancing braces, and a rule is identified by its
 * selector list plus the at-rule chain it sits under. Comments are removed
 * first: a selector or a colour named in prose is not a declaration, and this
 * file has a great deal of prose.
 */

/** Blank out `/* … *\/` comments, preserving offsets and line breaks. */
export function stripCssComments(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    if (css[i] === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end < 0 ? css.length : end + 2;
      out += css.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    out += css[i];
    i += 1;
  }
  return out;
}

/** Index just past the `}` matching the `{` at `open`. */
function matchBrace(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Every style rule in the sheet, with the at-rule preludes enclosing it.
 * `@keyframes` bodies are skipped: their `from`/`to`/percentage blocks are not
 * style rules and would answer to selector queries they have nothing to do with.
 */
export function parseRules(css) {
  const source = stripCssComments(css);
  const rules = [];

  const walk = (start, end, at, layer) => {
    let i = start;
    let preludeStart = start;
    while (i < end) {
      const c = source[i];
      if (c === ";") {
        i += 1;
        preludeStart = i;
        continue;
      }
      if (c !== "{") {
        i += 1;
        continue;
      }
      const close = matchBrace(source, i);
      assert.notEqual(close, -1, "unbalanced braces in the stylesheet");
      const prelude = source.slice(preludeStart, i).trim().replace(/\s+/g, " ");
      if (/^@keyframes\b/.test(prelude)) {
        // not style rules
      } else if (/^@layer\b/.test(prelude)) {
        walk(i + 1, close, at, prelude.slice("@layer".length).trim());
      } else if (prelude.startsWith("@")) {
        walk(i + 1, close, [...at, prelude], layer);
      } else if (prelude) {
        rules.push({
          selectors: prelude.split(",").map((s) => s.trim()),
          body: source.slice(i + 1, close),
          at,
          layer,
          line: source.slice(0, preludeStart).split("\n").length,
        });
      }
      i = close + 1;
      preludeStart = i;
    }
  };

  walk(0, source.length, [], null);
  return rules;
}

/**
 * The declarations of the one rule whose selector list contains `selector`.
 *
 * `at` filters by the at-rule context: omit it for a rule that must stand
 * outside every conditional, or pass a RegExp that the enclosing preludes must
 * satisfy. More than one match is refused rather than resolved by taking the
 * first — a landmark that cannot say which rule it means is not a landmark.
 */
export function ruleBody(css, selector, at = null) {
  const hits = parseRules(css).filter(
    (rule) =>
      rule.selectors.includes(selector) &&
      (at === null ? rule.at.length === 0 : rule.at.some((prelude) => at.test(prelude))),
  );
  assert.equal(
    hits.length,
    1,
    `${selector}${at ? ` under ${at}` : " outside any at-rule"} matches ${hits.length} rules, not 1`,
  );
  return hits[0].body;
}

/** True when the sheet has a rule for `selector` in the given context. */
export function hasRule(css, selector, at = null) {
  return parseRules(css).some(
    (rule) =>
      rule.selectors.includes(selector) &&
      (at === null ? rule.at.length === 0 : rule.at.some((prelude) => at.test(prelude))),
  );
}

function eachAtRule(css, prelude, visit) {
  const source = stripCssComments(css);
  const re = /@[a-z-]+[^{;]*\{/gi;
  let match;
  while ((match = re.exec(source))) {
    const open = match.index + match[0].length - 1;
    const close = matchBrace(source, open);
    if (close === -1) continue;
    const head = match[0].slice(0, -1).trim().replace(/\s+/g, " ");
    if (prelude.test(head)) visit({ source, start: match.index, open, close });
  }
  return source;
}

/**
 * The inner text of every at-rule whose prelude matches, with the layer wrapper
 * seen through: `@media (pointer: coarse)` finds both the block inside
 * `@layer components` and the one outside it.
 */
export function atRuleTexts(css, prelude) {
  const out = [];
  eachAtRule(css, prelude, ({ source, open, close }) => out.push(source.slice(open + 1, close)));
  return out;
}

/**
 * The sheet with every matching at-rule removed, for the negative half of a
 * pair — "this size exists only on a coarse pointer". Deleting by regex up to
 * the first column-zero brace removed the rest of the enclosing layer instead,
 * which made those assertions pass on an almost empty string.
 */
export function withoutAtRules(css, prelude) {
  const spans = [];
  const source = eachAtRule(css, prelude, ({ start, close }) => spans.push([start, close + 1]));
  let out = "";
  let cursor = 0;
  for (const [start, end] of spans.sort((a, b) => a[0] - b[0])) {
    if (start < cursor) continue;
    out += source.slice(cursor, start);
    cursor = end;
  }
  return out + source.slice(cursor);
}
