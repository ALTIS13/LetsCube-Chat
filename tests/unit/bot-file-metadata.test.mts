/**
 * D-249 and D-250: the gateway half of getFile.
 *
 * The database decides WHICH object a bot may reach — `bot_file_lookup_internal`
 * admits an object whose bucket is public, or whose path is scoped to the chat
 * being asked about. The gateway used to re-assert `bucket === "chat-media"`,
 * a bucket that holds 0 objects on production, so relaxing the database alone
 * would have turned D-249's 404 into a 500. These tests pin what is left: the
 * gateway validates the SHAPE of what the database returns and nothing else,
 * and it reads an ABSENT key as «unknown» rather than as a type error, because
 * `jsonb_strip_nulls` is what builds that row and no production message
 * carries a `file_name` at all.
 *
 * The database half is proved where it lives: the migration's own self-check
 * and the production rehearsal in
 * `.migration-backup/supabase/migrations/20260919050000_a_bot_can_fetch_a_file_and_is_told_its_size.*`.
 * The structural assertions at the end of this file guard the recorded SQL
 * against drifting away from that proof; they are not a substitute for it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createIdentityHandlers } from "../../artifacts/api-server/src/bot/methods/identity.ts";
import {
  createBotMethodRepository,
  type BotServiceClient,
} from "../../artifacts/api-server/src/bot/repository.ts";
import type { BotMethodContext } from "../../artifacts/api-server/src/bot/methodRouter.ts";

const BOT_ID = "11111111-1111-4111-8111-111111111111";
const CHAT_ID = "22222222-2222-4222-8222-222222222222";
const MESSAGE_ID = "33333333-3333-4333-8333-333333333333";
const SIGNED_URL = "https://core.letscube.ru/storage/v1/object/sign/media/x?token=t";

const MIGRATION = new URL(
  "../../.migration-backup/supabase/migrations/" +
    "20260919050000_a_bot_can_fetch_a_file_and_is_told_its_size.sql",
  import.meta.url,
);

type LookupRow = Record<string, unknown>;

function fakeClient(row: LookupRow, seen: { bucket?: string; path?: string }) {
  return {
    rpc(name: string) {
      assert.equal(name, "bot_file_lookup_internal");
      return Promise.resolve({ data: row, error: null });
    },
    storage: {
      from(bucket: string) {
        seen.bucket = bucket;
        return {
          createSignedUrl(objectPath: string) {
            seen.path = objectPath;
            return Promise.resolve({ data: { signedUrl: SIGNED_URL }, error: null });
          },
        };
      },
    },
  } as unknown as BotServiceClient;
}

async function getFile(row: LookupRow) {
  const seen: { bucket?: string; path?: string } = {};
  const handlers = createIdentityHandlers(createBotMethodRepository(fakeClient(row, seen)));
  const context = { bot: { botId: BOT_ID } } as unknown as BotMethodContext;
  const result = await handlers.getFile(context, {
    chat_id: CHAT_ID,
    message_id: MESSAGE_ID,
  });
  return { result: result as Record<string, unknown>, seen };
}

function row(overrides: LookupRow = {}): LookupRow {
  return {
    message_id: MESSAGE_ID,
    bucket_id: "media",
    object_path: `${CHAT_ID}/photo.png`,
    mime_type: "image/png",
    file_name: "photo.png",
    size_bytes: 4242,
    ...overrides,
  };
}

test("getFile signs the bucket the database named, which is the one the product uses", async () => {
  const { result, seen } = await getFile(row());
  assert.equal(seen.bucket, "media");
  assert.equal(seen.path, `${CHAT_ID}/photo.png`);
  assert.equal(result.file_id, MESSAGE_ID);
  assert.equal(result.url, SIGNED_URL);
  assert.equal(result.file_size, 4242);
  assert.equal(result.mime_type, "image/png");
  assert.equal(result.expires_in, 60);
});

test("the private bucket still works: the gateway names no bucket at all", async () => {
  const { result, seen } = await getFile(
    row({ bucket_id: "chat-media", object_path: `${CHAT_ID}/private.png` }),
  );
  assert.equal(seen.bucket, "chat-media");
  assert.equal(result.url, SIGNED_URL);
});

test("a bucket the product has not invented yet is signed for too", async () => {
  const { seen } = await getFile(row({ bucket_id: "chat-media-2026" }));
  assert.equal(seen.bucket, "chat-media-2026");
});

test("an absent key is unknown, not a type error", async () => {
  // This is the shape production actually returns: `jsonb_strip_nulls` drops
  // what the row does not know, and no message carries a `file_name`.
  const bare = row();
  delete bare.file_name;
  delete bare.size_bytes;
  const { result } = await getFile(bare);
  assert.equal(result.file_name, null);
  assert.equal(result.file_size, null);
});

test("an explicit null is unknown too", async () => {
  const { result } = await getFile(row({ file_name: null, size_bytes: null, mime_type: null }));
  assert.equal(result.file_name, null);
  assert.equal(result.file_size, null);
  assert.equal(result.mime_type, null);
});

test("a size larger than the old 100 MiB cap is a size, not a 500", async () => {
  // The `media` bucket's own limit is 250 MB, so the cap this replaces could
  // only ever have manufactured an error for a legitimate file.
  const { result } = await getFile(row({ size_bytes: 200_000_000 }));
  assert.equal(result.file_size, 200_000_000);
});

test("a size the database wrote as a digit string is still a number", async () => {
  const { result } = await getFile(row({ size_bytes: "4242" }));
  assert.equal(result.file_size, 4242);
});

for (const [label, bad] of [
  ["an empty bucket", ""],
  ["a bucket with a path separator", "media/../secrets"],
  ["a bucket with a backslash", `media${String.fromCharCode(92)}secrets`],
  ["a bucket that is not a string", 7],
  ["a bucket starting with a dot", ".media"],
] as const) {
  test(`${label} is refused`, async () => {
    await assert.rejects(() => getFile(row({ bucket_id: bad })), /internal_error/);
  });
}

for (const [label, bad] of [
  ["a negative size", -1],
  ["a fractional size", 1.5],
  ["an unsafe integer size", Number.MAX_SAFE_INTEGER + 2],
] as const) {
  test(`${label} is refused`, async () => {
    await assert.rejects(() => getFile(row({ size_bytes: bad })), /internal_error/);
  });
}

test("a message id that is not a uuid is refused", async () => {
  await assert.rejects(() => getFile(row({ message_id: "nope" })), /internal_error/);
});

test("an object path longer than the database allows is refused", async () => {
  await assert.rejects(
    () => getFile(row({ object_path: "a".repeat(1025) })),
    /internal_error/,
  );
});

test("the recorded migration still carries the rule these tests assume", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const body = sql.slice(sql.indexOf("create or replace function public.bot_file_lookup_internal"));
  const lookup = body.slice(0, body.indexOf("create or replace function private.bot_message_update_payload"));

  // D-249: the bucket rule is derived, and names no bucket.
  assert.ok(!lookup.includes("chat-media"), "the lookup names a bucket again");
  assert.ok(lookup.includes("bucket_row.public"), "the public-bucket arm is gone");
  assert.ok(
    lookup.includes("public._kub_chat_media_chat_id(message_row.media_path) = message_row.chat_id"),
    "the chat-scoped arm is gone",
  );
  assert.ok(
    lookup.includes("join storage.objects media_object"),
    "the object-existence rule is gone",
  );
  // The read rule is the one that actually limits the bot.
  assert.ok(
    lookup.includes("private.bot_can_receive_message(p_bot_id, message_row.id)"),
    "the read rule is gone",
  );

  // D-250: both spellings, and the storage fallback behind them.
  assert.ok(
    sql.includes("private.media_metadata_bigint(message_row.media_metadata, 'size_bytes', 'size')"),
    "the size spellings are gone",
  );
  assert.ok(
    sql.includes("private.media_metadata_bigint(media_object.metadata, 'size')"),
    "the storage size fallback is gone",
  );
  assert.ok(
    sql.includes("private.media_metadata_bigint(message_row.media_metadata, 'duration_ms')"),
    "the duration is not read from the app's own spelling",
  );
  // A unitless `duration` in milliseconds would be wrong by 1000x for the
  // first consumer, which reads it as seconds.
  assert.ok(sql.includes("'duration_ms',"), "duration_ms is gone from the attachment");
  assert.ok(sql.includes("/ 1000"), "duration is no longer converted to seconds");
});
