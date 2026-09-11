import assert from "node:assert/strict";
import test from "node:test";

import { forwardInsertPayload, forwardRpcArgs } from "../../artifacts/kub/src/lib/messageForward.ts";

/**
 * D-083: a forwarded photo or video lost its previews, because the copy carried
 * `media_url` and nothing else. The server now makes the copy from its own row
 * (`forward_message`); where that function is not deployed the client's copy
 * carries the bucket, the path and the whole metadata.
 */

const target = {
  chatId: "22222222-2222-4222-8222-2222222222f2",
  userId: "11111111-1111-4111-8111-1111111111f1",
  clientMessageId: "99999999-9999-4999-8999-999999999999",
  clientSentAt: "2026-09-11T12:00:00.000Z",
};

const photo = {
  id: "55555555-5555-4555-8555-5555555555f1",
  content: "Пляж",
  type: "image",
  media_url: "https://example.invalid/storage/v1/object/public/media/u/beach.jpg",
  media_bucket: "media",
  media_path: "u/beach.jpg",
  media_metadata: { kind: "image", width: 1200, height: 800, uncompressed: true, preview_path: "u/beach.preview.webp" },
};

test("the server is asked by id, with the idempotency key and nothing it could be told wrong", () => {
  assert.deepEqual(forwardRpcArgs(photo, target), {
    p_source_message_id: photo.id,
    p_target_chat_id: target.chatId,
    p_client_message_id: target.clientMessageId,
    p_client_sent_at: target.clientSentAt,
  });
});

test("the client's own copy carries the media the bubble and the viewer need", () => {
  assert.deepEqual(forwardInsertPayload(photo, target), {
    chat_id: target.chatId,
    user_id: target.userId,
    content: "Пляж",
    type: "image",
    media_url: photo.media_url,
    media_bucket: "media",
    media_path: "u/beach.jpg",
    media_metadata: photo.media_metadata,
    forwarded_from_id: photo.id,
    client_message_id: target.clientMessageId,
    client_sent_at: target.clientSentAt,
  });
});

test("a text message copies no media, and metadata the source does not have is not sent", () => {
  const payload = forwardInsertPayload({ id: "t1", content: "Привет", type: "text", media_url: null }, target);
  assert.equal(payload.media_url, null);
  assert.equal(payload.media_bucket, null);
  assert.equal(payload.media_path, null);
  assert.equal("media_metadata" in payload, false);
});
