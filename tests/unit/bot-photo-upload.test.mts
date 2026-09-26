import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import pino from "../../artifacts/api-server/node_modules/pino/pino.js";

import { createBotGatewayApp } from "../../artifacts/api-server/src/bot/app.ts";
import { BotApiError } from "../../artifacts/api-server/src/bot/errors.ts";
import { createMessageHandlers } from "../../artifacts/api-server/src/bot/methods/messages.ts";
import type { BotMethodContext } from "../../artifacts/api-server/src/bot/methodRouter.ts";
import {
  createBotMethodRepository,
  type BotMethodRepository,
  type BotServiceClient,
} from "../../artifacts/api-server/src/bot/repository.ts";
import { parseBotMethodInput } from "../../artifacts/api-server/src/bot/schemas.ts";

const BOT_ID = "33333333-3333-4333-8333-333333333333";
const CHAT_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";
const PHOTO_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l7sAAAAASUVORK5CYII=";
const OBJECT_PATH = `${CHAT_ID}/bots/${BOT_ID}/${"f".repeat(64)}.png`;
const context = {
  bot: { botId: BOT_ID, tokenId: "44444444-4444-4444-8444-444444444444" },
  requestId: "photo-test-request",
} as BotMethodContext;

test("sendPhoto accepts bounded inline image bytes without a storage path", () => {
  const input = parseBotMethodInput("sendPhoto", {
    chat_id: CHAT_ID,
    photo: { mime_type: "image/png", bytes_base64: PHOTO_BASE64 },
    idempotency_key: "photo-inline-0001",
  });

  assert.deepEqual(input.photo, {
    mime_type: "image/png",
    bytes_base64: PHOTO_BASE64,
  });
  assert.equal(input.file_id, undefined);
  assert.equal(input.media, undefined);
});

test("inline photos reject URLs, extra media references, reply targets, and oversized bytes", () => {
  const base = { chat_id: CHAT_ID, idempotency_key: "photo-inline-0002" };
  const exactLimit = Buffer.alloc(6 * 1024 * 1024).toString("base64");
  assert.doesNotThrow(() => parseBotMethodInput("sendPhoto", {
    ...base,
    photo: { mime_type: "image/png", bytes_base64: exactLimit },
  }));
  for (const fields of [
    { photo: { url: "https://example.invalid/photo.png" } },
    { photo: { mime_type: "image/svg+xml", bytes_base64: PHOTO_BASE64 } },
    { photo: { mime_type: "image/png", bytes_base64: PHOTO_BASE64 }, file_id: MESSAGE_ID },
    {
      photo: { mime_type: "image/png", bytes_base64: PHOTO_BASE64 },
      media: {
        bucket: "chat-media",
        object_path: OBJECT_PATH,
        mime_type: "image/png",
        size_bytes: 68,
      },
    },
    { photo: { mime_type: "image/png", bytes_base64: PHOTO_BASE64 }, reply_to_message_id: MESSAGE_ID },
    { photo: { mime_type: "image/png", bytes_base64: PHOTO_BASE64 }, topic_id: CHAT_ID },
    { photo: { mime_type: "image/png", bytes_base64: Buffer.alloc(6 * 1024 * 1024 + 1).toString("base64") } },
  ]) {
    assert.throws(() => parseBotMethodInput("sendPhoto", { ...base, ...fields }));
  }
  assert.throws(() =>
    parseBotMethodInput("sendVideo", {
      ...base,
      photo: { mime_type: "image/png", bytes_base64: PHOTO_BASE64 },
    }),
  );
});

