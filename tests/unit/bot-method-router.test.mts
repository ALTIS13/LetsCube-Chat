import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer, request as httpRequest, type Server } from "node:http";
import { createConnection } from "node:net";
import { Writable } from "node:stream";
import test from "node:test";

import pino from "../../artifacts/api-server/node_modules/pino/pino.js";

import { createBotGatewayApp } from "../../artifacts/api-server/src/bot/app.ts";
import { BotApiError } from "../../artifacts/api-server/src/bot/errors.ts";
import {
  createBotMethodRouter,
  createBotRequestFingerprint,
  exactAuthorizationHeader,
  createTask3MethodHandlers,
  type BotMethodHandlers,
} from "../../artifacts/api-server/src/bot/methodRouter.ts";
import type {
  BotMethodRepository,
  BotMessageCommand,
} from "../../artifacts/api-server/src/bot/repository.ts";

const BOT_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN_ID = "22222222-2222-4222-8222-222222222222";
const CHAT_ID = "33333333-3333-4333-8333-333333333333";
const MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const CALLBACK_ID = "55555555-5555-4555-8555-555555555555";
const REQUEST_ID = "server-request-id-1";
const AUTHORIZATION = `Bot lc_bot_0001020304.${Buffer.alloc(32, 7).toString("base64url")}`;
const PEPPER = "test-only-pepper-with-at-least-32-bytes";

type HttpResult = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

function listen(app: ReturnType<typeof createBotGatewayApp>): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer({ joinDuplicateHeaders: true }, app);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function call(
  server: Server,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string | readonly string[]> | readonly string[];
    body?: string;
  } = {},
): Promise<HttpResult> {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const body = options.body ?? "";

  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: address.port,
        path,
        method: options.method ?? "GET",
        headers:
          options.headers ??
          (body
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body).toString(),
              }
            : undefined),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: text ? JSON.parse(text) : null,
          });
        });
      },
    );
    request.once("error", reject);
    if (body) request.end(body);
    else request.end();
  });
}

function createTestApp(
  handlers: BotMethodHandlers,
  authenticateCalls: Array<string | readonly string[] | undefined> = [],
) {
  return createBotGatewayApp({
    logger: pino({ enabled: false }),
    handlers,
    requestId: () => REQUEST_ID,
    tokenRepository: {
      async authenticateBotToken(header) {
        authenticateCalls.push(header);
        if (header !== AUTHORIZATION) throw new BotApiError("unauthorized");
        return { botId: BOT_ID, tokenId: TOKEN_ID };
      },
    },
  });
}

test("gateway exposes health without CORS or credential metadata", async (t) => {
  const server = await listen(createTestApp({}));
  t.after(() => close(server));

  const response = await call(server, "/healthz?token=must-not-be-read");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    service: "letscube-bot-gateway",
  });
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  assert.equal(response.headers["x-powered-by"], undefined);
});

test("router ignores query tokens and returns a sanitized unauthorized envelope", async (t) => {
  const authenticateCalls: Array<string | readonly string[] | undefined> = [];
  const server = await listen(createTestApp({ getMe: async () => ({}) }, authenticateCalls));
  t.after(() => close(server));

  const response = await call(
    server,
    `/bot/v1/getMe?token=${encodeURIComponent(AUTHORIZATION)}`,
    {
      method: "POST",
      body: "{}",
    },
  );

  assert.equal(response.status, 401, JSON.stringify(response));
  assert.deepEqual(response.body, {
    ok: false,
    error: {
      code: "unauthorized",
      message: "Unauthorized",
      request_id: REQUEST_ID,
    },
  });
  assert.deepEqual(authenticateCalls, [undefined]);
});

test("router rejects duplicate Authorization fields before token parsing", () => {
  assert.throws(
    () =>
      exactAuthorizationHeader({
        rawHeaders: [
          "Authorization",
          AUTHORIZATION,
          "Authorization",
          AUTHORIZATION,
        ],
        headersDistinct: { authorization: [AUTHORIZATION, AUTHORIZATION] },
      } as any),
    (error: unknown) =>
      error instanceof BotApiError && error.code === "unauthorized",
  );
});

