import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import pino from "../../artifacts/api-server/node_modules/pino/pino.js";
import type { BotMethodHandlers } from "../../artifacts/api-server/src/bot/methodRouter.ts";

// Mutants alter executable modules in memory, never the shared checkout.
let mutations = 0;
const mutant = process.env.BOT_INLINE_CONTRACT_MUTANT;
if (mutant) {
  const changes: Record<string, [string, string, string]> = {
    "limit-down": ["schemas.ts", "MAX_INLINE_MEDIA_BYTES = 6 * 1024 * 1024", "MAX_INLINE_MEDIA_BYTES = 5 * 1024 * 1024"],
    "limit-up": ["schemas.ts", "MAX_INLINE_MEDIA_BYTES = 6 * 1024 * 1024", "MAX_INLINE_MEDIA_BYTES = 7 * 1024 * 1024"],
    "omit-canonical": ["schemas.ts", 'bytes.toString("base64") === value', "true"],
    "omit-source-count": ["schemas.ts", "if (supplied !== 1)", "if (false)"],
    "omit-inline-reply": ["schemas.ts", "inline !== undefined &&", "false &&"],
    "omit-filename-characters": ["schemas.ts", '.regex(/^[^/\\\\\\u0000-\\u001f\\u007f-\\u009f]+$/)', ""],
    "omit-filename-special": ["schemas.ts", 'value !== "" && value !== "." && value !== ".."', "true"],
    "filename-limit-up": ["schemas.ts", ".max(128)\n  .regex(/^[^/", ".max(129)\n  .regex(/^[^/"],
    "omit-filename-trim": ["schemas.ts", ".transform((value) => value.trim())", ".transform((value) => value)"],
    "omit-preauth": ["app.ts", "if (!isMediaUploadMethod(request.params.method)) return next();", "return next();"],
    "small-parser": ["app.ts", "isMediaUploadMethod(request.params.method) ? mediaJson : standardJson", "false ? mediaJson : standardJson"],
    "json-limit-down": ["app.ts", 'limit: "9mb"', 'limit: "8mb"'],
    "json-limit-up": ["app.ts", 'limit: "9mb"', 'limit: "10mb"'],
    "text-limit-down": ["app.ts", 'limit: "256kb"', 'limit: "255kb"'],
    "text-limit-up": ["app.ts", 'limit: "256kb"', 'limit: "257kb"'],
    "omit-auth-reuse": ["methodRouter.ts", "isMediaUploadMethod(method) && response.locals.botGatewayBot", "false && response.locals.botGatewayBot"],
    "global-limit-up": ["mediaAdmission.ts", "activeBots.size >= 4", "activeBots.size >= 5"],
    "global-limit-down": ["mediaAdmission.ts", "activeBots.size >= 4", "activeBots.size >= 3"],
    "omit-per-bot": ["mediaAdmission.ts", " || activeBots.has(botId)", ""],
    "retry-after-two": ["mediaAdmission.ts", 'new BotApiError("rate_limited", 1)', 'new BotApiError("rate_limited", 2)'],
    "retain-bot-entry": ["mediaAdmission.ts", "activeBots.delete(botId);", ""],
    "omit-handler-release": ["methodRouter.ts", "mediaAdmission?.release();", ""],
    "early-response-release": ["app.ts", "if (!handlerStarted) release();", "release();"],
    "early-request-release": ["app.ts", 'request.once("aborted", releaseBeforeHandler);', 'request.once("close", release);'],
    "omit-auth-disconnect-check": ["app.ts", "if (request.aborted || response.destroyed) return;", ""],
  };
  const change = changes[mutant];
  assert.ok(change, "known mutation selection");
  registerHooks({
    load(url, context, nextLoad) {
      if (!url.endsWith(`/bot/${change[0]}`)) return nextLoad(url, context);
      const source = readFileSync(new URL(url), "utf8").replace(/\r\n/g, "\n");
      // Source-count omission covers both photo and the new shared refinement.
      const matches = source.split(change[1]).length - 1;
      assert.equal(matches, mutant === "omit-source-count" ? 2 : 1, "mutation anchor count");
      mutations += 1;
      return {
        format: "module",
        source: stripTypeScriptTypes(source.replaceAll(change[1], change[2])),
        shortCircuit: true,
      };
    },
  });
}

