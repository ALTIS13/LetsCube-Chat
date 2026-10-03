import assert from "node:assert/strict";
import test from "node:test";
import { createBotMethodRepository } from "../../artifacts/api-server/src/bot/repository.ts";
import { BotApiError, toBotApiErrorResponse } from "../../artifacts/api-server/src/bot/errors.ts";
import { createBotMethodRouter, createBotRequestFingerprint, createTask3MethodHandlers }
  from "../../artifacts/api-server/src/bot/methodRouter.ts";

// Real repository/handlers/router; only DB transport and token lookup are doubles.
// No PostgREST, DB locks, Storage, token validation or production proof here.
const bot = "e5070000-0000-4000-8000-000000000003";
const token = "e5070000-0000-4000-8000-000000000099";
const chat = "e5070000-0000-4000-8000-000000000004";
const source = "e5070000-0000-4000-8000-000000000006";
const identity = { idempotencyKey: "fictional-busy-0001", requestFingerprint: "a".repeat(64) };
const busy = { code: "55P03", message: "fictional private lock detail",
  details: "fictional private table", hint: "fictional internal hint", status: 500 };
const failure = (code, retry = false) => ({ ok: false, error: { code,
  message: code === "service_unavailable" ? "Service unavailable" : code === "forbidden" ? "Forbidden" : "Internal server error",
  request_id: "fictional-busy-request", ...(retry ? { retry_after: 2 } : {}) } });

function fixture(answer) {
  const calls = [];
  const repository = createBotMethodRepository({
    async rpc(name, args) { calls.push({ name, args: structuredClone(args) }); return answer(name, args, calls.length); },
    storage: { from() { assert.fail("busy handling cannot PUT/download/sign"); } },
    channel() { assert.fail("busy handling cannot publish"); },
  });
  const handlers = createTask3MethodHandlers({ repository,
    fingerprint: (method, input) => createBotRequestFingerprint("fictional-busy-fingerprint-key", method, input),
    publishChatAction: async () => assert.fail("no side-effect publish on refusal"),
  });
  const router = createBotMethodRouter({ handlers, tokenRepository: {
    async authenticateBotToken() { return { botId: bot, tokenId: token }; },
  } });
  async function route(method, body) {
    const result = { status: 200, headers: {}, body: null };
    const response = { locals: {}, destroyed: false, writableEnded: false,
      setHeader(name, value) { result.headers[name.toLowerCase()] = String(value); },
      status(value) { result.status = value; return this; },
      json(value) { result.body = value; this.writableEnded = true; return this; },
    };
    await router({ params: { method }, body: structuredClone(body),
      id: "fictional-busy-request", rawHeaders: [], headersDistinct: {} }, response);
    return result;
  }
  return { repository, calls, route };
}

async function envelope(run) {
  let error;
  try { await run(); } catch (cause) { error = cause; }
  assert.ok(error instanceof BotApiError, "actual typed refusal, not success or fixture failure");
  return toBotApiErrorResponse(error, "fictional-busy-request");
}

const command = (kind) => ({ botId: bot, chatId: chat, kind, payload: { text: "Fictional text" }, ...identity });
const preflight = (kind) => ({ botId: bot, chatId: chat, kind, ...identity });
const commit = { botId: bot, tokenId: token, leaseId: "e5070000-0000-4000-8000-000000000098",
  payload: { media_bucket: "chat-media", media_path: "fictional-object" }, ...identity };
const reserve = { botId: bot, tokenId: token, chatId: chat, kind: "image", ...identity,
  leaseId: commit.leaseId, objectPath: "fictional-object", mimeType: "image/png", sizeBytes: 68, contentSha256: "b".repeat(64) };

// Missing allowlist members, a non-55P03 branch, or a changed retry delay must
// alter a consumer-visible literal envelope, not merely a source-text needle.
for (const kind of ["text", "image", "video", "file", "audio", "edit", "delete"]) {
  test(`idempotent ${kind} message command maps only lock-unavailable to sanitized 503`, async () => {
    const f = fixture(() => ({ data: null, error: busy }));
    assert.deepEqual(await envelope(() => f.repository.executeMessageCommand(command(kind))),
      { status: 503, body: failure("service_unavailable", true) });
    assert.equal(f.calls.length, 1, "no internal retry");
  });
}
for (const kind of ["image", "video", "file", "audio"]) {
  test(`idempotent ${kind} media preflight maps 55P03 before any provider action`, async () => {
    const f = fixture(() => ({ data: null, error: busy }));
    assert.deepEqual(await envelope(() => f.repository.preflightMediaCommand(preflight(kind))),
      { status: 503, body: failure("service_unavailable", true) });
    assert.equal(f.calls.length, 1);
  });
}
test("idempotent inline commit maps 55P03 without repeating upload", async () => {
  const f = fixture(() => ({ data: null, error: busy }));
  assert.deepEqual(await envelope(() => f.repository.commitInlineMedia(commit)),
    { status: 503, body: failure("service_unavailable", true) });
  assert.deepEqual(f.calls.map((call) => call.name), ["bot_media_ingest_commit_internal"]);
});
test("command-list writes remain outside the message busy contract", async () => {
  const f = fixture(() => ({ data: null, error: busy }));
  assert.deepEqual(await envelope(() => f.repository.replaceCommands({ botId: bot, commands: [], ...identity })),
    { status: 500, body: failure("internal_error") });
  assert.equal(f.calls.length, 1);
});

