import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import ts from "typescript";

import {
  modeAllowsPublicFallback,
  modeSignsUrls,
  resolveMediaUrlMode,
} from "../../artifacts/kub/src/lib/media/mediaUrlMode.ts";

/**
 * D-208: the switch that keeps the four steps in an order that cannot be
 * reversed, and the contract that there is only one place to throw it.
 */

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../artifacts/kub/src");
const RESOLVER = path.join(SRC, "lib/media/mediaUrl.ts");

test("an absent, empty or unrecognised flag is the shipped behaviour", () => {
  // A misread flag must fail towards what is on screen today. The alternative
  // is a typo in a Coolify field blanking every picture in the product.
  for (const env of [
    undefined,
    null,
    {},
    { VITE_MEDIA_SIGNED_URLS: "" },
    { VITE_MEDIA_SIGNED_URLS: "   " },
    { VITE_MEDIA_SIGNED_URLS: "yes" },
    { VITE_MEDIA_SIGNED_URLS: "0" },
    { VITE_MEDIA_SIGNED_URLS: "public" },
    { VITE_MEDIA_SIGNED_URLS: true },
    { VITE_MEDIA_SIGNED_URLS: 1 },
  ]) {
    assert.equal(resolveMediaUrlMode(env as never), "public", JSON.stringify(env));
  }
});

test("the two ways of asking for signatures", () => {
  for (const value of ["signed", "1", "true", "  SIGNED  "]) {
    assert.equal(resolveMediaUrlMode({ VITE_MEDIA_SIGNED_URLS: value }), "signed", value);
  }
  for (const value of ["signed-only", "only", "strict", "SIGNED-ONLY"]) {
    assert.equal(resolveMediaUrlMode({ VITE_MEDIA_SIGNED_URLS: value }), "signed-only", value);
  }
});

test("only the middle mode may fall back to a public URL", () => {
  // The whole ordering of D-208 rests on this row. `signed` is the state in
  // which the mechanism can be turned on and measured while the bucket is still
  // public and nothing has left the screen; `signed-only` is what step four
  // needs, and what a private bucket enforces whatever the flag says.
  assert.equal(modeSignsUrls("public"), false);
  assert.equal(modeAllowsPublicFallback("public"), false);

  assert.equal(modeSignsUrls("signed"), true);
  assert.equal(modeAllowsPublicFallback("signed"), true);

  assert.equal(modeSignsUrls("signed-only"), true);
  assert.equal(modeAllowsPublicFallback("signed-only"), false);
});

/**
 * Source with comments, string contents and regex literals blanked, so prose
 * cannot match.
 *
 * Parsed rather than pattern-matched, and that is not a tidy-up. The five
 * regexes this replaces removed 96% of `MessageBubble.tsx` — 104,952 characters
 * down to 3,989 — and with them every `href={…}` in the file, because the last
 * of them,
 *
 *     .replace(/`(?:[^`\\]|\\.)*`/g, "``")
 *
 * cannot see that template literals nest: `` `${cond ? `a` : `b`}` `` has four
 * backticks and the naive pairing joins the wrong two. One bite swallowed
 * 15,136 characters of real code. So the three guards below have been scanning
 * a shadow of that file since they were written, and the scan added with the
 * originals reported a clean tree while a column sat in an `href` — which is
 * how this was found: by a mutation that should have gone red and did not.
 *
 * A hand-rolled scanner is not enough either, and that was measured too. One
 * was written first and fell over on line 111 of the same file, where a regex
 * character class contains a backtick:
 *
 *     /[`~./\\()[\]{}<>#@░▒▓█─│┌┐└┘]/g
 *
 * It read that backtick as the start of a template literal and every frame
 * after it was out of phase. Knowing where a `/` begins a regex rather than a
 * division is the whole difficulty, and the compiler that already builds this
 * project knows. So the compiler is asked: the literals it identifies are
 * blanked in place — offsets preserved, delimiters kept — and only then are
 * comments removed, which is safe because no `/*` or `//` can survive inside a
 * blanked literal.
 */
function code(file: string): string {
  const raw = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const blanks: Array<[number, number]> = [];
  const visit = (node: ts.Node): void => {
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
      case ts.SyntaxKind.RegularExpressionLiteral:
      case ts.SyntaxKind.JsxText:
        // The delimiters stay so the shape of the code is unchanged; only what
        // is between them goes.
        blanks.push([node.getStart(source), node.getEnd()]);
        return;
      default:
        ts.forEachChild(node, visit);
    }
  };
  ts.forEachChild(source, visit);

  const chars = [...raw];
  for (const [from, to] of blanks) {
    for (let i = from + 1; i < to - 1; i += 1) chars[i] = chars[i] === "\n" ? "\n" : " ";
  }
  return chars.join("")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
  };
  walk(SRC);
  return out;
}