test("declared photo MIME must match canonical image bytes before database access", async () => {
  let preflights = 0;
  const repository = {
    async preflightMediaCommand() {
      preflights += 1;
      return { result: null, duplicate: false };
    },
  } as unknown as BotMethodRepository;
  const handlers = createMessageHandlers(repository, () => "f".repeat(64), async () => {});
  for (const bytes_base64 of [PHOTO_BASE64, "AAAA", "https://example.invalid/photo.png"]) {
    await assert.rejects(
      () => handlers.sendPhoto(context, {
        chat_id: CHAT_ID,
        photo: { mime_type: "image/jpeg", bytes_base64 },
        idempotency_key: "photo-inline-0003",
      } as never),
      /bot_api_validation_failed/,
    );
  }
  assert.equal(preflights, 0);
});

test("JPEG, PNG, WebP, and GIF signatures are accepted without uploading a completed retry", async () => {
  const samples = [
    ["image/jpeg", "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AI4AXGP/2Q=="],
    ["image/png", PHOTO_BASE64],
    ["image/webp", "UklGRjQAAABXRUJQVlA4ICgAAACQAQCdASoBAAEAAUAmJQBOl0AAjNAA/vhff9REQUksP0KNlEvmAAAA"],
    ["image/gif", "R0lGODlhAQABAIAAAExpcR48WiH5BAUAAAAALAAAAAABAAEAAAICTAEAOw=="],
  ] as const;
  let preflights = 0;
  const repository = {
    async preflightMediaCommand() {
      preflights += 1;
      return { result: { message_id: MESSAGE_ID }, duplicate: true };
    },
    async uploadPhoto() {
      throw new Error("completed retry uploaded bytes");
    },
  } as unknown as BotMethodRepository;
  const handlers = createMessageHandlers(repository, () => "f".repeat(64), async () => {});
  for (const [mime_type, bytes_base64] of samples) {
    const input = parseBotMethodInput("sendPhoto", {
      chat_id: CHAT_ID,
      photo: { mime_type, bytes_base64 },
      idempotency_key: "photo-inline-0004",
    });
    assert.deepEqual(await handlers.sendPhoto(context, input), { message_id: MESSAGE_ID });
  }
  assert.equal(preflights, 4);
});

test("a forbidden or removed chat is rejected before service-role upload", async () => {
  let uploads = 0;
  const repository = {
    async preflightMediaCommand() {
      throw new BotApiError("forbidden");
    },
    async uploadPhoto() {
      uploads += 1;
    },
  } as unknown as BotMethodRepository;
  const handlers = createMessageHandlers(repository, () => "f".repeat(64), async () => {});
  const input = parseBotMethodInput("sendPhoto", {
    chat_id: CHAT_ID,
    photo: { mime_type: "image/png", bytes_base64: PHOTO_BASE64 },
    idempotency_key: "photo-inline-0005",
  });

  await assert.rejects(() => handlers.sendPhoto(context, input), /bot_api_forbidden/);
  assert.equal(uploads, 0);
});

test("inline photo paths use canonical UUID casing expected by the database", async () => {
  const upperChatId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
  const upperBotId = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";
  let uploadedPath: string | undefined;
  const repository = {
    async preflightMediaCommand() {
      return { result: null, duplicate: false };
    },
    async uploadPhoto(input: { objectPath: string }) {
      uploadedPath = input.objectPath;
    },
    async authorizeMedia() {},
    async executeMessageCommand() {
      return { result: { message_id: MESSAGE_ID }, duplicate: false };
    },
  } as unknown as BotMethodRepository;
  const handlers = createMessageHandlers(repository, () => "f".repeat(64), async () => {});
  const upperContext = {
    ...context,
    bot: { ...context.bot, botId: upperBotId },
  };
  const input = parseBotMethodInput("sendPhoto", {
    chat_id: upperChatId,
    photo: { mime_type: "image/png", bytes_base64: PHOTO_BASE64 },
    idempotency_key: "photo-inline-0006",
  });

  assert.deepEqual(await handlers.sendPhoto(upperContext, input), { message_id: MESSAGE_ID });
  assert.equal(
    uploadedPath,
    `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bots/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/${"f".repeat(64)}.png`,
  );
});

