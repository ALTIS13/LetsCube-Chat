import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  MAX_MESSAGE_LENGTH,
  asCode,
  clampMessage,
  survivesFormatting,
  untrusted,
} from "../../artifacts/pocketflow/src/lib/render.ts";

/**
 * Gap G-5: the client formats every message, and there is no `parse_mode`.
 *
 * `lib/render.ts` was written against the grammar in
 * `artifacts/kub/src/lib/formatText.tsx`. That file belongs to the messenger,
 * not to PocketFlow, and it can change — so the first test here reads it and
 * fails if the grammar it was written against is no longer the grammar in
 * force. A comment saying «verified on 2026-09-19» would not do that.
 */

const FORMAT_TEXT = path.resolve(
  import.meta.dirname,
  "../../artifacts/kub/src/lib/formatText.tsx",
);

/**
 * The rules `render.ts` assumes, recorded as literals.
 *
 * Deliberately the regex **sources**, not a paraphrase: a change to the body
 * of the code pattern — say, allowing a newline inside a span — would silently
 * invalidate `asCode`'s per-line strategy, and nothing else in this repository
 * would notice.
 */
const ASSUMED_PATTERNS = [
  { name: "code", source: "`([^`\\n]+?)`" },
  { name: "strike", source: "~~([^~\\n]+?)~~" },
  { name: "bold", source: "\\*\\*([^*\\n]+?)\\*\\*" },
  { name: "italic", source: "\\*([^*\\n]+?)\\*" },
];

function readClientPatterns(): { name: string; source: string }[] {
  const source = readFileSync(FORMAT_TEXT, "utf8");
  const block = /const PATTERNS = \[([\s\S]*?)\] as const;/.exec(source);
  assert.ok(block, "PATTERNS not found in formatText.tsx — the client's formatter was restructured");
  const entries: { name: string; source: string }[] = [];
  const line = /\{\s*name:\s*"([a-z]+)",\s*re:\s*\/((?:[^/\\]|\\.)+)\//g;
  let match: RegExpExecArray | null;
  while ((match = line.exec(block[1] ?? "")) !== null) {
    entries.push({ name: match[1] ?? "", source: match[2] ?? "" });
  }
  return entries;
}

test("the client's formatting grammar is still the one render.ts was written against", () => {
  const actual = readClientPatterns();
  for (const assumed of ASSUMED_PATTERNS) {
    const found = actual.find((entry) => entry.name === assumed.name);
    assert.ok(
      found,
      `the client no longer has a "${assumed.name}" rule — re-check artifacts/pocketflow/src/lib/render.ts`,
    );
    assert.equal(
      found.source,
      assumed.source,
      `the client's "${assumed.name}" rule changed — re-check artifacts/pocketflow/src/lib/render.ts`,
    );
  }
  // The order matters as much as the rules: `code` is matched first, and that
  // is the whole reason a backtick span shields its contents.
  assert.equal(actual[0]?.name, "code", "code is no longer matched first — asCode is no longer safe");
});

/**
 * A minimal stand-in for the client's tokenizer, built from the patterns above.
 *
 * It only has to answer one question — what text does a reader end up seeing —
 * so it applies the rules per line, first match wins, and returns the visible
 * characters. If this and the real renderer ever disagree, the test above is
 * what catches it.
 */
function visibleText(input: string): string {
  const patterns = ASSUMED_PATTERNS.map((entry) => ({
    name: entry.name,
    re: new RegExp(entry.source),
  }));
  return input
    .split("\n")
    .map((line) => {
      let rest = line;
      let out = "";
      for (;;) {
        let best: { start: number; length: number; inner: string } | null = null;
        for (const { re } of patterns) {
          const match = re.exec(rest);
          if (!match) continue;
          if (best && match.index >= best.start) continue;
          best = { start: match.index, length: match[0].length, inner: match[1] ?? "" };
        }
        if (!best) return out + rest;
        out += rest.slice(0, best.start) + best.inner;
        rest = rest.slice(best.start + best.length);
      }
    })
    .join("\n");
}

test("the stand-in tokenizer reproduces the problem asCode exists to solve", () => {
  // Without help, a pair of asterisks disappears and the text between them is
  // italicised — this is the defect, asserted so the fix below is not vacuous.
  assert.equal(visibleText("статус *DOWN* сейчас"), "статус DOWN сейчас");
  assert.equal(visibleText("~~снято~~"), "снято");
  assert.equal(visibleText("**важно**"), "важно");
});

test("asCode makes formatting characters survive", () => {
  for (const original of [
    "статус *DOWN* сейчас",
    "~~снято~~",
    "**важно**",
    "path/to/file_name_with_underscores",
    "a*b*c~~d~~e**f**",
  ]) {
    assert.equal(visibleText(asCode(original)), original, `mangled: ${original}`);
  }
});

test("asCode is lossless around backticks, which cannot be inside a span", () => {
  const original = "he said `hello` twice";
  assert.equal(visibleText(asCode(original)), original);
});

test("asCode keeps line structure and leaves empty lines alone", () => {
  const original = "первая\n\nтретья *звезда*";
  const wrapped = asCode(original);
  assert.equal(wrapped.split("\n").length, 3);
  assert.equal(wrapped.split("\n")[1], "", "an empty line must not become two backticks");
  assert.equal(visibleText(wrapped), original);
});

test("survivesFormatting answers about the three characters that can vanish", () => {
  assert.equal(survivesFormatting("обычный текст"), true);
  assert.equal(survivesFormatting("https://example.com/a_b"), true);
  assert.equal(survivesFormatting("@someone"), true);
  assert.equal(survivesFormatting("a*b"), false);
  assert.equal(survivesFormatting("a~b"), false);
  assert.equal(survivesFormatting("a`b"), false);
});

test("untrusted leaves clean text untouched and wraps the rest", () => {
  assert.equal(untrusted("Production API"), "Production API");
  assert.equal(visibleText(untrusted("Production *API*")), "Production *API*");
});

test("untrusted stops one field from reformatting the rest of the line", () => {
  // The real failure: a stray asterisk in one value italicises everything up
  // to the next asterisk, which may be an entirely different field.
  const line = `Сервис: ${untrusted("api*prod")} · Статус: ${untrusted("DOWN*")}`;
  assert.match(visibleText(line), /api\*prod/);
  assert.match(visibleText(line), /DOWN\*/);
});

test("clampMessage never returns more than the platform accepts", () => {
  const long = "строка\n".repeat(2000);
  const clamped = clampMessage(long);
  assert.ok(clamped.length <= MAX_MESSAGE_LENGTH, `${clamped.length} > ${MAX_MESSAGE_LENGTH}`);
  assert.match(clamped, /обрезано/);
});

test("clampMessage leaves a short message exactly alone", () => {
  assert.equal(clampMessage("коротко"), "коротко");
});

test("clampMessage does not throw away most of the text to find a line break", () => {
  // One very long line followed by a newline near the start: preferring the
  // line boundary here would discard almost everything.
  const text = `${"a".repeat(10)}\n${"b".repeat(6000)}`;
  const clamped = clampMessage(text, 200);
  assert.ok(clamped.length > 100, `kept only ${clamped.length} characters`);
});