test("router invokes only the selected authenticated handler with parsed input", async (t) => {
  const calls: Array<{ method: string; context: unknown; input: unknown }> = [];
  const server = await listen(
    createTestApp({
      getMe: async (context, input) => {
        calls.push({ method: "getMe", context, input });
        return { id: BOT_ID, username: "cube_bot" };
      },
      sendMessage: async (context, input) => {
        calls.push({ method: "sendMessage", context, input });
        return { message_id: MESSAGE_ID };
      },
    }),
  );
  t.after(() => close(server));

  const payload = JSON.stringify({
    chat_id: CHAT_ID,
    text: "Hello",
    idempotency_key: "message:router:1",
  });
  const response = await call(server, "/bot/v1/sendMessage", {
    method: "POST",
    headers: {
      authorization: AUTHORIZATION,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload).toString(),
    },
    body: payload,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    result: { message_id: MESSAGE_ID },
  });
  assert.deepEqual(calls, [
    {
      method: "sendMessage",
      context: {
        bot: { botId: BOT_ID, tokenId: TOKEN_ID },
        requestId: REQUEST_ID,
      },
      input: {
        chat_id: CHAT_ID,
        text: "Hello",
        idempotency_key: "message:router:1",
      },
    },
  ]);
});

test("getUpdates aborts after a fully received body when the response socket closes", async (t) => {
  let handlerStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    handlerStarted = resolve;
  });
  let handlerAborted!: () => void;
  const aborted = new Promise<void>((resolve) => {
    handlerAborted = resolve;
  });
  const server = await listen(
    createTestApp({
      getUpdates: async (context) => {
        handlerStarted();
        assert.ok(context.signal);
        await new Promise<void>((resolve) => {
          context.signal?.addEventListener(
            "abort",
            () => {
              handlerAborted();
              resolve();
            },
            { once: true },
          );
        });
        return [];
      },
    }),
  );
  t.after(() => close(server));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const body = JSON.stringify({ timeout: 30 });
  const socket = createConnection({ host: "127.0.0.1", port: address.port });
  t.after(() => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.write(
    [
      "POST /bot/v1/getUpdates HTTP/1.1",
      `Host: 127.0.0.1:${address.port}`,
      `Authorization: ${AUTHORIZATION}`,
      "Content-Type: application/json",
      `Content-Length: ${Buffer.byteLength(body)}`,
      "Connection: close",
      "",
      body,
    ].join("\r\n"),
  );
  await started;
  socket.destroy();
  await Promise.race([
    aborted,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("long_poll_not_aborted")), 500),
    ),
  ]);
});

test("getUpdates removes request, response, and socket abort listeners after completion", async () => {
  const socket = new EventEmitter();
  const request = Object.assign(new EventEmitter(), {
    id: REQUEST_ID,
    params: { method: "getUpdates" },
    body: { timeout: 0 },
    rawHeaders: ["Authorization", AUTHORIZATION],
    headersDistinct: { authorization: [AUTHORIZATION] },
    socket,
  });
  let responseBody: unknown;
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    writableFinished: false,
    status() {
      return this;
    },
    json(value: unknown) {
      responseBody = value;
      this.writableEnded = true;
      this.writableFinished = true;
      return this;
    },
  });
  const router = createBotMethodRouter({
    handlers: { getUpdates: async () => [] },
    tokenRepository: {
      async authenticateBotToken() {
        return { botId: BOT_ID, tokenId: TOKEN_ID };
      },
    },
  });

  await router(request as any, response as any, () => undefined);

  assert.deepEqual(responseBody, { ok: true, result: [] });
  assert.equal(request.listenerCount("aborted"), 0);
  assert.equal(response.listenerCount("close"), 0);
  assert.equal(socket.listenerCount("close"), 0);
});

