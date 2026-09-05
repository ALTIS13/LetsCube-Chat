import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  IMMUTABLE_PATH_MAX_AGE_SECONDS,
  REUSED_PATH_MAX_AGE_SECONDS,
  cacheControlFor,
  withVersionToken,
} from "../../artifacts/kub/src/lib/mediaCacheControl.ts";
import { avatarUploadPath } from "../../artifacts/kub/src/lib/mediaUpload.ts";

function fakeFile(type = "image/webp"): File {
  return { type, name: "x", size: 1 } as unknown as File;
}

test("a name unique to one upload is cached as though it never changes", () => {
  // Every upload path in the product mints a fresh name, so the bytes behind a
  // URL are fixed and the browser never needs to ask again.
  for (const path of [
    "avatars/1532baab-41d9-480e-96a7-3260c99ececd/avatar-2c9c0ae1.webp",
    "chat-avatars/02a3f32e-0973-4fb0-9001-5d270cb22cca/avatar-7f3a.png",
    "bot-avatars/a09d11eb-a5c4-4487-b100-d912326c7f75/avatar-9b1c.webp",
    "6f8b94d6-72de-42fc-927c-ba18909b5d5c/1778076398156.png",
    "variants/messages/17b48e99/5073e380/image_preview.webp",
    "variants/messages/17b48e99/5073e380/image_thumb.webp",
  ]) {
    assert.equal(cacheControlFor(path), IMMUTABLE_PATH_MAX_AGE_SECONDS, path);
  }
});

test("a path that is overwritten in place is not called immutable", () => {
  // `variants/profiles/{user}/{kind}.webp` keeps its name when someone changes
  // their picture. Calling that immutable would freeze the old face.
  const path = "variants/profiles/6f8b94d6-72de-42fc-927c-ba18909b5d5c/avatar_128.webp";
  assert.equal(cacheControlFor(path), REUSED_PATH_MAX_AGE_SECONDS);
  assert.notEqual(cacheControlFor(path), IMMUTABLE_PATH_MAX_AGE_SECONDS);
  assert.ok(!REUSED_PATH_MAX_AGE_SECONDS.includes("immutable"));
});

test("a leading slash does not change the answer", () => {
  assert.equal(
    cacheControlFor("/variants/profiles/x/avatar_128.webp"),
    REUSED_PATH_MAX_AGE_SECONDS,
  );
});

test("the avatar upload helper produces a path the rule calls immutable", () => {
  // The two are meant to agree: a fresh name per upload, cached forever.
  const id = "a09d11eb-a5c4-4487-b100-d912326c7f75";
  for (const kind of ["user", "chat", "bot"] as const) {
    assert.equal(cacheControlFor(avatarUploadPath(kind, id, fakeFile())), IMMUTABLE_PATH_MAX_AGE_SECONDS);
  }
});

test("a reused path's url carries the moment it was written", () => {
  const url = "https://core.letscube.ru/storage/v1/object/public/media/variants/profiles/x/avatar_128.webp";
  const first = withVersionToken(url, "2026-09-03T21:27:32.277921+00:00");
  const second = withVersionToken(url, "2026-09-04T08:00:00.000000+00:00");
  assert.notEqual(first, second, "a changed picture must be a different url");
  assert.ok(first?.includes("?v="));
  assert.ok(second?.includes("?v="));
});

test("the same write yields the same url, so the cache is not defeated", () => {
  const url = "https://core.letscube.ru/x.webp";
  const stamp = "2026-09-03T21:27:32.277921+00:00";
  assert.equal(withVersionToken(url, stamp), withVersionToken(url, stamp));
});

test("a url that already has a query keeps it", () => {
  const versioned = withVersionToken("https://core.letscube.ru/x.webp?width=128", "2026-09-03T00:00:00Z");
  assert.ok(versioned?.includes("width=128"));
  assert.ok(versioned?.includes("&v="));
});

test("nothing to version leaves the url alone", () => {
  const url = "https://core.letscube.ru/x.webp";
  assert.equal(withVersionToken(url, null), url);
  assert.equal(withVersionToken(url, ""), url);
  // A timestamp with no digits cannot make a token; better the plain url than
  // a "?v=" that means nothing.
  assert.equal(withVersionToken(url, "not-a-date"), url);
  assert.equal(withVersionToken(null, "2026-09-03T00:00:00Z"), null);
  assert.equal(withVersionToken(undefined, "2026-09-03T00:00:00Z"), null);
});

const CALL_SITES = [
  "artifacts/kub/src/components/chat/ChatWindow.tsx",
  "artifacts/kub/src/components/chat/ChatInfoPanel.tsx",
  "artifacts/kub/src/components/sidebar/SettingsModal.tsx",
  "artifacts/kub/src/pages/admin/UsersTab.tsx",
  "artifacts/kub/src/lib/botAvatar.ts",
  "artifacts/kub/src/lib/resumableStorageUpload.ts",
];