test("actual text router returns retry header, and explicit unchanged retry checks fresh refusal", async () => {
  const f = fixture((name, args, number) => ({ data: null, error: number === 1 ? busy :
    { code: "42501", message: "fictional authority revoked" } }));
  const input = { chat_id: chat, text: "Fictional retry text", idempotency_key: "fictional-route-0001" };
  const first = await f.route("sendMessage", input);
  assert.deepEqual(first, { status: 503, headers: { "retry-after": "2" }, body: failure("service_unavailable", true) });
  assert.equal(f.calls.length, 1, "response must not silently rerun a write");
  const second = await f.route("sendMessage", input);
  assert.deepEqual(second, { status: 403, headers: {}, body: failure("forbidden") });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1], f.calls[0], "same bot/chat/key/fingerprint/payload reaches SQL anew");
  assert.equal(f.calls[0].name, "bot_message_command_internal");
  assert.equal(f.calls[0].args.p_method, "sendMessage");
  assert.equal(f.calls[0].args.p_idempotency_key, "fictional-route-0001");
  assert.deepEqual(f.calls[0].args.p_payload, { text: "Fictional retry text" });
});

test("actual media handler stops at busy preflight and retries unchanged into permission refusal", async () => {
  const f = fixture((name, args, number) => ({ data: null, error: number === 1 ? busy : { code: "42501" } }));
  const input = { chat_id: chat, file_id: source, idempotency_key: "fictional-route-0002" };
  assert.deepEqual(await f.route("sendDocument", input),
    { status: 503, headers: { "retry-after": "2" }, body: failure("service_unavailable", true) });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(await f.route("sendDocument", input), { status: 403, headers: {}, body: failure("forbidden") });
  assert.deepEqual(f.calls.map((call) => call.name), ["bot_media_command_preflight_internal", "bot_media_command_preflight_internal"]);
  assert.deepEqual(f.calls[1].args, f.calls[0].args);
  assert.equal(f.calls[0].args.p_method, "sendDocument");
  assert.equal(f.calls[0].args.p_idempotency_key, "fictional-route-0002");
});

test("busy message commit exits the real media handler without internal retry or PUT", async () => {
  const f = fixture((name) => name === "bot_media_command_preflight_internal"
    ? { data: { result: null, duplicate: false }, error: null } : { data: null, error: busy });
  assert.deepEqual(await f.route("sendDocument", { chat_id: chat, file_id: source, idempotency_key: "fictional-route-0003" }),
    { status: 503, headers: { "retry-after": "2" }, body: failure("service_unavailable", true) });
  assert.deepEqual(f.calls.map((call) => call.name), ["bot_media_command_preflight_internal", "bot_message_command_internal"]);
  assert.deepEqual(f.calls[1].args.p_payload, { file_id: "e5070000-0000-4000-8000-000000000006" });
});

