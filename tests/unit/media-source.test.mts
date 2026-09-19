import assert from "node:assert/strict";
import test from "node:test";

import {
  avatarMediaSource,
  messageMediaSource,
} from "../../artifacts/kub/src/lib/media/mediaSource.ts";

/**
 * D-208, step two: the rule that decides where an *original's* address comes
 * from.
 *
 * This is the whole risk of routing the originals. The variants had no choice —
 * a `media_variants` row carries a bucket and a path and no URL — but a
 * message's photograph, video, voice message and file, and every avatar in the
 * product, have the address sitting in a column as well. Picking the wrong one
 * in the default mode changes what is on screen, which is the one thing this
 * work promises not to do.
 *
 * The rule lives in a module that imports nothing but two other pure modules,
 * so it is reachable from `node --test`. `lib/media/mediaUrl.ts` is not: it
 * reads `import.meta.env` and imports supabase-js. That is the same split
 * `lib/supabase/config.ts` was made for, and for the same reason — a decision
 * that cannot be reached from a test is a gap in the module boundary, not in
 * the suite.
 */

const PUBLIC = "https://core.letscube.ru/storage/v1/object/public/media";
const OWNER = "3adfd4e6-fff4-4bea-8092-04b62a45a177";
const PATH = `${OWNER}/1757000000000-photo.jpg`;
const URL_FOR_PATH = `${PUBLIC}/${PATH}`;

const ROW = { media_bucket: "media", media_path: PATH, media_url: URL_FOR_PATH };

test("public mode hands back the column, not a rebuilt address", () => {
  // Not a preference: the column may carry a query string this client did not
  // put there, and `media_url` is what every one of these shapes reads today.
  // Rebuilding would be *probably* identical — measured as identical on all 294
  // production rows that carry both — and "probably identical" is not the
  // promise the default mode owes.
  assert.deepEqual(messageMediaSource(ROW, "public"), { kind: "stored", url: URL_FOR_PATH });
  assert.deepEqual(avatarMediaSource(URL_FOR_PATH, "public"), { kind: "stored", url: URL_FOR_PATH });
});

test("a signing mode goes to the object and never looks at the column", () => {
  // Including `"signed"`, which has a public fallback — but that fallback is
  // inside the resolver and rebuilds the address *from the object*. Falling
  // back to `media_url` here instead would defeat `"signed-only"`, whose entire
  // purpose is to prove the client no longer needs the public route.
  for (const mode of ["signed", "signed-only"] as const) {
    assert.deepEqual(messageMediaSource(ROW, mode), {
      kind: "object",
      ref: { bucket: "media", path: PATH },
    });
    assert.deepEqual(avatarMediaSource(URL_FOR_PATH, mode), {
      kind: "object",
      ref: { bucket: "media", path: PATH },
    });
  }
});

test("a row that predates the path columns resolves through its URL", () => {
  // Twenty rows on this deployment. Without this the back-fill would be a
  // prerequisite for routing rather than a tidy-up after it.
  const legacy = { media_bucket: null, media_path: null, media_url: URL_FOR_PATH };
  assert.deepEqual(messageMediaSource(legacy, "public"), { kind: "stored", url: URL_FOR_PATH });
  assert.deepEqual(messageMediaSource(legacy, "signed-only"), {
    kind: "object",
    ref: { bucket: "media", path: PATH },
  });
});

test("an address that is not ours is passed through in every mode", () => {
  // The three shapes this actually covers, measured rather than imagined:
  //
  // - `data:` — `publicPreviewFixture.ts` gives every photograph one, with both
  //   path columns null. A resolver that answered `null` here would take every
  //   picture out of the preview fixture, which is the surface this work is
  //   screenshotted on.
  // - `blob:` — a send still in flight holds a local object URL.
  // - an http address some other service owns — a bot's avatar is set through
  //   an API and `bots.avatar_url` is only text.
  //
  // None of the three can be signed, and none of the three leaks anything: two
  // are local to the tab and the third was never ours to guard.
  const foreign = [
    "data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAAfQ//73v/+BiOh/AAA=",
    "blob:http://127.0.0.1:5187/8f5a1f4e-0a2e-4d2a-9bb9-7e1f5b1c2d3e",
    "https://cdn.example.invalid/bot-picture.png",
  ];
  for (const url of foreign) {
    for (const mode of ["public", "signed", "signed-only"] as const) {
      assert.deepEqual(messageMediaSource({ media_url: url }, mode), { kind: "stored", url });
      assert.deepEqual(avatarMediaSource(url, mode), { kind: "stored", url });
    }
  }
});

test("a row with a path and no URL is built from the path, even in public mode", () => {
  // Strictly more than what shipped: such a row draws nothing today, so this
  // arm can regress nothing. It is the arm a back-filled column would land in
  // if the back-fill ever ran the other way.
  assert.deepEqual(
    messageMediaSource({ media_bucket: "media", media_path: PATH, media_url: null }, "public"),
    { kind: "object", ref: { bucket: "media", path: PATH } },
  );
});

test("no media at all is 'none', not an empty string", () => {
  for (const mode of ["public", "signed", "signed-only"] as const) {
    assert.deepEqual(messageMediaSource(null, mode), { kind: "none" });
    assert.deepEqual(messageMediaSource({ media_url: null }, mode), { kind: "none" });
    // An empty string is a text message's column, not an address.
    assert.deepEqual(messageMediaSource({ media_url: "" }, mode), { kind: "none" });
    assert.deepEqual(avatarMediaSource(null, mode), { kind: "none" });
    assert.deepEqual(avatarMediaSource("", mode), { kind: "none" });
  }
});

test("a path with no bucket beside it is not a reference to anything", () => {
  // `messageMediaObjectRef` refuses to guess `media`, so the URL decides. With
  // no URL either there is nothing to draw.
  assert.deepEqual(
    messageMediaSource({ media_bucket: null, media_path: PATH, media_url: null }, "signed"),
    { kind: "none" },
  );
});
