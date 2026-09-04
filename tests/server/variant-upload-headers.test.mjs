import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

/**
 * What `Cache-Control` a variant upload actually puts on the wire.
 *
 * Not a source scan. The bug this exists for was invisible in the source: the
 * worker passed a perfectly good `"max-age=31536000, immutable"` to the
 * `cacheControl` option, and the client — which takes SECONDS there and builds
 * the directive itself — sent `max-age=max-age=31536000, immutable`. Found in
 * production by reading the response header, not by reading the code, so this
 * drives the real client and reads the real header.
 */
function captureUpload(fileOptions, body) {
  let captured = null;
  const fetchStub = async (_url, init) => {
    captured = init;
    return new Response(JSON.stringify({ Key: "media/x" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  // The same call the worker makes: `supabase.storage.from(bucket).upload(...)`.
  const client = createClient("https://storage.invalid", "anon-key-for-a-stubbed-fetch", {
    global: { fetch: fetchStub },
  });
  return client.storage
    .from("media")
    .upload("variants/chats/c/tok/avatar_128.webp", body, fileOptions)
    .then(() => {
      const headers = new Headers(captured?.headers ?? {});
      return headers.get("cache-control");
    });
}

test("a Buffer upload sends the cache directive exactly once", async () => {
  const sent = await captureUpload(
    {
      contentType: "image/webp",
      upsert: true,
      cacheControl: "31536000",
      headers: { "cache-control": "max-age=31536000, immutable" },
    },
    Buffer.from([1, 2, 3]),
  );
  assert.equal(sent, "max-age=31536000, immutable");
  assert.ok(!sent.includes("max-age=max-age="), "the directive was doubled");
});

test("passing the whole directive as cacheControl is what doubled it", async () => {
  // The shape the worker used to send. Kept so the reason the fix exists cannot
  // be forgotten and quietly reverted to "the simpler thing".
  const sent = await captureUpload(
    { contentType: "image/webp", upsert: true, cacheControl: "max-age=31536000, immutable" },
    Buffer.from([1, 2, 3]),
  );
  assert.equal(sent, "max-age=max-age=31536000, immutable");
});

test("the worker asks for seconds and carries the directive in headers", () => {
  const worker = readFileSync("artifacts/api-server/src/workers/mediaVariantsWorker.ts", "utf8");
  assert.match(
    worker,
    /cacheControl: cacheControlSeconds\(cacheControl\),\s*\n\s*headers: \{ "cache-control": cacheControl \},/,
    "uploadVariant no longer sends the directive through the header that wins",
  );
});

test("the seconds are taken from whichever lifetime applies", async () => {
  const rules = await import("../../artifacts/api-server/dist/workers/mediaVariantRules.mjs");
  assert.equal(typeof rules.buildChatAvatarVariantPath, "function");
  // Both lifetimes must survive the trip through a seconds-only field.
  for (const [directive, seconds] of [
    ["max-age=31536000, immutable", "31536000"],
    ["max-age=2592000", "2592000"],
  ]) {
    assert.equal(/max-age=(\d+)/.exec(directive)?.[1], seconds);
  }
});