test("unknown and uninstalled extension methods return method_not_found", async (t) => {
  const server = await listen(createTestApp({ getMe: async () => ({}) }));
  t.after(() => close(server));

  for (const method of ["forwardMessage", "getUpdates"]) {
    const response = await call(server, `/bot/v1/${method}`, {
      method: "POST",
      headers: {
        authorization: AUTHORIZATION,
        "content-type": "application/json",
        "content-length": "2",
      },
      body: "{}",
    });
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, {
      ok: false,
      error: {
        code: "method_not_found",
        message: "Method not found",
        request_id: REQUEST_ID,
      },
    });
  }
});

test("strict JSON and the 256 KiB limit use stable public errors", async (t) => {
  const server = await listen(createTestApp({ getMe: async () => ({}) }));
  t.after(() => close(server));

  const primitive = await call(server, "/bot/v1/getMe", {
    method: "POST",
    headers: {
      authorization: AUTHORIZATION,
      "content-type": "application/json",
      "content-length": "4",
    },
    body: "true",
  });
  assert.equal(primitive.status, 400);
  assert.equal((primitive.body as any).error.code, "validation_failed");

  const oversizedBody = JSON.stringify({ value: "x".repeat(262_144) });
  const oversized = await call(server, "/bot/v1/getMe", {
    method: "POST",
    headers: {
      authorization: AUTHORIZATION,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(oversizedBody).toString(),
    },
    body: oversizedBody,
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(oversized.body, {
    ok: false,
    error: {
      code: "payload_too_large",
      message: "Payload too large",
      request_id: REQUEST_ID,
    },
  });
});

test("logger records only the route template for token-shaped method paths", async (t) => {
  const records: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      records.push(chunk.toString("utf8"));
      callback();
    },
  });
  const tokenShapedMethod = `lc_bot_deadbeef00.${Buffer.alloc(32, 9).toString("base64url")}`;
  const app = createBotGatewayApp({
    logger: pino({ level: "info" }, destination),
    handlers: { getMe: async () => ({}) },
    requestId: () => REQUEST_ID,
    tokenRepository: {
      async authenticateBotToken() {
        throw new Error("unknown methods must not authenticate");
      },
    },
  });
  const server = await listen(app);
  t.after(() => close(server));

  const response = await call(server, `/bot/v1/${tokenShapedMethod}`, {
    method: "POST",
    headers: {
      authorization: AUTHORIZATION,
      "content-type": "application/json",
      "content-length": "2",
    },
    body: "{}",
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  const output = records.join("");
  assert.equal(response.status, 404);
  assert.match(output, /"path":"\/bot\/v1\/:method"/);
  assert.equal(output.includes(tokenShapedMethod), false);
  assert.equal(output.includes("deadbeef00"), false);
});

function createRepository(overrides: Partial<BotMethodRepository> = {}): {
  repository: BotMethodRepository;
  commands: BotMessageCommand[];
  authorizations: unknown[];
  preflights: unknown[];
  events: string[];
} {
  const commands: BotMessageCommand[] = [];
  const authorizations: unknown[] = [];
  const preflights: unknown[] = [];
  const events: string[] = [];
  const repository: BotMethodRepository = {
    async getMe() {
      return { id: BOT_ID, username: "cube_bot", is_bot: true };
    },
    async preflightMediaCommand(input) {
      events.push("preflight");
      preflights.push(input);
      return { result: null, duplicate: false };
    },
    async executeMessageCommand(command) {
      events.push("execute");
      commands.push(command);
      return { result: { message_id: MESSAGE_ID }, duplicate: false };
    },
    async authorizeMedia(input) {
      events.push("authorize");
      authorizations.push(input);
    },
    async replaceCommands() {
      return { result: { commands: [] }, duplicate: false };
    },
    async getCommands() {
      return [];
    },
    async lookupFile() {
      return {
        messageId: MESSAGE_ID,
        bucket: "chat-media",
        objectPath: `${CHAT_ID}/bots/${BOT_ID}/private.pdf`,
        mimeType: "application/pdf",
        fileName: "private.pdf",
        sizeBytes: 42,
      };
    },
    async createSignedFileUrl(_bucket, _objectPath, expiresInSeconds) {
      assert.equal(expiresInSeconds, 60);
      return "https://storage.example.test/signed/private.pdf";
    },
    async answerCallback() {
      return { result: true, duplicate: false };
    },
    ...overrides,
  };
  return { repository, commands, authorizations, preflights, events };
}

const context = {
  bot: { botId: BOT_ID, tokenId: TOKEN_ID },
  requestId: REQUEST_ID,
};

test("new media requests preflight, authorize the exact object, then execute", async () => {
  const { repository, commands, authorizations, preflights, events } =
    createRepository();
  const handlers = createTask3MethodHandlers({
    repository,
    fingerprint: (method, input) =>
      createBotRequestFingerprint(PEPPER, method, input),
    publishChatAction: async () => undefined,
  });
  const objectPath = `${CHAT_ID}/bots/${BOT_ID}/photo.jpg`;

  const result = await handlers.sendPhoto!(context, {
    chat_id: CHAT_ID,
    media: {
      bucket: "chat-media",
      object_path: objectPath,
      mime_type: "image/jpeg",
      size_bytes: 2048,
    },
    caption: "Photo",
    idempotency_key: "photo:handler:1",
  });

  assert.deepEqual(result, { message_id: MESSAGE_ID });
  assert.deepEqual(events, ["preflight", "authorize", "execute"]);
  assert.equal(preflights.length, 1);
  assert.deepEqual(preflights[0], {
    botId: BOT_ID,
    chatId: CHAT_ID,
    kind: "image",
    idempotencyKey: "photo:handler:1",
    requestFingerprint: commands[0]?.requestFingerprint,
  });
  assert.deepEqual(authorizations, [
    {
      botId: BOT_ID,
      chatId: CHAT_ID,
      bucket: "chat-media",
      objectPath,
      mimeType: "image/jpeg",
      sizeBytes: 2048,
      expiresInSeconds: 60,
    },
  ]);
  assert.equal(commands.length, 1);
  assert.match(commands[0]?.requestFingerprint ?? "", /^[0-9a-f]{64}$/);
  assert.deepEqual(commands[0], {
    botId: BOT_ID,
    chatId: CHAT_ID,
    kind: "image",
    payload: {
      text: "Photo",
      media_bucket: "chat-media",
      media_path: objectPath,
      media_metadata: {
        mime_type: "image/jpeg",
        size: 2048,
        kind: "image",
      },
    },
    idempotencyKey: "photo:handler:1",
    requestFingerprint: commands[0]?.requestFingerprint,
  });
});

test("completed media retries return the preflight result without grant mutation", async () => {
  const preflights: unknown[] = [];
  const { repository } = createRepository({
    async preflightMediaCommand(input) {
      preflights.push(input);
      return { result: { message_id: MESSAGE_ID }, duplicate: true };
    },
    async authorizeMedia() {
      throw new Error("completed retry must not authorize media");
    },
    async executeMessageCommand() {
      throw new Error("completed retry must not execute the command");
    },
  });
  const handlers = createTask3MethodHandlers({
    repository,
    fingerprint: (method, input) =>
      createBotRequestFingerprint(PEPPER, method, input),
    publishChatAction: async () => undefined,
  });

  const result = await handlers.sendPhoto!(context, {
    chat_id: CHAT_ID,
    media: {
      bucket: "chat-media",
      object_path: `${CHAT_ID}/bots/${BOT_ID}/completed.jpg`,
      mime_type: "image/jpeg",
      size_bytes: 2048,
    },
    idempotency_key: "photo:completed:1",
  });

  assert.deepEqual(result, { message_id: MESSAGE_ID });
  assert.equal(preflights.length, 1);
  assert.match(
    String((preflights[0] as Record<string, unknown>).requestFingerprint),
    /^[0-9a-f]{64}$/,
  );
});

test("chat actions publish bounded bot identity only after non-duplicate database authorization", async () => {
  let duplicate = false;
  const published: unknown[] = [];
  const { repository } = createRepository({
    async executeMessageCommand() {
      return { result: true, duplicate };
    },
  });
  const handlers = createTask3MethodHandlers({
    repository,
    fingerprint: (method, input) =>
      createBotRequestFingerprint(PEPPER, method, input),
    publishChatAction: async (payload) => {
      published.push(payload);
    },
  });
  const input = {
    chat_id: CHAT_ID,
    action: "typing" as const,
    idempotency_key: "action:handler:1",
  };

  assert.equal(await handlers.sendChatAction!(context, input), true);
  duplicate = true;
  assert.equal(await handlers.sendChatAction!(context, input), true);

  assert.deepEqual(published, [
    { botId: BOT_ID, chatId: CHAT_ID, action: "typing" },
  ]);
  assert.equal(JSON.stringify(published).includes("userId"), false);
});

test("getFile signs only the authorized private object for exactly 60 seconds", async () => {
  const { repository } = createRepository();
  const handlers = createTask3MethodHandlers({
    repository,
    fingerprint: (method, input) =>
      createBotRequestFingerprint(PEPPER, method, input),
    publishChatAction: async () => undefined,
  });

  const result = await handlers.getFile!(context, {
    chat_id: CHAT_ID,
    message_id: MESSAGE_ID,
  });

  assert.deepEqual(result, {
    file_id: MESSAGE_ID,
    mime_type: "application/pdf",
    file_name: "private.pdf",
    file_size: 42,
    url: "https://storage.example.test/signed/private.pdf",
    expires_in: 60,
  });
  assert.equal(JSON.stringify(result).includes("objectPath"), false);
  assert.equal(JSON.stringify(result).includes("bucket"), false);
});

test("commands and callback answers bind idempotency to a cryptographic fingerprint", async () => {
  const calls: unknown[] = [];
  const { repository } = createRepository({
    async replaceCommands(input) {
      calls.push(input);
      return { result: { commands: input.commands }, duplicate: false };
    },
    async answerCallback(input) {
      calls.push(input);
      return { result: true, duplicate: false };
    },
  });
  const handlers = createTask3MethodHandlers({
    repository,
    fingerprint: (method, input) =>
      createBotRequestFingerprint(PEPPER, method, input),
    publishChatAction: async () => undefined,
  });

  await handlers.setMyCommands!(context, {
    commands: [{ command: "start", description: "Start" }],
    idempotency_key: "commands:handler:1",
  });
  await handlers.answerCallbackQuery!(context, {
    callback_query_id: CALLBACK_ID,
    text: "Done",
    show_alert: true,
    idempotency_key: "callback:handler:1",
  });

  assert.equal(calls.length, 2);
  for (const value of calls as Array<Record<string, unknown>>) {
    assert.match(String(value.requestFingerprint), /^[0-9a-f]{64}$/);
  }
  assert.notEqual(
    (calls[0] as any).requestFingerprint,
    (calls[1] as any).requestFingerprint,
  );
});

test("edit without reply_markup omits the key so SQL can normalize it to clear", async () => {
  const { repository, commands } = createRepository();
  const handlers = createTask3MethodHandlers({
    repository,
    fingerprint: (method, input) =>
      createBotRequestFingerprint(PEPPER, method, input),
    publishChatAction: async () => undefined,
  });

  await handlers.editMessageText!(context, {
    chat_id: CHAT_ID,
    message_id: MESSAGE_ID,
    text: "Clear keyboard",
    idempotency_key: "edit:clear:1",
  });

  assert.deepEqual(commands[0]?.payload, {
    message_id: MESSAGE_ID,
    text: "Clear keyboard",
  });
  assert.equal("reply_markup" in (commands[0]?.payload ?? {}), false);
});
