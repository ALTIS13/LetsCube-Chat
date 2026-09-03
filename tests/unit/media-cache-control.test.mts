import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  IMMUTABLE_CACHE_CONTROL,
  REUSED_PATH_CACHE_CONTROL,
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
    assert.equal(cacheControlFor(path), IMMUTABLE_CACHE_CONTROL, path);
  }
});

test("a path that is overwritten in place is not called immutable", () => {
  // `variants/profiles/{user}/{kind}.webp` keeps its name when someone changes
  // their picture. Calling that immutable would freeze the old face.
  const path = "variants/profiles/6f8b94d6-72de-42fc-927c-ba18909b5d5c/avatar_128.webp";
  assert.equal(cacheControlFor(path), REUSED_PATH_CACHE_CONTROL);
  assert.notEqual(cacheControlFor(path), IMMUTABLE_CACHE_CONTROL);
  assert.ok(!REUSED_PATH_CACHE_CONTROL.includes("immutable"));
});

test("a leading slash does not change the answer", () => {
  assert.equal(
    cacheControlFor("/variants/profiles/x/avatar_128.webp"),
    REUSED_PATH_CACHE_CONTROL,
  );
});

test("the avatar upload helper produces a path the rule calls immutable", () => {
  // The two are meant to agree: a fresh name per upload, cached forever.
  const id = "a09d11eb-a5c4-4487-b100-d912326c7f75";
  for (const kind of ["user", "chat", "bot"] as const) {
    assert.equal(cacheControlFor(avatarUploadPath(kind, id, fakeFile())), IMMUTABLE_CACHE_CONTROL);
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

test("every upload in the product asks for a cache lifetime", () => {
  // The service serves its own one-hour default to any upload that stays
  // silent, and staying silent is what every call site used to do.
  const callSites = [
    "artifacts/kub/src/components/chat/ChatWindow.tsx",
    "artifacts/kub/src/components/chat/ChatInfoPanel.tsx",
    "artifacts/kub/src/components/sidebar/SettingsModal.tsx",
    "artifacts/kub/src/pages/admin/UsersTab.tsx",
    "artifacts/kub/src/lib/botAvatar.ts",
    "artifacts/kub/src/lib/resumableStorageUpload.ts",
  ];
  for (const file of callSites) {
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
  assert.ok(worker.includes(`"${IMMUTABLE_CACHE_CONTROL}"`), "worker lost the immutable value");
  assert.ok(worker.includes(`"${REUSED_PATH_CACHE_CONTROL}"`), "worker lost the reused-path value");
  assert.ok(
    worker.includes('path.startsWith("variants/profiles/")'),
    "worker no longer treats profile variants as the reused path",
  );
});