const { parseBotMethodInput } = await import("../../artifacts/api-server/src/bot/schemas.ts");
const { createBotGatewayApp } = await import("../../artifacts/api-server/src/bot/app.ts");
const { BotApiError } = await import("../../artifacts/api-server/src/bot/errors.ts");
test.after(() => { if (mutant) assert.equal(mutations, 1, "one production module mutated"); });

const CHAT_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";
const BOT_ID = "33333333-3333-4333-8333-333333333333";
const TOKEN_ID = "44444444-4444-4444-8444-444444444444";
const AUTHORIZATION = "Bot synthetic-inline-contract";
const METHODS = [
  { method: "sendDocument", field: "document", mime: "application/pdf" },
  { method: "sendVideo", field: "video", mime: "video/mp4" },
  { method: "sendVoice", field: "voice", mime: "audio/ogg" },
] as const;
const MIMES = [
  { ...METHODS[0] },
  { ...METHODS[1] },
  { ...METHODS[1], mime: "video/webm" },
  { ...METHODS[2], mime: "audio/webm" },
  { ...METHODS[2] },
  { ...METHODS[2], mime: "audio/mpeg" },
] as const;

function body(item: { field: string; mime: string }, bytes_base64 = "AA==") {
  return {
    chat_id: CHAT_ID,
    [item.field]: { mime_type: item.mime, bytes_base64 },
    idempotency_key: "inline-contract-0001",
  };
}

function reference(mime: string) {
  return {
    bucket: "chat-media",
    object_path: `${CHAT_ID}/bots/${BOT_ID}/${"f".repeat(64)}.bin`,
    mime_type: mime,
    size_bytes: 104_857_600,
  };
}

for (const item of MIMES) {
  test(`${item.method} ${item.mime} accepts exactly 6291456 bytes and refuses 6291457`, () => {
    const exact = Buffer.alloc(6_291_456).toString("base64");
    const parsed = parseBotMethodInput(item.method, body(item, exact)) as Record<string, any>;
    assert.equal(Buffer.from(parsed[item.field].bytes_base64, "base64").length, 6_291_456);
    assert.equal(parsed[item.field].mime_type, item.mime);
    assert.throws(() => parseBotMethodInput(item.method, body(item, Buffer.alloc(6_291_457).toString("base64"))));
  });
}

for (const item of METHODS) {
  test(`${item.method} keeps media/file_id compatible and requires exactly one source`, () => {
    assert.doesNotThrow(() => parseBotMethodInput(item.method, body(item)));
    const base = { chat_id: CHAT_ID, idempotency_key: "inline-contract-0002" };
    assert.equal(parseBotMethodInput(item.method, { ...base, file_id: MESSAGE_ID }).file_id, MESSAGE_ID);
    assert.equal(parseBotMethodInput(item.method, { ...base, media: reference(item.mime) }).media?.size_bytes, 104_857_600);
    for (const fields of [
      {},
      { media: reference(item.mime), file_id: MESSAGE_ID },
      { ...body(item), file_id: MESSAGE_ID },
      { ...body(item), media: reference(item.mime) },
      { ...body(item), file_id: MESSAGE_ID, media: reference(item.mime) },
    ]) assert.throws(() => parseBotMethodInput(item.method, { ...base, ...fields }));
    for (const fields of [
      { topic_id: CHAT_ID },
      { reply_to_message_id: MESSAGE_ID },
      { reply_markup: { inline_keyboard: [[{ text: "OK", callback_data: "ok" }]] } },
    ]) {
      assert.throws(() => parseBotMethodInput(item.method, { ...body(item), ...fields }));
      assert.doesNotThrow(() => parseBotMethodInput(item.method, { ...base, file_id: MESSAGE_ID, ...fields }));
      assert.doesNotThrow(() => parseBotMethodInput(item.method, { ...base, media: reference(item.mime), ...fields }));
    }
  });

  test(`${item.method} rejects noncanonical base64 including nonzero pad bits`, () => {
    assert.doesNotThrow(() => parseBotMethodInput(item.method, body(item, "AA==")));
    assert.doesNotThrow(() => parseBotMethodInput(item.method, body(item, "AAA=")));
    assert.doesNotThrow(() => parseBotMethodInput(item.method, body(item, "AAAA")));
    for (const invalid of ["", "AA", "A===", "AB==", "AAB=", "AA==\n", " AA==", "____", "data:application/pdf;base64,AA=="]) {
      assert.throws(() => parseBotMethodInput(item.method, body(item, invalid)), JSON.stringify(invalid));
    }
  });

  test(`${item.method} rejects another MIME family, URLs, duration, and unknown inline fields`, () => {
    assert.doesNotThrow(() => parseBotMethodInput(item.method, body(item)));
    for (const inline of [
      { mime_type: "text/plain", bytes_base64: "AA==" },
      { mime_type: "image/png", bytes_base64: "AA==" },
      { mime_type: item.mime, url: "https://fixture.invalid/file" },
      { mime_type: item.mime, bytes_base64: "AA==", duration: 10 },
      { mime_type: item.mime, bytes_base64: "AA==", duration_ms: 10_000 },
      { mime_type: item.mime, bytes_base64: "AA==", width: 320 },
      { mime_type: item.mime, bytes_base64: "AA==", extra: true },
    ]) assert.throws(() => parseBotMethodInput(item.method, { ...body(item), [item.field]: inline }));
    if (item.field !== "document") {
      assert.throws(() => parseBotMethodInput(item.method, {
        ...body(item), [item.field]: { mime_type: item.mime, bytes_base64: "AA==", file_name: "file.bin" },
      }));
    }
    for (const other of METHODS.filter((other) => other.method !== item.method)) {
      assert.throws(() => parseBotMethodInput(item.method, { ...body(item), [other.field]: { mime_type: other.mime, bytes_base64: "AA==" } }));
    }
  });
}

