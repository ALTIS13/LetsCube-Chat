/**
 * G-1: a bot can send back a file it was sent.
 *
 * The four media methods take `file_id` — the id of a message the bot may
 * already read — in place of a storage reference. These tests pin the gateway
 * half: the wire shape, and the fact that a re-send takes no upload grant and
 * forwards nothing but the identifier.
 *
 * The database half is proved where it lives: the migration's own self-check
 * and the production rehearsal in
 * `.migration-backup/supabase/migrations/20260919040000_a_bot_can_send_back_the_file_it_was_sent.*`.
 * The structural assertions at the end of this file are a guard against the
 * recorded SQL drifting away from that proof, not a substitute for it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseBotMethodInput } from "../../artifacts/api-server/src/bot/schemas.ts";
import { createMessageHandlers } from "../../artifacts/api-server/src/bot/methods/messages.ts";
import type {
  BotMessageCommand,
  BotMethodRepository,
} from "../../artifacts/api-server/src/bot/repository.ts";
import type { BotMethodContext } from "../../artifacts/api-server/src/bot/methodRouter.ts";

const BOT_ID = "11111111-1111-4111-8111-111111111111";
const CHAT_ID = "22222222-2222-4222-8222-222222222222";
const FILE_ID = "33333333-3333-4333-8333-333333333333";
const IDEMPOTENCY_KEY = "file-id-resend-0001";
const OBJECT_PATH = `${CHAT_ID}/bots/${BOT_ID}/0123456789abcdef.png`;

const MEDIA_METHODS = [
  ["sendPhoto", "image/png", "image"],
  ["sendVideo", "video/mp4", "video"],
  ["sendDocument", "application/pdf", "file"],
  ["sendVoice", "audio/ogg", "audio"],
] as const;

function storageReference(mimeType: string) {
  return {
    bucket: "chat-media" as const,
    object_path: OBJECT_PATH,
    mime_type: mimeType,
    size_bytes: 4242,
  };
}

type Recorded = {
  authorizeCalls: number;
  commands: BotMessageCommand[];
};

function stubRepository(recorded: Recorded): BotMethodRepository {
  return {
    async getMe() {
      throw new Error("unused");
    },
    async preflightMediaCommand() {
      return { result: null, duplicate: false };
    },
    async executeMessageCommand(command) {
      recorded.commands.push(command);
      return { result: { message_id: FILE_ID }, duplicate: false };
    },
    async authorizeMedia() {
      recorded.authorizeCalls += 1;
    },
    async replaceCommands() {
      throw new Error("unused");
    },
    async getCommands() {
      throw new Error("unused");
    },
    async lookupFile() {
      throw new Error("unused");
    },
    async createSignedFileUrl() {
      throw new Error("unused");
    },
    async answerCallback() {
      throw new Error("unused");
    },
  } as unknown as BotMethodRepository;
}

function handlers(recorded: Recorded) {
  return createMessageHandlers(
    stubRepository(recorded),
    () => "f".repeat(64),
    async () => {},
  );
}

const context = { bot: { botId: BOT_ID } } as unknown as BotMethodContext;

test("every media method accepts file_id in place of a storage reference", () => {
  for (const [method, mimeType] of MEDIA_METHODS) {
    const parsed = parseBotMethodInput(method, {
      chat_id: CHAT_ID,
      file_id: FILE_ID,
      idempotency_key: IDEMPOTENCY_KEY,
    });
    assert.equal(parsed.file_id, FILE_ID);
    assert.equal(parsed.media, undefined);

    const withMedia = parseBotMethodInput(method, {
      chat_id: CHAT_ID,
      media: storageReference(mimeType),
      idempotency_key: IDEMPOTENCY_KEY,
    });
    assert.equal(withMedia.file_id, undefined);
    assert.equal(withMedia.media?.object_path, OBJECT_PATH);
  }
});

test("file_id and a storage reference are mutually exclusive, and one is required", () => {
  for (const [method, mimeType] of MEDIA_METHODS) {
    assert.throws(
      () =>
        parseBotMethodInput(method, {
          chat_id: CHAT_ID,
          media: storageReference(mimeType),
          file_id: FILE_ID,
          idempotency_key: IDEMPOTENCY_KEY,
        }),
      `${method} accepted both a file_id and a storage reference`,
    );
    assert.throws(
      () =>
        parseBotMethodInput(method, {
          chat_id: CHAT_ID,
          idempotency_key: IDEMPOTENCY_KEY,
        }),
      `${method} accepted neither a file_id nor a storage reference`,
    );
  }
});

test("file_id must be a uuid, and no other field sneaks in beside it", () => {
  assert.throws(() =>
    parseBotMethodInput("sendPhoto", {
      chat_id: CHAT_ID,
      file_id: "not-a-uuid",
      idempotency_key: IDEMPOTENCY_KEY,
    }),
  );
  assert.throws(() =>
    parseBotMethodInput("sendPhoto", {
      chat_id: CHAT_ID,
      file_id: FILE_ID,
      media_path: OBJECT_PATH,
      idempotency_key: IDEMPOTENCY_KEY,
    }),
  );
});

test("sendMessage has no file_id; a file is not text", () => {
  assert.throws(() =>
    parseBotMethodInput("sendMessage", {
      chat_id: CHAT_ID,
      text: "hello",
      file_id: FILE_ID,
      idempotency_key: IDEMPOTENCY_KEY,
    }),
  );
});

test("a re-send forwards only the identifier and asks for no upload grant", async () => {
  for (const [method, , kind] of MEDIA_METHODS) {
    const recorded: Recorded = { authorizeCalls: 0, commands: [] };
    const input = parseBotMethodInput(method, {
      chat_id: CHAT_ID,
      file_id: FILE_ID,
      caption: "a caption",
      idempotency_key: IDEMPOTENCY_KEY,
    });
    await handlers(recorded)[method]!(context, input);

    assert.equal(
      recorded.authorizeCalls,
      0,
      `${method} asked for an upload grant for a file it is only re-sending`,
    );
    assert.equal(recorded.commands.length, 1);
    const command = recorded.commands[0]!;
    assert.equal(command.kind, kind);
    assert.deepEqual(command.payload, {
      text: "a caption",
      file_id: FILE_ID,
    });
    // The bucket and the path are the database's to resolve. Forwarding either
    // would hand the bot a storage path it never had.
    assert.equal("media_bucket" in command.payload, false);
    assert.equal("media_path" in command.payload, false);
    assert.equal("media_metadata" in command.payload, false);
  }
});

test("the storage-reference path is unchanged: it still authorizes and still carries metadata", async () => {
  for (const [method, mimeType, kind] of MEDIA_METHODS) {
    const recorded: Recorded = { authorizeCalls: 0, commands: [] };
    const input = parseBotMethodInput(method, {
      chat_id: CHAT_ID,
      media: storageReference(mimeType),
      idempotency_key: IDEMPOTENCY_KEY,
    });
    await handlers(recorded)[method]!(context, input);

    assert.equal(recorded.authorizeCalls, 1);
    assert.deepEqual(recorded.commands[0]!.payload, {
      media_bucket: "chat-media",
      media_path: OBJECT_PATH,
      media_metadata: { mime_type: mimeType, size: 4242, kind },
    });
    assert.equal("file_id" in recorded.commands[0]!.payload, false);
  }
});

test("a mime type outside the method's family is still refused on the reference path", async () => {
  const recorded: Recorded = { authorizeCalls: 0, commands: [] };
  await assert.rejects(
    async () =>
      handlers(recorded).sendPhoto!(context, {
        chat_id: CHAT_ID,
        media: storageReference("application/pdf"),
        idempotency_key: IDEMPOTENCY_KEY,
      } as never),
    /bot_api_validation_failed/,
  );
  assert.equal(recorded.authorizeCalls, 0);
});

test("the handler refuses a hand-built input that carries both or neither", async () => {
  for (const bad of [
    { media: storageReference("image/png"), file_id: FILE_ID },
    {},
  ]) {
    const recorded: Recorded = { authorizeCalls: 0, commands: [] };
    await assert.rejects(
      async () =>
        handlers(recorded).sendPhoto!(context, {
          chat_id: CHAT_ID,
          idempotency_key: IDEMPOTENCY_KEY,
          ...bad,
        } as never),
      /bot_api_validation_failed/,
    );
    assert.equal(recorded.commands.length, 0);
  }
});

// ---------------------------------------------------------------------------
// The recorded SQL must still say what the production rehearsal proved.
// ---------------------------------------------------------------------------

const migration = readFileSync(
  ".migration-backup/supabase/migrations/" +
    "20260919040000_a_bot_can_send_back_the_file_it_was_sent.sql",
  "utf8",
);
const migrationSql = migration.slice(migration.indexOf("\nbegin;"));
const compact = migrationSql.replace(/\s+/g, " ").toLowerCase();

test("the resolver is scoped to the destination chat and to what the bot may read", () => {
  assert.ok(
    compact.includes("source_message.chat_id = p_chat_id"),
    "the source message is no longer required to be in the destination chat",
  );
  assert.ok(
    compact.includes(
      "private.bot_can_receive_message(p_bot_id, source_message.id)",
    ),
    "the read rule is no longer applied to the source message",
  );
  assert.ok(
    compact.includes("source_message.deleted_at is null"),
    "a deleted message is no longer excluded",
  );
  assert.ok(
    compact.includes(
      "if coalesce(v_source.type, '') <> v_message_type then raise exception 'bot_file_kind_mismatch'",
    ),
    "the source kind is no longer required to match the method",
  );
});

test("a re-send takes no upload grant, and the reference path still requires one", () => {
  assert.ok(
    compact.includes(
      "if v_message_type <> 'text' and v_file_id is null then select upload_grant.id",
    ),
    "the upload-grant branch no longer distinguishes a re-send from a reference send",
  );
  assert.ok(
    compact.includes("bot_media_grant_required"),
    "the reference path lost its grant requirement",
  );
});

test("both signatures are unchanged, so the migration replaces rather than drops", () => {
  assert.equal(compact.includes("drop function"), false);
  assert.ok(
    compact.includes(
      "grant execute on function public.bot_send_message_internal(uuid,uuid,text,jsonb,text) to service_role",
    ),
  );
  assert.ok(
    compact.includes(
      "grant execute on function public.bot_message_command_internal(uuid,uuid,text,jsonb,text,text) to service_role",
    ),
  );
});