test("every upload in the product asks for a cache lifetime", () => {
  // The service serves its own one-hour default to any upload that stays
  // silent, and staying silent is what every call site used to do.
  for (const file of CALL_SITES) {
    const source = readFileSync(file, "utf8");
    assert.ok(
      source.includes("cacheControl"),
      `${file} uploads without saying how long the result may be kept`,
    );
    assert.ok(
      !/cacheControl:\s*["']3600["']/.test(source),
      `${file} still asks for the one-hour default`,
    );
  }
});

test("the worker and the client agree on the two lifetimes", () => {
  // They are separate deployments and cannot share a module, so the values are
  // duplicated. This is the thing that notices when one of them moves.
  const worker = readFileSync("artifacts/api-server/src/workers/mediaVariantsWorker.ts", "utf8");
  assert.ok(worker.includes(`"${IMMUTABLE_PATH_MAX_AGE_SECONDS}"`), "worker lost the immutable value");
  assert.ok(worker.includes(`"${REUSED_PATH_MAX_AGE_SECONDS}"`), "worker lost the reused-path value");
  assert.ok(
    worker.includes('path.startsWith("variants/profiles/")'),
    "worker no longer treats profile variants as the reused path",
  );
});

/**
 * What the storage service does with the value an upload sends.
 *
 * Transcribed from `storage-api` v1.60.4 as deployed, read out of the running
 * container. Neither route takes the caller's `Cache-Control` header: both
 * build the header themselves out of the value they are handed, which is why
 * that value has to be a lifetime and not a directive.
 */

/** `dist/storage/uploader.js` — a `Blob`, i.e. any file at or under the resumable threshold. */
function servedAfterMultipartUpload(formField: string): string {
  return formField ? `max-age=${formField}` : "no-cache";
}

/** `dist/http/routes/tus/lifecycle.js` — a larger file, sent as upload metadata. */
function servedAfterResumableUpload(metadata: string): string {
  return /^-?\d+$/.test(metadata) ? `max-age=${metadata}` : "no-cache";
}

const UPLOAD_PATHS = [
  "6f8b94d6-72de-42fc-927c-ba18909b5d5c/1778076398156.png",
  "6f8b94d6-72de-42fc-927c-ba18909b5d5c/1778076398156.mp4",
  "avatars/1532baab-41d9-480e-96a7-3260c99ececd/avatar-2c9c0ae1.webp",
  "chat-avatars/02a3f32e-0973-4fb0-9001-5d270cb22cca/avatar-7f3a.png",
  "bot-avatars/a09d11eb-a5c4-4487-b100-d912326c7f75/avatar-9b1c.webp",
  "variants/messages/17b48e99/5073e380/image_preview.webp",
  "variants/profiles/6f8b94d6-72de-42fc-927c-ba18909b5d5c/avatar_128.webp",
];

test("an upload sends a lifetime, so the service stores one well-formed max-age", () => {
  // The contract this file exists to hold. Sending the header itself instead of
  // the seconds is silently destructive in two different ways, and neither is
  // visible from the call site: the multipart route pastes the value after its
  // own `max-age=` and stores a malformed one, and the resumable route checks
  // for a number first and throws the lifetime away when it does not find one.
  for (const path of UPLOAD_PATHS) {
    const sent = cacheControlFor(path);
    assert.match(sent, /^\d+$/, `${path} would upload ${JSON.stringify(sent)}, which is not a lifetime`);
    assert.match(
      servedAfterMultipartUpload(sent),
      /^max-age=\d+$/,
      `a photo at ${path} would be served ${servedAfterMultipartUpload(sent)}`,
    );
    assert.match(
      servedAfterResumableUpload(sent),
      /^max-age=\d+$/,
      `a video at ${path} would be served ${servedAfterResumableUpload(sent)}`,
    );
  }
});

test("no upload site hands the service a header where it wants a lifetime", () => {
  // Reading the value from `cacheControlFor` is what keeps the rule in one
  // place; a literal directive written at a call site would pass typecheck,
  // upload without an error, and quietly break the header of whatever it sent.
  for (const file of CALL_SITES) {
    const source = readFileSync(file, "utf8");
    assert.ok(
      !/cacheControl:\s*(["'`])[^"'`]*max-age/.test(source),
      `${file} passes a Cache-Control directive where the service wants seconds`,
    );
  }
});

test("the browser is not promised the immutable it cannot deliver", () => {
  // A decision, recorded so it is not read as an oversight: the multipart route
  // does not validate and would carry "31536000, immutable" through today, but
  // the resumable route already rejects that exact shape, so the two upload
  // routes would disagree about the same file. Seconds only, on both.
  assert.ok(!IMMUTABLE_PATH_MAX_AGE_SECONDS.includes("immutable"));
  assert.equal(servedAfterResumableUpload("31536000, immutable"), "no-cache");
});

test("the worker still serves the directive it alone can send", () => {
  // Its body is a Buffer, which takes `storage-js`'s binary branch, and that
  // branch sends a real request header the service honours as written. This is
  // the half of the pair the browser cannot have.
  const worker = readFileSync("artifacts/api-server/src/workers/mediaVariantsWorker.ts", "utf8");
  assert.ok(
    worker.includes('headers: { "cache-control": cacheControl.directive }'),
    "the worker stopped sending the header that carries immutable",
  );
  assert.ok(
    worker.includes("cacheControl: cacheControl.seconds"),
    "the worker stopped sending seconds in the upload field",
  );
  assert.ok(
    /directive: reused \? `max-age=\$\{seconds\}` : `max-age=\$\{seconds\}, immutable`/.test(worker),
    "the worker no longer builds its directive from the same seconds",
  );
});