test("PDF filename is optional, trimmed, a single basename, and bounded to 128 characters", () => {
  const input = body(METHODS[0]);
  assert.equal(parseBotMethodInput("sendDocument", input).document?.file_name, undefined);
  for (const [file_name, expected] of [
    [" report.pdf ", "report.pdf"],
    ["report final.pdf", "report final.pdf"],
    [".hidden.pdf", ".hidden.pdf"],
    ["\u043e\u0442\u0447\u0451\u0442.pdf", "\u043e\u0442\u0447\u0451\u0442.pdf"],
    ["a".repeat(124) + ".pdf", "a".repeat(124) + ".pdf"],
  ]) {
    const parsed = parseBotMethodInput("sendDocument", {
      ...input, document: { ...(input.document as object), file_name },
    });
    assert.equal(parsed.document?.file_name, expected);
  }
});

test("PDF filename rejects paths, controls, dot/dotdot, blank, and 129 characters", () => {
  const input = body(METHODS[0]);
  assert.doesNotThrow(() => parseBotMethodInput("sendDocument", input));
  for (const file_name of [
    "folder/report.pdf", "folder\\report.pdf", "/report.pdf", "\\report.pdf",
    "", " ", "   ", ".", "..", " . ", " .. ",
    "a\u0000.pdf", "a\n.pdf", "\treport.pdf", "report.pdf\r", "a\u007f.pdf", "a\u0085.pdf", "a\u009f.pdf",
    "a".repeat(125) + ".pdf",
  ]) {
    assert.throws(() => parseBotMethodInput("sendDocument", {
      ...input, document: { ...(input.document as object), file_name },
    }), JSON.stringify(file_name));
  }
});

