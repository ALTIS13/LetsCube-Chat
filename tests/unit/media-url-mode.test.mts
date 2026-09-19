import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

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

/** Source with comments and string literals removed, so prose cannot match. */
function code(file: string): string {
  const raw = fs.readFileSync(file, "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
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
