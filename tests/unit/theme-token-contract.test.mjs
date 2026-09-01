import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootPath = fileURLToPath(new URL("../../", import.meta.url));
const STYLESHEET = path.join(rootPath, "artifacts/kub/src/index.css");
const SOURCE_ROOT = path.join(rootPath, "artifacts/kub/src");

const TOKEN_DEFINITION = /(--kub-[a-z0-9-]+)\s*:/g;
const TOKEN_REFERENCE = /var\(\s*(--kub-[a-z0-9-]+)/g;
// An inline style object entry, e.g. `"--kub-keyboard-inset": `${n}px``.
const RUNTIME_ASSIGNMENT = /["'](--kub-[a-z0-9-]+)["']\s*:/g;

const css = readFileSync(STYLESHEET, "utf8");

/** The body of the first rule whose selector line matches, braces balanced. */
function ruleBody(selector) {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `missing rule: ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  assert.fail(`unbalanced braces in ${selector}`);
}

function definitionsIn(body) {
  const found = new Map();
  for (const line of body.split("\n")) {
    const match = /^\s*(--kub-[a-z0-9-]+)\s*:\s*([^;]+);/.exec(line);
    if (match) found.set(match[1], match[2].trim());
  }
  return found;
}

function collectMatches(text, pattern) {
  return new Set([...text.matchAll(pattern)].map((match) => match[1]));
}

function sourceFiles(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const next = path.join(directory, entry.name);
    if (entry.isDirectory()) sourceFiles(next, found);
    else if (/\.(ts|tsx|css)$/.test(entry.name)) found.push(next);
  }
  return found;
}

/** Follows `var(--kub-…)` aliases inside one theme so a value can be compared. */
function resolve(value, definitions, depth = 0) {
  if (depth > 8) return value;
  const alias = /^var\(\s*(--kub-[a-z0-9-]+)\s*\)$/.exec(value.trim());
  if (!alias) return value.trim();
  const target = definitions.get(alias[1]);
  if (target === undefined) return value.trim();
  return resolve(target, definitions, depth + 1);
}

const darkTokens = definitionsIn(ruleBody(".dark"));
const lightTokens = definitionsIn(ruleBody(".light"));

test("every referenced theme token is actually defined", () => {
  const defined = collectMatches(css, TOKEN_DEFINITION);

  // Some tokens are legitimately supplied at runtime through an inline style
  // object rather than by the stylesheet, such as the video progress angle and
  // the Android keyboard inset. Those count as defined.
  const assignedAtRuntime = new Set();
  const files = sourceFiles(SOURCE_ROOT);
  for (const file of files) {
    for (const token of collectMatches(readFileSync(file, "utf8"), RUNTIME_ASSIGNMENT)) {
      assignedAtRuntime.add(token);
    }
  }

  const missing = [];
  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    for (const token of collectMatches(contents, TOKEN_REFERENCE)) {
      if (defined.has(token) || assignedAtRuntime.has(token)) continue;
      missing.push(`${path.relative(rootPath, file)} references ${token}`);
    }
  }

  // An undefined custom property makes the declaration resolve to nothing
  // rather than failing, so this class of defect is invisible until someone
  // looks at the pixels. `--kub-message-in` was referenced by the incoming
  // message bubble, the selection highlight and the typing indicator while
  // never being defined, which left every incoming bubble with no background.
  assert.deepEqual(missing, [], "these theme tokens are used but never defined");
});

test("the dark and light themes define the same token set", () => {
  const onlyDark = [...darkTokens.keys()].filter((token) => !lightTokens.has(token));
  const onlyLight = [...lightTokens.keys()].filter((token) => !darkTokens.has(token));

  assert.deepEqual(onlyDark, [], "tokens defined only for the dark theme");
  assert.deepEqual(onlyLight, [], "tokens defined only for the light theme");
});

for (const [themeName, definitions] of [["dark", darkTokens], ["light", lightTokens]]) {
  test(`${themeName} message bubbles are distinguishable from the chat background`, () => {
    const background = resolve(definitions.get("--kub-bg") ?? "", definitions);
    assert.notEqual(background, "", `${themeName} does not define --kub-bg`);

    for (const token of ["--kub-message-in", "--kub-message-out"]) {
      const value = definitions.get(token);
      assert.ok(value !== undefined, `${themeName} does not define ${token}`);

      const resolved = resolve(value, definitions);
      assert.ok(resolved.length > 0, `${themeName} ${token} resolves to nothing`);
      assert.notEqual(
        resolved.toLowerCase(),
        background.toLowerCase(),
        `${themeName} ${token} is the same colour as the chat background, so the bubble would be invisible`,
      );
    }
  });
}

test("message bubbles carry no decorative element positioned outside their box", () => {
  // The bubble tails were CSS border triangles at a negative offset. The message
  // row gap is 6px and the triangle was 9px wide, so an incoming tail always
  // landed on the sender avatar, and because it was a bare triangle it could not
  // carry the bubble's border.
  assert.doesNotMatch(css, /\.bubble-(in|out)::after/, "the overlapping bubble tail rules are back");

  const bubble = readFileSync(
    path.join(SOURCE_ROOT, "components/chat/MessageBubble.tsx"),
    "utf8",
  );
  assert.doesNotMatch(bubble, /"bubble-(in|out)"/, "MessageBubble still applies the tail classes");
});

test("the stylesheet is reachable and non-trivial", () => {
  assert.ok(statSync(STYLESHEET).size > 1000, "index.css looks truncated");
  assert.ok(darkTokens.size > 10 && lightTokens.size > 10, "theme blocks were not parsed");
});