async function fixture(t: any, unauthorized = false) {
  const seen: { auth: number; executions: number; bot?: unknown } = { auth: 0, executions: 0 };
  const bot = { botId: BOT_ID, tokenId: TOKEN_ID };
  const handlers = Object.fromEntries(METHODS.map((item) => [item.method, async (context: any, input: any) => {
    seen.executions += 1;
    seen.bot = context.bot;
    const inline = input[item.field];
    return {
      message_id: MESSAGE_ID,
      chat_id: input.chat_id,
      source: inline ? item.field : input.file_id ? "file_id" : "media",
      byte_size: inline ? Buffer.from(inline.bytes_base64, "base64").length : null,
      file_name: inline?.file_name ?? null,
    };
  }])) as BotMethodHandlers;
  handlers.sendMessage = async () => { seen.executions += 1; return { message_id: MESSAGE_ID }; };
  const app = createBotGatewayApp({
    logger: pino({ enabled: false }), handlers,
    tokenRepository: { async authenticateBotToken(header) {
      seen.auth += 1;
      assert.equal(header, AUTHORIZATION);
      if (unauthorized) throw new BotApiError("unauthorized");
      return bot;
    } },
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}/bot/v1/`;
  return {
    endpoint, seen, bot,
    async post(method: string, input: object | string) {
      const response = await fetch(endpoint + method, {
        method: "POST", headers: { authorization: AUTHORIZATION, "content-type": "application/json" },
        body: typeof input === "string" ? input : JSON.stringify(input),
      });
      return { status: response.status, body: await response.json() as any };
    },
  };
}

function jsonAtBytes(length: number) {
  const fixed = '{"padding":""}';
  return '{"padding":"' + "a".repeat(length - Buffer.byteLength(fixed)) + '"}';
}

for (const item of METHODS) {
  test(`${item.method} admits 6291456 inline bytes and reuses preauth for inline/file_id/media`, async (t) => {
    const f = await fixture(t);
    const input = body(item, Buffer.alloc(6_291_456).toString("base64"));
    if (item.field === "document") (input[item.field] as any).file_name = " report.pdf ";
    const result = await f.post(item.method, input);
    assert.equal(result.status, 200);
    assert.equal(result.body.result.byte_size, 6_291_456);
    assert.equal(result.body.result.source, item.field);
    assert.equal(result.body.result.file_name, item.field === "document" ? "report.pdf" : null);
    assert.equal(f.seen.auth, 1);
    assert.equal(f.seen.executions, 1);
    assert.equal(f.seen.bot, f.bot);
    for (const fields of [{ file_id: MESSAGE_ID }, { media: reference(item.mime) }]) {
      const response = await f.post(item.method, { chat_id: CHAT_ID, ...fields, idempotency_key: "inline-contract-legacy" });
      assert.equal(response.status, 200);
      assert.equal(response.body.result.source, "file_id" in fields ? "file_id" : "media");
    }
    assert.equal(f.seen.auth, 3);
    assert.equal(f.seen.executions, 3);
  });

  test(`${item.method} admits 9437184 JSON bytes but rejects 9437185 before execution`, async (t) => {
    const f = await fixture(t);
    const exact = await f.post(item.method, jsonAtBytes(9_437_184));
    assert.equal(exact.status, 400, "exact parser bound must reach schema validation, not 413");
    assert.equal(exact.body.error.code, "validation_failed");
    const oversized = await f.post(item.method, jsonAtBytes(9_437_185));
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body.error.code, "payload_too_large");
    assert.equal(f.seen.auth, 2);
    assert.equal(f.seen.executions, 0);
  });

  test(`${item.method} rejects unauthorized headers before any body bytes are supplied`, async (t) => {
    const f = await fixture(t, true);
    const outcome = await new Promise<{ status: number | null; code?: string }>((resolve, reject) => {
      const request = httpRequest(f.endpoint + item.method, {
        method: "POST", headers: {
          authorization: AUTHORIZATION, "content-type": "application/json", "content-length": "9437185",
        },
      }, (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { data += chunk; });
        response.on("end", () => {
          clearTimeout(timer);
          resolve({ status: response.statusCode ?? null, code: JSON.parse(data).error?.code });
          request.destroy();
        });
      });
      request.on("error", reject);
      const timer = setTimeout(() => { resolve({ status: null }); request.destroy(); }, 1_500);
      request.flushHeaders();
    });
    assert.equal(outcome.status, 401, "auth must refuse without waiting for the JSON body");
    assert.equal(outcome.code, "unauthorized");
    assert.equal(f.seen.auth, 1);
    assert.equal(f.seen.executions, 0);
  });
}

test("sendMessage retains exactly 262144 JSON bytes and rejects 262145 before auth", async (t) => {
  const f = await fixture(t);
  const exact = await f.post("sendMessage", jsonAtBytes(262_144));
  assert.equal(exact.status, 400);
  assert.equal(exact.body.error.code, "validation_failed");
  assert.equal(f.seen.auth, 1);
  const oversized = await f.post("sendMessage", jsonAtBytes(262_145));
  assert.equal(oversized.status, 413);
  assert.equal(f.seen.auth, 1);
  assert.equal(f.seen.executions, 0);
  assert.equal((await f.post("sendMessage", { chat_id: CHAT_ID, text: "control", idempotency_key: "inline-contract-text" })).status, 200);
  assert.equal(f.seen.executions, 1);
});

test("sendPhoto keeps its original 6291456 byte boundary and source/reply restriction", () => {
  const input = {
    chat_id: CHAT_ID, photo: { mime_type: "image/png", bytes_base64: Buffer.alloc(6_291_456).toString("base64") },
    idempotency_key: "inline-contract-photo",
  };
  assert.doesNotThrow(() => parseBotMethodInput("sendPhoto", input));
  assert.throws(() => parseBotMethodInput("sendPhoto", {
    ...input, photo: { ...input.photo, bytes_base64: Buffer.alloc(6_291_457).toString("base64") },
  }));
  assert.throws(() => parseBotMethodInput("sendPhoto", { ...input, file_id: MESSAGE_ID }));
  assert.throws(() => parseBotMethodInput("sendPhoto", { ...input, reply_to_message_id: MESSAGE_ID }));
});

async function until(check: () => boolean, message: string) {
  for (let i = 0; i < 100; i += 1) {
    if (check()) return;
    await delay(10);
  }
  assert.equal(check(), true, message);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function admissionFixture(t: any) {
  const holds = new Map<string, ReturnType<typeof deferred>>();
  const authHolds = new Map<string, ReturnType<typeof deferred>>();
  const failures = new Set<string>();
  const seen = { auth: [] as string[], entered: [] as string[], finished: [] as string[], closed: [] as string[] };
  const clients = new Set<ReturnType<typeof httpRequest>>();
  const handlers = Object.fromEntries(["sendPhoto", "sendDocument", "sendVideo", "sendVoice", "sendMessage"].map((method) => [method, async (context: any) => {
    const botId = context.bot.botId;
    seen.entered.push(botId);
    if (method !== "sendMessage") await holds.get(botId)?.promise;
    seen.finished.push(botId);
    if (failures.delete(botId)) throw new BotApiError("internal_error");
    return { message_id: MESSAGE_ID };
  }])) as BotMethodHandlers;
  const app = createBotGatewayApp({ logger: pino({ enabled: false }), handlers,
    tokenRepository: { async authenticateBotToken(header) {
      assert.equal(typeof header, "string");
      const botId = (header as string).slice("Bot synthetic-".length);
      seen.auth.push(botId);
      await authHolds.get(botId)?.promise;
      return { botId, tokenId: TOKEN_ID };
    } },
  });
  const server = createServer(app);
  server.on("request", (request, response) => {
    response.once("close", () => { seen.closed.push(String(request.headers.authorization).slice("Bot synthetic-".length)); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const hold of holds.values()) hold.resolve();
    for (const hold of authHolds.values()) hold.resolve();
    for (const client of clients) client.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}/bot/v1/`;
  return {
    seen, failures,
    hold(botId: string) { const hold = deferred(); holds.set(botId, hold); return hold; },
    holdAuth(botId: string) { const hold = deferred(); authHolds.set(botId, hold); return hold; },
    start(botId: string, method = "sendVoice", payload: string | null = JSON.stringify({
      chat_id: CHAT_ID, file_id: MESSAGE_ID, idempotency_key: "admission-file-id",
    })) {
      let done!: (result: { status: number | null; body?: any }) => void;
      const result = new Promise<{ status: number | null; body?: any }>((resolve) => { done = resolve; });
      const request = httpRequest(endpoint + method, {
        method: "POST", headers: { authorization: `Bot synthetic-${botId}`, "content-type": "application/json",
          "content-length": payload === null ? "9437185" : Buffer.byteLength(payload) },
      }, (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { data += chunk; });
        response.on("end", () => { done({ status: response.statusCode ?? null, body: JSON.parse(data) }); });
      });
      clients.add(request);
      request.on("error", () => { done({ status: null }); });
      request.on("close", () => { clients.delete(request); });
      if (payload === null) request.flushHeaders(); else request.end(payload);
      return { request, result, async boundedResult() {
        let timer: ReturnType<typeof setTimeout>;
        try {
          return await Promise.race([result, new Promise<{ status: null; body: undefined }>((resolve) => {
            timer = setTimeout(() => resolve({ status: null, body: undefined }), 1_500);
          })]);
        } finally { clearTimeout(timer!); }
      } };
    },
  };
}