test("real inline handler performs one admitted PUT then exits busy commit; revoked explicit retry cannot PUT", async () => {
  const calls = [], uploads = [];
  let revoked = false;
  const repository = createBotMethodRepository({
    async rpc(name, args) {
      calls.push({ name, args: structuredClone(args) });
      switch (name) {
        case "bot_media_ingest_reserve_internal":
          return revoked ? { data: null, error: { code: "42501", message: "bot_chat_forbidden" } } :
            { data: { result: null, duplicate: false, lease_id: args.p_lease_id }, error: null };
        case "bot_media_upload_begin_internal":
          return { data: { attempt_id: args.p_lease_id, state: "pending" }, error: null };
        case "bot_media_upload_finish_internal":
          return { data: { attempt_id: args.p_attempt_id, state: "acknowledged" }, error: null };
        case "bot_media_ingest_commit_internal": return { data: null, error: busy };
        default: assert.fail("unexpected write/retry");
      }
    },
    storage: { from(bucket) {
      assert.equal(bucket, "chat-media");
      return { async upload(path, bytes, options) {
        uploads.push({ path, size: bytes.length, options }); return { data: { path }, error: null };
      }, download() { assert.fail("busy mapping must not repeat/verify a PUT"); } };
    } },
  });
  const handlers = createTask3MethodHandlers({ repository,
    fingerprint: (method, input) => createBotRequestFingerprint("fictional-busy-fingerprint-key", method, input),
    publishChatAction: async () => assert.fail("no publish"),
  });
  const input = { chat_id: chat, idempotency_key: "fictional-inline-busy",
    photo: { mime_type: "image/png", bytes_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l7sAAAAASUVORK5CYII=" } };
  const send = () => handlers.sendPhoto({ bot: { botId: bot, tokenId: token }, requestId: "fictional-busy-request" }, input);
  assert.deepEqual(await envelope(send), { status: 503, body: failure("service_unavailable", true) });
  assert.deepEqual(calls.map((call) => call.name), ["bot_media_ingest_reserve_internal", "bot_media_upload_begin_internal",
    "bot_media_upload_finish_internal", "bot_media_ingest_commit_internal"]);
  assert.equal(uploads.length, 1); assert.equal(uploads[0].size, 68);
  assert.deepEqual(uploads[0].options, { contentType: "image/png", upsert: false });
  revoked = true;
  assert.deepEqual(await envelope(send), { status: 403, body: failure("forbidden") });
  assert.equal(calls.length, 5); assert.equal(calls[4].name, "bot_media_ingest_reserve_internal");
  for (const key of ["p_bot_id", "p_token_id", "p_chat_id", "p_idempotency_key", "p_request_fingerprint",
    "p_object_path", "p_content_type", "p_byte_size", "p_content_sha256"])
    assert.deepEqual(calls[4].args[key], calls[0].args[key], "original identity/content retained; only a new lease is permitted");
  assert.equal(uploads.length, 1, "explicit retry's fresh authority refusal prevents another PUT");
});

for (const [label, invoke] of [
  ["identity", (r) => r.getMe(bot)], ["command read", (r) => r.getCommands(bot)],
  ["file read", (r) => r.lookupFile(bot, chat, source)],
  ["upload authorize", (r) => r.authorizeMedia({ botId: bot, chatId: chat, bucket: "chat-media", objectPath: "fictional", mimeType: "image/png", sizeBytes: 68, expiresInSeconds: 60 })],
  ["inline reservation", (r) => r.reserveInlineMedia(reserve)],
  ["callback", (r) => r.answerCallback({ botId: bot, callbackQueryId: source, text: null, showAlert: false, ...identity })],
  ["viewer", (r) => r.closeViewerInterface({ botId: bot, tokenId: token, interfaceId: source, expectedVersion: 1, ...identity })],
  ["chat action", (r) => r.executeMessageCommand(command("chat_action"))],
]) test(`55P03 in unrelated ${label} remains sanitized 500`, async () => {
  const f = fixture(() => ({ data: null, error: busy }));
  assert.deepEqual(await envelope(() => invoke(f.repository)), { status: 500, body: failure("internal_error") });
  assert.equal(f.calls.length, 1);
});

test("unknown message kind and non-media preflight do not inherit a retry grant", async () => {
  for (const invoke of [(r) => r.executeMessageCommand(command("unknown")), (r) => r.preflightMediaCommand(preflight("text"))]) {
    const f = fixture(() => ({ data: null, error: busy }));
    assert.deepEqual(await envelope(() => invoke(f.repository)), { status: 500, body: failure("internal_error") });
    assert.equal(f.calls.length, 1);
  }
});

for (const at of ["bot_media_upload_begin_internal", "bot_media_upload_finish_internal"])
  test(`55P03 in ${at} stays 500 and never retries provider I/O`, async () => {
    let uploads = 0;
    const calls = [];
    // Both upload paths remain real; only the external provider is a double.
    const client = { rpc: async (name, args) => {
      calls.push({ name, args });
      return name === at ? { data: null, error: busy } : {
        data: { attempt_id: args.p_lease_id, state: "pending" }, error: null,
      };
    }, storage: { from: () => ({ upload: async (path) => {
      uploads++; return { data: { path }, error: null };
    } }) } };
    const r = createBotMethodRepository(client);
    assert.deepEqual(await envelope(() => r.uploadInlineMedia({ botId: bot, tokenId: token, chatId: chat,
      ...identity, leaseId: commit.leaseId, objectPath: `${chat}/bots/${bot}/${"a".repeat(64)}.png`,
      mimeType: "image/png", bytes: Buffer.from("fictional") })), { status: 500, body: failure("internal_error") });
    assert.equal(uploads, at === "bot_media_upload_begin_internal" ? 0 : 1);
    assert.equal(calls.length, at === "bot_media_upload_begin_internal" ? 1 : 2);
  });

for (const bad of [
  { idempotencyKey: undefined }, { idempotencyKey: "" }, { idempotencyKey: "short" },
  { idempotencyKey: "x".repeat(129) }, { idempotencyKey: "bad key-0001" },
  { requestFingerprint: undefined }, { requestFingerprint: "" }, { requestFingerprint: "A".repeat(64) },
]) test(`55P03 without real replay identity stays 500: ${Object.entries(bad).map(([key, value]) => key + "=" + String(value)).join()}`, async () => {
  for (const invoke of [
    (r) => r.executeMessageCommand({ ...command("text"), ...bad }),
    (r) => r.preflightMediaCommand({ ...preflight("image"), ...bad }),
    (r) => r.commitInlineMedia({ ...commit, ...bad }),
    (r) => r.replaceCommands({ botId: bot, commands: [], ...identity, ...bad }),
  ]) {
    const f = fixture(() => ({ data: null, error: busy }));
    assert.deepEqual(await envelope(() => invoke(f.repository)), { status: 500, body: failure("internal_error") });
    assert.equal(f.calls.length, 1);
  }
});

for (const error of [{ code: "0A000" }, { code: "40P01" }, { code: "XX000", status: 500 },
  { status: 500 }, { code: "55p03" }, { code: "55P03 " }])
  test(`nonexact/nonbusy error ${error.code ?? "generic 500"} never becomes retryable`, async () => {
    const f = fixture(() => ({ data: null, error }));
    assert.deepEqual(await f.route("sendMessage", { chat_id: chat, text: "Fictional", idempotency_key: "fictional-route-0004" }),
      { status: 500, headers: {}, body: failure("internal_error") });
    assert.equal(f.calls.length, 1);
  });

test("thrown transport error carrying 55P03 is still an unknown-outcome 500", async () => {
  const f = fixture(() => { throw busy; });
  assert.deepEqual(await envelope(() => f.repository.executeMessageCommand(command("text"))),
    { status: 500, body: failure("internal_error") });
  assert.equal(f.calls.length, 1);
});

for (const [error, retry] of [
  [{ code: "55000", message: "bot_media_ingest_busy", details: "7" }, 7],
  [{ code: "55000", message: "bot_media_ingest_lease_expired" }, 1],
]) test(`existing ingest 55000 ${error.message} remains rate_limited`, async () => {
  const f = fixture(() => ({ data: null, error }));
  assert.deepEqual(await envelope(() => f.repository.commitInlineMedia(commit)), { status: 429, body: {
    ok: false, error: { code: "rate_limited", message: "Too many requests", request_id: "fictional-busy-request", retry_after: retry },
  } });
  assert.equal(f.calls.length, 1);
});

test("service unavailable retry field remains bounded and request id/details sanitized", () => {
  assert.deepEqual(toBotApiErrorResponse(new BotApiError("service_unavailable", 2), "bad\r\nid"), {
    status: 503, body: { ok: false, error: { code: "service_unavailable", message: "Service unavailable",
      request_id: "unknown", retry_after: 2 } },
  });
  for (const value of [0, -1, 1.5, NaN, 86_401, "2"])
    assert.equal(toBotApiErrorResponse(new BotApiError("service_unavailable", value), "safe").body.error.retry_after, undefined);
  assert.equal(toBotApiErrorResponse(new BotApiError("internal_error", 2), "safe").body.error.retry_after, undefined);
});

test("existing ingest rate_limited router contract stays 429 without widening its header policy", async () => {
  const f = fixture(() => ({ data: null,
    error: { code: "55000", message: "bot_media_ingest_busy", details: "7" } }));
  assert.deepEqual(await f.route("sendPhoto", { chat_id: chat, idempotency_key: "fictional-inline-rate",
    photo: { mime_type: "image/png", bytes_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l7sAAAAASUVORK5CYII=" } }),
    { status: 429, headers: {}, body: { ok: false, error: { code: "rate_limited", message: "Too many requests",
      request_id: "fictional-busy-request", retry_after: 7 } } });
  assert.deepEqual(f.calls.map((call) => call.name), ["bot_media_ingest_reserve_internal"]);
});
