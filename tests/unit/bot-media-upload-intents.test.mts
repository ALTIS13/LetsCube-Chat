import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";
import type { BotServiceClient } from "../../artifacts/api-server/src/bot/repository.ts";
import { toBotApiErrorResponse } from "../../artifacts/api-server/src/bot/errors.ts";

// Execute omission mutants in memory without changing the shared checkout.
const mutant = process.env.BOT_UPLOAD_INTENT_MUTANT;
let mutations = 0;
if (mutant) {
  const changes: Record<string, [string, string]> = {
    "skip-begin": ['await beginUploadAttempt(input);', '/* omitted admission */'],
    "acknowledge-error": ['await finishUploadAttempt(input, "unknown").catch(() => {});', 'await finishUploadAttempt(input, "acknowledged").catch(() => {});'],
    "skip-finish": ['await finishUploadAttempt(input, "acknowledged");', '/* omitted outcome persistence */'],
    "wrong-lease": ['p_lease_id: input.leaseId, p_object_path: input.objectPath,', 'p_lease_id: input.tokenId, p_object_path: input.objectPath,'],
    "wrong-digest": ['p_content_sha256: createHash("sha256").update(input.bytes).digest("hex"),', 'p_content_sha256: "0".repeat(64),'],
  };
  const change = changes[mutant];
  assert.ok(change);
  registerHooks({ load(url, context, nextLoad) {
    if (!url.endsWith("/bot/repository.ts")) return nextLoad(url, context);
    const source = readFileSync(new URL(url), "utf8").replaceAll("\r\n", "\n");
    assert.equal(source.split(change[0]).length - 1, 1, "one mutation anchor");
    mutations++;
    return { format: "module", source: stripTypeScriptTypes(source.replace(change[0], change[1])), shortCircuit: true };
  } });
}
const { createBotMethodRepository } = await import("../../artifacts/api-server/src/bot/repository.ts");
test.after(() => { if (mutant) assert.equal(mutations, 1); });

const botId = "33333333-3333-4333-8333-333333333333";
const chatId = "11111111-1111-4111-8111-111111111111";
const tokenId = "44444444-4444-4444-8444-444444444444";
const leaseId = "55555555-5555-4555-8555-555555555555";
const input = { botId, chatId, tokenId, leaseId, idempotencyKey: "intent-runtime-0001",
  requestFingerprint: "a".repeat(64), objectPath: `${chatId}/bots/${botId}/${"a".repeat(64)}.pdf`,
  mimeType: "application/pdf" as const, bytes: Buffer.from("abc") };

function fixture(options: { begin?: unknown; beginError?: unknown; beginThrow?: boolean; afterBegin?: () => void;
  upload?: "throw" | "refused" | "malformed" | "duplicate"; downloaded?: string;
  finish?: unknown; finishThrow?: boolean; finishError?: unknown } = {}) {
  const events: string[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const repository = createBotMethodRepository({
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "bot_media_upload_begin_internal") {
        events.push("begin");
        if (options.beginThrow) throw new Error("private begin transport");
        options.afterBegin?.();
        return { data: Object.hasOwn(options, "begin") ? options.begin : { attempt_id: leaseId, state: "pending" }, error: options.beginError ?? null };
      }
      assert.equal(name, "bot_media_upload_finish_internal");
      events.push(`finish:${args.p_outcome}`);
      if (options.finishThrow) throw new Error("private finish transport");
      return { data: Object.hasOwn(options, "finish") ? options.finish : { attempt_id: leaseId, state: args.p_outcome }, error: options.finishError ?? null };
    },
    storage: { from(bucket: string) {
      assert.equal(bucket, "chat-media");
      return {
        async upload(path: string, bytes: Buffer, config: unknown) {
          events.push("upload");
          assert.equal(path, input.objectPath); assert.deepEqual(bytes, Buffer.from("abc"));
          assert.deepEqual(config, { contentType: "application/pdf", upsert: false });
          if (options.upload === "throw") throw new Error("private PUT transport");
          if (options.upload === "refused") return { data: null, error: { status: 403, message: "private provider reason" } };
          if (options.upload === "duplicate") return { data: null, error: { status: 409, statusCode: "ResourceAlreadyExists" } };
          return { data: { path: options.upload === "malformed" ? "wrong" : path }, error: null };
        },
        download(_path: string, _config: unknown, config: { cache: string }) {
          events.push("download"); assert.equal(config.cache, "no-store");
          return { asStream: async () => ({ data: new ReadableStream({ start(controller) {
            controller.enqueue(Buffer.from(options.downloaded ?? "abc")); controller.close();
          } }), error: null }) };
        },
        remove() { assert.fail("no deletion is authorised"); },
      };
    } },
  } as unknown as BotServiceClient);
  return { repository, events, rpcCalls };
}

