import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * D-017: the entry document must be revalidated, the hashed assets must not.
 *
 * `index.html` names the hashed asset filenames, so it decides which build a
 * client runs. It had no `Cache-Control` at all, leaving freshness to a browser
 * heuristic — and the Windows shell duly held an old `index.html` across a
 * deploy and kept loading the previous bundle while the fix sat live on the
 * server. The configuration already reasons this way about `sw.js`; the entry
 * document needed the same treatment.
 */

const config = readFileSync(new URL("../../docs/deploy/nginx.conf", import.meta.url), "utf8");

function block(matcher) {
  const start = config.search(matcher);
  assert.ok(start >= 0, `no location block matched ${matcher}`);
  const end = config.indexOf("\n  }", start);
  assert.ok(end > start, "the location block is not closed");
  return config.slice(start, end);
}

test("the entry document is revalidated on every load", () => {
  const entry = block(/location\s*=\s*\/index\.html\s*\{/);
  assert.match(
    entry,
    /Cache-Control\s+"no-cache/,
    "index.html must carry an explicit no-cache directive, not rely on a heuristic",
  );
});

test("hashed assets stay immutable, so the fix costs nothing in traffic", () => {
  const assets = block(/location\s+\/assets\/\s*\{/);
  assert.match(assets, /immutable/, "hashed assets must remain immutable");
  assert.match(assets, /expires\s+1y/);
});

test("the service worker keeps its own no-cache rule", () => {
  const worker = block(/location\s*=\s*\/sw\.js\s*\{/);
  assert.match(worker, /no-cache/);
  assert.match(worker, /no-store/);
});

test("the entry document is not accidentally cached by a broader rule", () => {
  // A `location /` that set a long max-age would defeat the block above, since
  // the SPA fallback serves index.html for arbitrary paths.
  const fallback = block(/location\s+\/\s*\{/);
  assert.doesNotMatch(
    fallback,
    /max-age=\d{3,}/,
    "the SPA fallback must not apply a long cache to the documents it serves",
  );
});