test("process-global admission accepts four bots across app instances and refuses a fifth before body", async (t) => {
  const first = await admissionFixture(t);
  const second = await admissionFixture(t);
  const pending = [];
  const holds = [];
  for (const [index, botId] of ["global-1", "global-2", "global-3", "global-4"].entries()) {
    const f = index < 2 ? first : second;
    holds.push(f.hold(botId));
    pending.push(f.start(botId));
    await until(() => f.seen.entered.includes(botId), "one of four control handlers must start");
  }
  const refused = await second.start("global-5", "sendPhoto", null).boundedResult();
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error.retry_after, 1);
  assert.equal(second.seen.entered.includes("global-5"), false);
  assert.equal((await first.start("global-1", "sendMessage", JSON.stringify({
    chat_id: CHAT_ID, text: "control", idempotency_key: "admission-text-control",
  })).boundedResult()).status, 200, "text must remain independent of media permits");
  holds[0].resolve();
  assert.equal((await pending[0].result).status, 200);
  assert.equal((await second.start("global-5").boundedResult()).status, 200, "handler finally must free global capacity");
  for (const hold of holds) hold.resolve();
  for (const request of pending) assert.equal((await request.result).status, 200);
});

test("per-bot admission holds through completed body and spans all four media methods", async (t) => {
  const f = await admissionFixture(t);
  const hold = f.hold("same-bot");
  const first = f.start("same-bot", "sendVoice");
  await until(() => f.seen.entered.length === 1, "file_id control handler must start");
  for (const method of ["sendPhoto", "sendVideo", "sendDocument"]) {
    const refused = await f.start("same-bot", method, null).boundedResult();
    assert.equal(refused.status, 429, "completed request body must not release a running handler's permit");
    assert.equal(refused.body.error.retry_after, 1);
  }
  assert.equal(f.seen.entered.length, 1);
  hold.resolve();
  assert.equal((await first.result).status, 200);
  assert.equal((await f.start("same-bot", "sendDocument").boundedResult()).status, 200);
});