test("durable intent precedes PUT and acknowledgement persists before success", async () => {
  const { repository, events, rpcCalls } = fixture();
  await repository.uploadInlineMedia(input);
  assert.deepEqual(events, ["begin", "upload", "finish:acknowledged"]);
  assert.deepEqual(rpcCalls, [
    { name: "bot_media_upload_begin_internal", args: {
      p_bot_id: botId, p_token_id: tokenId, p_chat_id: chatId, p_idempotency_key: "intent-runtime-0001",
      p_request_fingerprint: "a".repeat(64), p_lease_id: leaseId, p_object_path: input.objectPath,
      p_content_type: "application/pdf", p_byte_size: 3,
      p_content_sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    } },
    { name: "bot_media_upload_finish_internal", args: {
      p_bot_id: botId, p_idempotency_key: "intent-runtime-0001", p_attempt_id: leaseId, p_outcome: "acknowledged",
    } },
  ]);
});

test("the admitted Buffer is immutable across the external admission wait", async () => {
  const mutable = { ...input, bytes: Buffer.from("abc") };
  const { repository, events } = fixture({ afterBegin: () => { mutable.bytes[0] = 0; } });
  await repository.uploadInlineMedia(mutable);
  assert.deepEqual(events, ["begin", "upload", "finish:acknowledged"]);
});

test("failed or uncertain admission never starts external I/O", async () => {
  for (const options of [
    { begin: null }, { begin: [] }, { begin: { attempt_id: leaseId, state: "acknowledged" } },
    { begin: { attempt_id: tokenId, state: "pending" } }, { beginThrow: true },
    { beginError: { code: "42501", message: "private SQL reason" } },
  ]) {
    const { repository, events } = fixture(options);
    await assert.rejects(() => repository.uploadInlineMedia(input));
    assert.deepEqual(events, ["begin"]);
  }
});

test("missing or mismatched reservation identity fails before RPC and PUT", async () => {
  for (const values of [ { tokenId: undefined }, { leaseId: "invalid" }, { idempotencyKey: "tiny" },
    { idempotencyKey: undefined }, { idempotencyKey: 123456789 },
    { requestFingerprint: "b".repeat(64) }, { bytes: Buffer.alloc(0) }, { chatId: botId } ]) {
    const { repository, events } = fixture();
    await assert.rejects(() => repository.uploadInlineMedia({ ...input, ...values } as never));
    assert.deepEqual(events, []);
  }
});

test("PUT failure or malformed reply remains unknown and redacts all provider diagnostics", async () => {
  for (const upload of ["throw", "refused", "malformed"] as const) {
    const { repository, events } = fixture({ upload });
    await assert.rejects(() => repository.uploadInlineMedia(input), error => {
      const result = toBotApiErrorResponse(error, "qa");
      assert.equal(result.status, 500); assert.equal(JSON.stringify(result).includes("private"), false);
      return true;
    });
    assert.deepEqual(events, ["begin", "upload", "finish:unknown"]);
  }
});

test("duplicate bytes must match before this attempt is acknowledged", async () => {
  const ok = fixture({ upload: "duplicate" });
  await ok.repository.uploadInlineMedia(input);
  assert.deepEqual(ok.events, ["begin", "upload", "download", "finish:acknowledged"]);
  for (const downloaded of ["abd", "ab", "abcd"]) {
    const bad = fixture({ upload: "duplicate", downloaded });
    await assert.rejects(() => bad.repository.uploadInlineMedia(input), /conflict/);
    assert.deepEqual(bad.events, ["begin", "upload", "download", "finish:unknown"]);
  }
});

test("lost, refused or malformed acknowledgement does not return upload success", async () => {
  for (const options of [ { finishThrow: true }, { finishError: { code: "XX000", message: "private SQL reason" } },
    { finish: null }, { finish: { attempt_id: tokenId, state: "acknowledged" } },
    { finish: { attempt_id: leaseId, state: "unknown" } } ]) {
    const { repository, events } = fixture(options);
    await assert.rejects(() => repository.uploadInlineMedia(input), /internal_error/);
    assert.deepEqual(events, ["begin", "upload", "finish:acknowledged"]);
  }
});

test("an unknown-outcome write failure never masks the original duplicate conflict", async () => {
  const { repository, events } = fixture({ upload: "duplicate", downloaded: "abd", finishThrow: true });
  await assert.rejects(() => repository.uploadInlineMedia(input), /conflict/);
  assert.deepEqual(events, ["begin", "upload", "download", "finish:unknown"]);
});

test("attempt admission failures preserve public auth, retry and bounded-budget semantics", async () => {
  for (const [beginError, status, code, retry] of [
    [{ code: "42501", message: "bot_media_ingest_token_revoked" }, 401, "unauthorized", undefined],
    [{ code: "55000", message: "bot_media_ingest_lease_expired" }, 429, "rate_limited", 1],
    [{ code: "54000", message: "bot_media_upload_attempts_exceeded" }, 429, "quota_exceeded", undefined],
  ] as const) {
    const { repository, events } = fixture({ beginError });
    await assert.rejects(() => repository.uploadInlineMedia(input), error => {
      const result = toBotApiErrorResponse(error, "qa");
      assert.equal(result.status, status); assert.equal(result.body.error.code, code);
      assert.equal(result.body.error.retry_after, retry); return true;
    });
    assert.deepEqual(events, ["begin"]);
  }
});