test("the client builds a public media URL in exactly one place", () => {
  // The point of step one. A defect whose fix is "stop doing X" cannot be
  // verified finished while X is written in seven places — and a count is not
  // the assertion here, the *location* is: a new call anywhere else fails this
  // whatever the total happens to be.
  //
  // Comments and string literals are stripped first: this file and four others
  // discuss `getPublicUrl` in prose, and a grep that matches a doc comment has
  // cost this project a cycle before.
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    if (file === RESOLVER) continue;
    if (code(file).includes("getPublicUrl")) offenders.push(path.relative(SRC, file));
  }
  assert.deepEqual(offenders, [], `getPublicUrl outside lib/media/mediaUrl.ts: ${offenders.join(", ")}`);

  const resolver = code(RESOLVER);
  const count = resolver.split("getPublicUrl").length - 1;
  assert.equal(count, 1, "the resolver itself holds exactly one call");
});

test("the resolver is the only client module that mints a signature", () => {
  // A second `createSignedUrls` would be a second lifetime policy, and a URL
  // whose expiry nothing tracks is precisely the failure this step exists to
  // avoid.
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    if (file === RESOLVER) continue;
    if (code(file).includes("createSignedUrl")) offenders.push(path.relative(SRC, file));
  }
  assert.deepEqual(offenders, [], `createSignedUrl(s) outside the resolver: ${offenders.join(", ")}`);
});

test("no module assembles a storage address out of string parts", () => {
  // `botAvatar.ts` used to carry its own `/storage/v1/object/public/media/`
  // prefix for recognising one of its own uploads. Recognising is fine;
  // building is not, and the two look identical in a diff.
  const allowed = new Set([
    path.join(SRC, "lib/media/mediaObjectRef.ts"),
    path.join(SRC, "lib/botAvatar.ts"),
  ]);
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    if (allowed.has(file)) continue;
    const raw = fs.readFileSync(file, "utf8");
    // The literal survives the string-stripping above, so the raw text is read
    // and comments alone are removed.
    const withoutComments = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    if (withoutComments.includes("/storage/v1/object/")) offenders.push(path.relative(SRC, file));
  }
  assert.deepEqual(offenders, [], `hand-built storage address: ${offenders.join(", ")}`);
});
/* --------------------------------------------------------------------------- *
 * The originals, whose address was never built — it was read out of a column.
 * --------------------------------------------------------------------------- */

/**
 * Every place a string is handed to the browser as an address.
 *
 * Three shapes, because the originals reach the browser in three ways and not
 * one: an element attribute (`<img src>`, `<a href>`, `<video poster>`), the
 * `url` of an object the viewer or the mini-player is given, and the first
 * argument of a helper that fetches the bytes.
 *
 * Passing a whole *row* to a component is not on this list and must not be —
 * `<UserAvatar user={{ …, avatar_url }} />` is correct, and `AvatarImage`
 * resolves it. What is forbidden is the column arriving where only an address
 * belongs.
 */
const ADDRESS_SINKS = [
  /\b(?:src|href|poster)=\{([^}]*)\}/g,
  /\burl:\s*([^,\n]*)/g,
  /\b(?:copyImageToClipboard|saveMediaAs|fetch)\(\s*([^,)\n]*)/g,
];

test("a stored column never reaches the browser as an address", () => {
  // The other half of step one, and the half the register's own list of seven
  // call sites did not cover. The seven were `getPublicUrl` calls; these shapes
  // never called it, because the address was already sitting in
  // `messages.media_url` or in an `avatar_url`, written months ago by somebody
  // else's `getPublicUrl`. A column is a public URL with no expiry and no
  // revocation, which is the defect itself — so it may be read, compared,
  // searched and tested for presence, but it may not become a `src`.
  //
  // Comments are stripped first: several files discuss these columns in prose,
  // and a grep that matches a doc comment has cost this project a cycle before.
  const offenders: string[] = [];
  let examined = 0;
  for (const file of sourceFiles()) {
    const stripped = code(file);
    for (const sink of ADDRESS_SINKS) {
      for (const match of stripped.matchAll(sink)) {
        examined += 1;
        const expression = match[1] ?? "";
        if (!/\bmedia_url\b|\bavatar_url\b/.test(expression)) continue;
        offenders.push(`${path.relative(SRC, file)}: ${expression.trim().slice(0, 60)}`);
      }
    }
  }
  // An empty result means nothing unless the probe is known to match something.
  // This scan reported a clean tree for its first run while a column sat in an
  // `href`, because `code` had eaten the file it was in; the count is what
  // turns "found nothing" into "looked, and found nothing". Measured at 122 on
  // the tree this was written against — a number read off a run rather than
  // guessed, the first guess having been 344 — so the floor is well below it
  // and only trips if the scan has stopped seeing the product.
  assert.ok(
    examined > 80,
    `the scan examined only ${examined} addresses; it is no longer reaching the components`,
  );
  // Measured rather than asserted blind: the same scan run against `HEAD` before
  // this change reported nine — four in `MessageBubble`, two in
  // `ChatInfoPanel`, three in `MessageList` — which is what makes an empty list
  // here evidence rather than a probe that matches nothing.
  assert.deepEqual(offenders, [], `a column used as an address: ${offenders.join("; ")}`);
});
