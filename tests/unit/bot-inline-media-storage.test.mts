import assert from "node:assert/strict";
import test from "node:test";
import { createBotMethodRepository, type BotServiceClient } from "../../artifacts/api-server/src/bot/repository.ts";
import { toBotApiErrorResponse } from "../../artifacts/api-server/src/bot/errors.ts";

const botId = "33333333-3333-4333-8333-333333333333", chatId = "11111111-1111-4111-8111-111111111111";
const input = { botId, chatId, objectPath: `${chatId}/bots/${botId}/${"a".repeat(64)}.pdf`,
  mimeType: "application/pdf" as const, bytes: Buffer.from("synthetic equal bytes") };

for (const mode of ["equal", "changed", "short", "oversize", "broken"] as const) {
  test(`Storage 409 streams and verifies bytes (${mode}), without deletion`, async () => {
    let reads = 0, cancelled = false, downloadSignal: AbortSignal | undefined;
    const expected = input.bytes;
    const body = mode === "changed" ? Buffer.from("synthetic other bytes") : mode === "short" ? expected.subarray(0, -1) : mode === "oversize" ? Buffer.alloc(expected.length + 1) : expected;
    const repository = createBotMethodRepository({ storage: { from(bucket: string) {
      assert.equal(bucket, "chat-media");
      return {
        async upload(path: string, bytes: Buffer, options: unknown) {
          assert.equal(path, input.objectPath); assert.deepEqual(bytes, expected);
          assert.deepEqual(options, { contentType: "application/pdf", upsert: false });
          return { data: null, error: { status: 409, statusCode: "ResourceAlreadyExists" } };
        },
        download(path: string, _options: unknown, options: { signal: AbortSignal; cache: string }) {
          assert.equal(path, input.objectPath); assert.equal(options.cache, "no-store");
          downloadSignal = options.signal;
          return { asStream: async () => ({ error: null, data: new ReadableStream({
            pull(controller) {
              reads++;
              if (mode === "broken") controller.error(new Error("private transport failure"));
              else if (reads === 1) controller.enqueue(body);
              else controller.close();
            }, cancel() { cancelled = true; },
          }, { highWaterMark: 0 }) }) };
        },
        remove() { throw new Error("ambiguous commits must never eagerly delete"); },
      };
    } } } as unknown as BotServiceClient);
    if (mode === "equal") await repository.uploadInlineMedia(input);
    else await assert.rejects(() => repository.uploadInlineMedia(input), mode === "broken" ? /internal_error/ : /conflict/);
    assert.equal(downloadSignal?.aborted, true);
    if (mode === "oversize") { assert.equal(reads, 1); assert.equal(cancelled, true); }
  });
}

test("non-duplicate storage errors never download and never expose provider detail", async () => {
  const repository = createBotMethodRepository({ storage: { from() { return {
    upload: async () => ({ data: null, error: { status: 403, message: "private provider detail" } }),
    download() { throw new Error("not a duplicate"); },
  }; } } } as unknown as BotServiceClient);
  await assert.rejects(() => repository.uploadInlineMedia(input), error => {
    const failure = toBotApiErrorResponse(error, "qa");
    assert.equal(failure.status, 500);
    assert.equal(JSON.stringify(failure).includes("private provider"), false);
    return true;
  });
});

test("ingest-specific RPC failures preserve retry semantics and redact diagnostics", async () => {
  const values = [
    [{ code: "55000", message: "bot_media_ingest_busy", details: "17" }, 429, "rate_limited", 17],
    [{ code: "55000", message: "bot_media_ingest_busy", details: "private" }, 429, "rate_limited", 120],
    [{ code: "55000", message: "bot_media_ingest_lease_expired" }, 429, "rate_limited", 1],
    [{ code: "54000", message: "bot_media_ingest_quota_exceeded" }, 429, "quota_exceeded", undefined],
    [{ code: "42501", message: "bot_media_ingest_token_revoked" }, 401, "unauthorized", undefined],
    [{ code: "42501", message: "bot_ingest_lease_invalid" }, 403, "forbidden", undefined],
    [{ code: "23505", message: "private database detail" }, 409, "conflict", undefined],
  ] as const;
  for (const [rpcError, status, code, retry] of values) {
    const repository = createBotMethodRepository({ rpc: async () => ({ data: null, error: rpcError }) } as unknown as BotServiceClient);
    await assert.rejects(() => repository.reserveInlineMedia({ ...input, tokenId: "44444444-4444-4444-8444-444444444444",
      kind: "file", idempotencyKey: "qa-inline-1", requestFingerprint: "a".repeat(64), sizeBytes: 20,
      contentSha256: "b".repeat(64), leaseId: "55555555-5555-4555-8555-555555555555" }), error => {
      const failure = toBotApiErrorResponse(error, "qa");
      assert.equal(failure.status, status); assert.equal(failure.body.error.code, code);
      assert.equal(failure.body.error.retry_after, retry);
      assert.equal(JSON.stringify(failure).includes("private"), false);
      return true;
    });
  }
});
