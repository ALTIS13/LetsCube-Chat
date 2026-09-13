// Is the Edge Function on the server the one in this repository?
//
// The push function was seven weeks stale and missing its whole Windows sender
// before anybody asked (D-185). These tests pin the three answers that matter:
// a file that is not deployed, one deployed with different bytes, and one on the
// server that is not here at all — which is how three directories came to be
// serving `index.ts.bak.20260622*` beside the real thing.
import assert from "node:assert/strict";
import test from "node:test";

import {
  compareManifests,
  parseManifest,
  RUNTIME_OWNED,
} from "../../scripts/function-inventory.mjs";

const A = "a".repeat(64);
const B = "b".repeat(64);

test("a manifest line is a hash and a path, and anything else is ignored", () => {
  const parsed = parseManifest(
    [
      `${A}  voice-gateway/index.ts`,
      `${B} *support-gateway/index.ts`, // the marker Windows sha256sum prints
      "not a manifest line at all",
      "",
      `${A.slice(0, 10)}  too-short/hash.ts`,
    ].join("\n"),
  );

  assert.equal(parsed.size, 2);
  assert.equal(parsed.get("voice-gateway/index.ts"), A);
  assert.equal(parsed.get("support-gateway/index.ts"), B);
});

test("a file that is here and not there is reported as not deployed", () => {
  const result = compareManifests(
    parseManifest(`${A}  send-push-notifications/wns.ts`),
    parseManifest(""),
  );
  assert.deepEqual(result.missing, ["send-push-notifications/wns.ts"]);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.extra, []);
});

test("a file deployed with other bytes is reported as different", () => {
  const result = compareManifests(
    parseManifest(`${A}  send-push-notifications/index.ts`),
    parseManifest(`${B}  send-push-notifications/index.ts`),
  );
  assert.deepEqual(result.changed, ["send-push-notifications/index.ts"]);
  assert.deepEqual(result.missing, []);
});

test("a file on the server and not here is reported, not ignored", () => {
  // `auth-yandex-gateway/index.ts.bak.20260622041008` and two like it were
  // sitting inside a directory the runtime serves.
  const result = compareManifests(
    parseManifest(`${A}  auth-yandex-gateway/index.ts`),
    parseManifest(
      [
        `${A}  auth-yandex-gateway/index.ts`,
        `${B}  auth-yandex-gateway/index.ts.bak.20260622041008`,
      ].join("\n"),
    ),
  );
  assert.deepEqual(result.extra, ["auth-yandex-gateway/index.ts.bak.20260622041008"]);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.changed, []);
});

test("identical manifests report nothing at all", () => {
  const manifest = [`${A}  voice-gateway/index.ts`, `${B}  voice-gateway/roomName.mjs`].join("\n");
  const result = compareManifests(parseManifest(manifest), parseManifest(manifest));
  assert.deepEqual(result, { missing: [], changed: [], extra: [] });
});

test("the runtime's own functions are not this repository's to compare", () => {
  // `main` routes and `hello` is the runtime's example; naming them would report
  // a difference on every single run and teach everybody to ignore the output.
  assert.ok(RUNTIME_OWNED.has("main"));
  assert.ok(RUNTIME_OWNED.has("hello"));
  assert.ok(!RUNTIME_OWNED.has("voice-gateway"));
});