test("inline photo preflights, uploads into its chat, grants, then sends", async () => {
  const events: string[] = [];
  const repository = {
    async preflightMediaCommand(input: Record<string, unknown>) {
      events.push("preflight");
      assert.deepEqual(input, {
        botId: BOT_ID,
        chatId: CHAT_ID,
        kind: "image",
        idempotencyKey: "photo-inline-0001",
        requestFingerprint: "f".repeat(64),
      });
      return { result: null, duplicate: false };
    },
    async uploadPhoto(input: Record<string, unknown>) {
      events.push("upload");
      assert.equal(input.botId, BOT_ID);
      assert.equal(input.chatId, CHAT_ID);
      assert.equal(input.objectPath, OBJECT_PATH);
      assert.equal(input.mimeType, "image/png");
      assert.deepEqual(input.bytes, Buffer.from(PHOTO_BASE64, "base64"));
    },
    async authorizeMedia(input: Record<string, unknown>) {
      events.push("authorize");
      assert.deepEqual(input, {
        botId: BOT_ID,
        chatId: CHAT_ID,
        bucket: "chat-media",
        objectPath: OBJECT_PATH,
        mimeType: "image/png",
        sizeBytes: 68,
        expiresInSeconds: 60,
      });
    },
    async executeMessageCommand(input: Record<string, unknown>) {
      events.push("execute");
      assert.deepEqual(input, {
        botId: BOT_ID,
        chatId: CHAT_ID,
        kind: "image",
        payload: {
          media_bucket: "chat-media",
          media_path: OBJECT_PATH,
          media_metadata: {
            mime_type: "image/png",
            size: 68,
            kind: "image",
          },
          text: "New photo",
        },
        idempotencyKey: "photo-inline-0001",
        requestFingerprint: "f".repeat(64),
      });
      return { result: { message_id: MESSAGE_ID }, duplicate: false };
    },
  } as unknown as BotMethodRepository;
  const handlers = createMessageHandlers(repository, () => "f".repeat(64), async () => {});
  const input = parseBotMethodInput("sendPhoto", {
    chat_id: CHAT_ID,
    photo: { mime_type: "image/png", bytes_base64: PHOTO_BASE64 },
    caption: "New photo",
    idempotency_key: "photo-inline-0001",
  });

  assert.deepEqual(await handlers.sendPhoto(context, input), { message_id: MESSAGE_ID });
  assert.deepEqual(events, ["preflight", "upload", "authorize", "execute"]);
});

test("service-role storage upload is insert-only and bound to the bot's chat path", async () => {
  const bytes = Buffer.from(PHOTO_BASE64, "base64");
  const calls: string[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        calls.push("bucket");
        assert.equal(bucket, "chat-media");
        return {
          upload(path: string, body: Buffer, options: Record<string, unknown>) {
            calls.push("upload");
            assert.equal(path, OBJECT_PATH);
            assert.deepEqual(body, bytes);
            assert.deepEqual(options, {
              contentType: "image/png",
              upsert: false,
            });
            return Promise.resolve({ data: { path }, error: null });
          },
        };
      },
    },
  } as unknown as BotServiceClient;
  const repository = createBotMethodRepository(client);

  await repository.uploadPhoto({
    botId: BOT_ID,
    chatId: CHAT_ID,
    objectPath: OBJECT_PATH,
    mimeType: "image/png",
    bytes,
  });
  assert.deepEqual(calls, ["bucket", "upload"]);
});

test("storage refuses a path outside the authorized chat before any upload call", async () => {
  let storageCalls = 0;
  const repository = createBotMethodRepository({
    storage: { from() { storageCalls += 1; throw new Error("must not reach storage"); } },
  } as unknown as BotServiceClient);

  await assert.rejects(
    () => repository.uploadPhoto({
      botId: BOT_ID,
      chatId: MESSAGE_ID,
      objectPath: OBJECT_PATH,
      mimeType: "image/png",
      bytes: Buffer.from(PHOTO_BASE64, "base64"),
    }),
    /bot_api_internal_error/,
  );
  assert.equal(storageCalls, 0);
});

