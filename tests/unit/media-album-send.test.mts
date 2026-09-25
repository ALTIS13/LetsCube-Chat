import assert from "node:assert/strict";
import test from "node:test";

import { prepareMediaAlbumTargets } from "../../artifacts/kub/src/lib/mediaAlbumSend.ts";
import { buildAttachmentMediaMetadata } from "../../artifacts/kub/src/lib/mediaCompression.ts";

const image = (id: string) => ({ id, clientMessageId: `${id}-message`, kind: "image" as const });
const video = (id: string) => ({ id, clientMessageId: `${id}-message`, kind: "video" as const });

test("two or more visual attachments share one stable album in pick order", () => {
  const targets = prepareMediaAlbumTargets([image("a"), video("b"), image("c")]);
  assert.deepEqual(targets.map(({ albumId, albumIndex, albumCount }) => ({ albumId, albumIndex, albumCount })), [
    { albumId: "a-message", albumIndex: 0, albumCount: 3 },
    { albumId: "a-message", albumIndex: 1, albumCount: 3 },
    { albumId: "a-message", albumIndex: 2, albumCount: 3 },
  ]);
  assert.deepEqual([image("a"), video("b"), image("c")].map((item) => item.id), ["a", "b", "c"]);
});

test("a single file, a document, and a failed album item on retry are not regrouped", () => {
  const single = image("single");
  assert.equal(prepareMediaAlbumTargets([single])[0], single);
  const mixed = [image("a"), { id: "doc", clientMessageId: "doc-message", kind: "file" as const }];
  assert.equal(prepareMediaAlbumTargets(mixed)[0], mixed[0]);
  const failed = { ...image("b"), albumId: "a-message", albumIndex: 1, albumCount: 3 };
  assert.equal(prepareMediaAlbumTargets([failed])[0], failed);
  const withNewPick = [failed, image("new")];
  assert.equal(prepareMediaAlbumTargets(withNewPick)[1].albumId, undefined);
});

test("long selections become albums of at most ten instead of losing grouping", () => {
  for (const count of [11, 12, 21]) {
    const targets = prepareMediaAlbumTargets(Array.from({ length: count }, (_, index) => image(`photo${index}`)));
    for (let start = 0; start < count; start += 10) {
      const batch = targets.slice(start, start + 10);
      if (batch.length === 1) {
        assert.equal(batch[0].albumId, undefined);
        continue;
      }
      assert.deepEqual(batch.map((item) => item.albumId), Array(batch.length).fill(`photo${start}-message`));
      assert.deepEqual(batch.map((item) => item.albumIndex), batch.map((_, index) => index));
      assert.deepEqual(batch.map((item) => item.albumCount), Array(batch.length).fill(batch.length));
    }
  }
});

test("documents and existing album retries separate new visual runs", () => {
  const failed = { ...image("failed"), albumId: "old-album", albumIndex: 0, albumCount: 2 };
  const targets = prepareMediaAlbumTargets([
    image("a"), video("b"),
    { id: "doc", clientMessageId: "doc-message", kind: "file" },
    failed, image("c"), image("d"),
  ]);
  assert.deepEqual(targets.map((item) => item.albumId), [
    "a-message", "a-message", undefined, "old-album", "c-message", "c-message",
  ]);
  assert.deepEqual(targets.map((item) => item.albumIndex), [0, 1, undefined, 0, 0, 1]);
});

test("album metadata is sent only for visual media with a complete valid tuple", () => {
  const source = { kind: "image" as const, mimeType: "image/webp", size: 1234 };
  const album = buildAttachmentMediaMetadata(
    { ...source, albumId: "a-message", albumIndex: 1, albumCount: 3 },
    { path: "u1/c1-b.webp" },
  );
  assert.deepEqual(
    { album_id: album?.album_id, album_index: album?.album_index, album_count: album?.album_count },
    { album_id: "a-message", album_index: 1, album_count: 3 },
  );
  const malformed = buildAttachmentMediaMetadata(
    { ...source, albumId: "a-message", albumIndex: 4, albumCount: 3 },
    { path: "u1/c1-b.webp" },
  );
  assert.equal(malformed && "album_id" in malformed, false);
  const document = buildAttachmentMediaMetadata(
    { kind: "file", mimeType: "application/pdf", size: 500, albumId: "a-message", albumIndex: 0, albumCount: 2 },
    { path: "u1/c1-doc.pdf" },
  );
  assert.equal(document && "album_id" in document, false);
});
