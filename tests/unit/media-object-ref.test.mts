import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import url from "node:url";

import {
  avatarMediaObjectRef,
  formatPublicObjectUrl,
  isSignedObjectUrl,
  mediaObjectRefFromKey,
  mediaObjectRefKey,
  messageMediaObjectRef,
  parsePublicObjectUrl,
  variantMediaObjectRef,
} from "../../artifacts/kub/src/lib/media/mediaObjectRef.ts";

/**
 * D-208. Which object a thing on screen is.
 *
 * The shapes here are the ones production actually holds, read off it on
 * 2026-09-19 and reproduced with invented ids: 294 messages carrying both path
 * columns, 20 carrying only a URL, and 16 avatars — 10 profiles, 6 chats — that
 * have no path column to carry.
 */

const BASE = "https://core.example.invalid";
const PUB = `${BASE}/storage/v1/object/public`;
const OWNER = "3adfd4e6-fff4-4bea-8092-04b62a45a177";
const CHAT = "3b51161f-ca4f-4cb1-a93e-7132abb60718";
const MESSAGE = "9959a148-758e-4424-9dc4-d794bf8aefcc";

test("a message with both path columns is that bucket and that path", () => {
  assert.deepEqual(
    messageMediaObjectRef({
      media_bucket: "media",
      media_path: `${OWNER}/1757000000000-photo.jpg`,
      media_url: `${PUB}/media/${OWNER}/1757000000000-photo.jpg`,
    }),
    { bucket: "media", path: `${OWNER}/1757000000000-photo.jpg` },
  );
});

test("a legacy message carrying only a URL still yields the object", () => {
  // The 20 rows that predate `media_bucket`/`media_path`. Nothing about them is
  // unresolvable — the address they carry is the address the columns would have
  // produced, which was checked against all 294 rows that carry both.
  assert.deepEqual(
    messageMediaObjectRef({
      media_bucket: null,
      media_path: null,
      media_url: `${PUB}/media/${OWNER}/1740000000000-old.mp4`,
    }),
    { bucket: "media", path: `${OWNER}/1740000000000-old.mp4` },
  );
});

test("a path with no bucket beside it is not a reference", () => {
  // Defaulting to "media" here would work today and would quietly follow the
  // default wherever a later migration moved it.
  assert.equal(
    messageMediaObjectRef({ media_bucket: null, media_path: `${OWNER}/x.jpg`, media_url: null }),
    null,
  );
  assert.equal(
    messageMediaObjectRef({ media_bucket: "   ", media_path: `${OWNER}/x.jpg`, media_url: null }),
    null,
  );
});

test("the path columns win over a disagreeing URL", () => {
  assert.deepEqual(
    messageMediaObjectRef({
      media_bucket: "chat-media",
      media_path: "new/place.webp",
      media_url: `${PUB}/media/old/place.webp`,
    }),
    { bucket: "chat-media", path: "new/place.webp" },
  );
});

test("a text message is no object at all", () => {
  assert.equal(messageMediaObjectRef({ media_bucket: null, media_path: null, media_url: null }), null);
  assert.equal(messageMediaObjectRef(null), null);
  assert.equal(messageMediaObjectRef({ media_path: "", media_url: "" }), null);
});

test("a version token belongs to the query, not to the path", () => {
  // `withVersionToken` appends `?v=…` to every avatar and every variant. Cutting
  // the string instead of parsing it would sign a path that does not exist.
  assert.deepEqual(
    parsePublicObjectUrl(`${PUB}/media/variants/profiles/${OWNER}/avatar_128.webp?v=20260903213405`),
    { bucket: "media", path: `variants/profiles/${OWNER}/avatar_128.webp` },
  );
});

test("percent escapes are undone, because getPublicUrl put them there", () => {
  assert.deepEqual(
    parsePublicObjectUrl(`${PUB}/media/${OWNER}/holiday%20photo.jpg`),
    { bucket: "media", path: `${OWNER}/holiday photo.jpg` },
  );
});

test("anything that is not a public object URL is refused", () => {
  for (const url of [
    null,
    undefined,
    "",
    "not a url",
    `${BASE}/storage/v1/object/sign/media/${OWNER}/x.jpg?token=abc`,
    `${PUB}/media`,
    `${PUB}/media/`,
    `${PUB}//leading.jpg`,
    "https://example.com/some/other/image.png",
  ]) {
    assert.equal(parsePublicObjectUrl(url as string | null | undefined), null, String(url));
  }
});

test("a relative address still resolves — the app has served one", () => {
  assert.deepEqual(
    parsePublicObjectUrl(`/storage/v1/object/public/media/avatars/${OWNER}/a.webp`),
    { bucket: "media", path: `avatars/${OWNER}/a.webp` },
  );
});