test("only an exact Storage duplicate permits an idempotent upload retry", async () => {
  const bytes = Buffer.from(PHOTO_BASE64, "base64");
  let uploadError: unknown = { status: 409, statusCode: "ResourceAlreadyExists" };
  const repository = createBotMethodRepository({
    storage: {
      from() {
        return {
          upload() {
            return Promise.resolve({ data: null, error: uploadError });
          },
        };
      },
    },
  } as unknown as BotServiceClient);
  const input = {
    botId: BOT_ID,
    chatId: CHAT_ID,
    objectPath: OBJECT_PATH,
    mimeType: "image/png" as const,
    bytes,
  };

  await repository.uploadPhoto(input);
  uploadError = { status: 409, statusCode: "409" };
  await repository.uploadPhoto(input);
  uploadError = { status: 403, statusCode: "AccessDenied", message: "private detail" };
  await assert.rejects(() => repository.uploadPhoto(input), /bot_api_internal_error/);
});

test("sendPhoto accepts a bounded photo body while other methods keep the small JSON limit", async (t) => {
  let authCalls = 0;
  const app = createBotGatewayApp({
    logger: pino({ enabled: false }),
    handlers: {
      sendPhoto: async () => ({ message_id: MESSAGE_ID }),
      sendMessage: async () => ({ message_id: MESSAGE_ID }),
    },
    tokenRepository: {
      async authenticateBotToken() {
        authCalls += 1;
        return context.bot;
      },
    },
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}/bot/v1`;
  const encoded = Buffer.alloc(200_000).toString("base64");
  const photoBody = JSON.stringify({
    chat_id: CHAT_ID,
    photo: { mime_type: "image/png", bytes_base64: encoded },
    idempotency_key: "photo-http-0001",
  });
  assert.ok(Buffer.byteLength(photoBody) > 256 * 1024);

  const photoResponse = await fetch(`${endpoint}/sendPhoto`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: photoBody,
  });
  assert.equal(photoResponse.status, 200);
  assert.deepEqual((await photoResponse.json() as { result: unknown }).result, {
    message_id: MESSAGE_ID,
  });
  assert.equal(authCalls, 1);

  const textResponse = await fetch(`${endpoint}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: "x".repeat(300_000),
      idempotency_key: "photo-http-0002",
    }),
  });
  assert.equal(textResponse.status, 413);
  assert.equal(authCalls, 1);

  const oversizedPhotoResponse = await fetch(`${endpoint}/sendPhoto`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      photo: { mime_type: "image/png", bytes_base64: "A".repeat(9 * 1024 * 1024) },
      idempotency_key: "photo-http-0004",
    }),
  });
  assert.equal(oversizedPhotoResponse.status, 413);
  assert.equal(authCalls, 2);
});

test("large photo requests authenticate before buffering their JSON body", async (t) => {
  let handlerCalls = 0;
  const app = createBotGatewayApp({
    logger: pino({ enabled: false }),
    handlers: {
      async sendPhoto() {
        handlerCalls += 1;
        return { message_id: MESSAGE_ID };
      },
    },
    tokenRepository: {
      async authenticateBotToken() {
        throw new BotApiError("unauthorized");
      },
    },
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const body = JSON.stringify({
    chat_id: CHAT_ID,
    photo: { mime_type: "image/png", bytes_base64: "A".repeat(9 * 1024 * 1024) },
    idempotency_key: "photo-http-0003",
  });
  assert.ok(Buffer.byteLength(body) > 9 * 1024 * 1024);
  const response = await fetch(`http://127.0.0.1:${address.port}/bot/v1/sendPhoto`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "unauthorized");
  assert.equal(handlerCalls, 0);
});