test("parser and schema errors release admission without retaining stale bot entries", async (t) => {
  const f = await admissionFixture(t);
  for (let index = 0; index < 12; index += 1) {
    const botId = `invalid-${index}`;
    const invalid = await f.start(botId, "sendVoice", "{").boundedResult();
    assert.equal(invalid.status, 400);
    const schema = await f.start(botId, "sendDocument", "{}").boundedResult();
    assert.equal(schema.status, 400);
    const oversized = await f.start(botId, "sendVideo", jsonAtBytes(9_437_185)).boundedResult();
    assert.equal(oversized.status, 413);
    assert.equal((await f.start(botId).boundedResult()).status, 200);
  }
  assert.equal(f.seen.entered.length, 12, "only positive file_id controls may execute");
});

test("disconnect during a partial body releases the same bot and global capacity", async (t) => {
  const f = await admissionFixture(t);
  const partial = f.start("partial-body", "sendVideo", null);
  await until(() => f.seen.auth.includes("partial-body"), "auth must run before the unsupplied body");
  partial.request.destroy();
  await until(() => f.seen.closed.includes("partial-body"), "server must observe the disconnect");
  assert.equal((await f.start("partial-body").boundedResult()).status, 200);
  const holds = [];
  const pending = [];
  for (let index = 0; index < 4; index += 1) {
    const botId = `after-abort-${index}`;
    holds.push(f.hold(botId));
    pending.push(f.start(botId));
    await until(() => f.seen.entered.includes(botId), "all four permits must survive partial-body cleanup");
  }
  for (const hold of holds) hold.resolve();
  for (const request of pending) assert.equal((await request.result).status, 200);
});

test("response disconnect cannot free admission while its handler is still running", async (t) => {
  const f = await admissionFixture(t);
  const hold = f.hold("running-disconnect");
  const running = f.start("running-disconnect");
  await until(() => f.seen.entered.length === 1, "control handler must start");
  running.request.destroy();
  await until(() => f.seen.closed.includes("running-disconnect"), "server response must have closed");
  const refused = await f.start("running-disconnect", "sendDocument", null).boundedResult();
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error.retry_after, 1);
  hold.resolve();
  await until(() => f.seen.finished.includes("running-disconnect"), "disconnected handler must settle");
  assert.equal((await f.start("running-disconnect").boundedResult()).status, 200);
});

test("handler rejection releases admission in finally", async (t) => {
  const f = await admissionFixture(t);
  f.failures.add("failed-handler");
  assert.equal((await f.start("failed-handler").boundedResult()).status, 500);
  assert.equal((await f.start("failed-handler").boundedResult()).status, 200);
  assert.equal(f.seen.entered.length, 2);
});

test("disconnect while auth is pending cannot leave a permit acquired after response close", async (t) => {
  const f = await admissionFixture(t);
  const authHold = f.holdAuth("auth-disconnect");
  const pending = f.start("auth-disconnect", "sendVideo", null);
  await until(() => f.seen.auth.includes("auth-disconnect"), "auth must have started");
  pending.request.destroy();
  await until(() => f.seen.closed.includes("auth-disconnect"), "response must close before auth resolves");
  authHold.resolve();
  assert.equal((await f.start("auth-disconnect").boundedResult()).status, 200);
  assert.equal(f.seen.entered.length, 1, "only the connected retry may execute");
});