test("an avatar URL is the only record those three tables keep", () => {
  assert.deepEqual(avatarMediaObjectRef(`${PUB}/media/avatars/${OWNER}/a.webp`), {
    bucket: "media",
    path: `avatars/${OWNER}/a.webp`,
  });
  assert.deepEqual(avatarMediaObjectRef(`${PUB}/media/chat-avatars/${CHAT}/c.webp`), {
    bucket: "media",
    path: `chat-avatars/${CHAT}/c.webp`,
  });
  assert.deepEqual(avatarMediaObjectRef(`${PUB}/media/bot-avatars/${CHAT}/b.webp`), {
    bucket: "media",
    path: `bot-avatars/${CHAT}/b.webp`,
  });
  assert.equal(avatarMediaObjectRef(null), null);
});

test("a variant row names its object directly", () => {
  assert.deepEqual(
    variantMediaObjectRef({
      variant_bucket: "media",
      variant_path: `variants/messages/${CHAT}/${MESSAGE}/image_preview.webp`,
    }),
    { bucket: "media", path: `variants/messages/${CHAT}/${MESSAGE}/image_preview.webp` },
  );
  assert.equal(variantMediaObjectRef({ variant_bucket: null, variant_path: "x" }), null);
  assert.equal(variantMediaObjectRef({ variant_bucket: "media", variant_path: null }), null);
});

test("formatting and parsing are inverses over the shapes production holds", () => {
  for (const path of [
    `${OWNER}/1757000000000-photo.jpg`,
    `avatars/${OWNER}/a.webp`,
    `chat-avatars/${CHAT}/c.webp`,
    `variants/messages/${CHAT}/${MESSAGE}/image_preview.webp`,
    `variants/profiles/${OWNER}/avatar_128.webp`,
    `${OWNER}/holiday photo.jpg`,
  ]) {
    const ref = { bucket: "media", path };
    const url = formatPublicObjectUrl(`${BASE}/storage/v1`, ref);
    assert.deepEqual(parsePublicObjectUrl(url), ref, path);
  }
});

test("a key round-trips, and cannot be confused by a slash in the path", () => {
  const ref = { bucket: "media", path: `variants/messages/${CHAT}/${MESSAGE}/image_thumb.webp` };
  assert.deepEqual(mediaObjectRefFromKey(mediaObjectRefKey(ref)), ref);
  assert.notEqual(mediaObjectRefKey(ref), mediaObjectRefKey({ bucket: "chat-media", path: ref.path }));
  assert.equal(mediaObjectRefFromKey("nothing"), null);
  assert.equal(mediaObjectRefFromKey("media\n"), null);
});

test("the address this file builds is the one supabase-js built before it", async () => {
  // The claim step one rests on: in the shipped `"public"` mode nothing on
  // screen changes. Asserted against the real `getPublicUrl` from the version
  // this package pins, not against a copy of what it is believed to do — that
  // is the difference between "the same shape" and "the same string".
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const require = createRequire(path.resolve(here, "../../artifacts/kub/package.json"));
  const supabase = await import(url.pathToFileURL(require.resolve("@supabase/supabase-js")).href);
  const client = supabase.createClient(BASE, "publishable-fixture");

  for (const [bucket, p] of [
    ["media", `${OWNER}/1757000000000-photo.jpg`],
    ["media", `avatars/${OWNER}/avatar-${MESSAGE}.webp`],
    ["media", `chat-avatars/${CHAT}/avatar-${MESSAGE}.png`],
    ["media", `variants/messages/${CHAT}/${MESSAGE}/image_preview.webp`],
    ["media", `variants/profiles/${OWNER}/avatar_128.webp`],
    ["media", `${OWNER}/holiday photo.jpg`],
    ["chat-media", `${OWNER}/voice_1757000000000.webm`],
  ] as const) {
    const theirs = client.storage.from(bucket).getPublicUrl(p).data.publicUrl;
    const ours = formatPublicObjectUrl(`${BASE}/storage/v1`, { bucket, path: p });
    assert.equal(ours, theirs, p);
    assert.deepEqual(parsePublicObjectUrl(theirs), { bucket, path: p }, p);
  }
});

test("a signed URL is recognisable as one", () => {
  assert.equal(isSignedObjectUrl(`${BASE}/storage/v1/object/sign/media/a/b.jpg?token=x.y.z`), true);
  assert.equal(isSignedObjectUrl(`${PUB}/media/a/b.jpg`), false);
  assert.equal(isSignedObjectUrl(null), false);
});
