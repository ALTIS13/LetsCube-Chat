import assert from "node:assert/strict";
import test from "node:test";
import { createMessageHandlers } from "../../artifacts/api-server/src/bot/methods/messages.ts";
import type { BotMethodRepository } from "../../artifacts/api-server/src/bot/repository.ts";

const bot = { botId: "33333333-3333-4333-8333-333333333333", tokenId: "44444444-4444-4444-8444-444444444444" };
const chat = "11111111-1111-4111-8111-111111111111";
const fingerprint = "a".repeat(64);
const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");

test("new PDF bytes reserve before storage and commit one receipt atomically", async () => {
  const calls: string[] = [];
  const repository = {
    reserveInlineMedia: async (input: Record<string, unknown>) => {
      calls.push("reserve");
      assert.equal(input.tokenId, bot.tokenId);
      assert.equal(input.sizeBytes, pdf.length);
      assert.equal(input.mimeType, "application/pdf");
      return { duplicate: false, result: null, leaseId: input.leaseId };
    },
    uploadInlineMedia: async (input: Record<string, unknown>) => {
      calls.push("upload");
      assert.equal(input.objectPath, `${chat}/bots/${bot.botId}/${fingerprint}.pdf`);
    },
    commitInlineMedia: async (input: { payload: Record<string, any> }) => {
      calls.push("commit");
      assert.equal(input.payload.media_metadata.file_name, "report.pdf");
      assert.equal(input.payload.media_metadata.size_bytes, pdf.length);
      return { duplicate: false, result: { message_id: "qa-message" } };
    },
    preflightMediaCommand: async () => { throw new Error("inline must use durable reservation"); },
    authorizeMedia: async () => { throw new Error("inline grant must be atomic with message"); },
    executeMessageCommand: async () => { throw new Error("inline must use atomic commit"); },
  } as unknown as BotMethodRepository;
  const handlers = createMessageHandlers(repository, () => fingerprint, async () => {}, async () => "Pages: 1\nEncrypted: no\n");
  const result = await handlers.sendDocument({ bot, requestId: "qa" }, {
    chat_id: chat, idempotency_key: "inline-document-1",
    document: { mime_type: "application/pdf", bytes_base64: pdf.toString("base64"), file_name: "report.pdf" },
  });
  assert.deepEqual(result, { message_id: "qa-message" });
  assert.deepEqual(calls, ["reserve", "upload", "commit"]);
});

test("completed equivalent retry returns original receipt without probe or upload", async () => {
  let probes = 0;
  const repository = {
    reserveInlineMedia: async () => ({ duplicate: true, result: { message_id: "original" }, leaseId: null }),
    uploadInlineMedia: async () => { throw new Error("duplicate upload"); },
    commitInlineMedia: async () => { throw new Error("duplicate commit"); },
  } as unknown as BotMethodRepository;
  const handlers = createMessageHandlers(repository, () => fingerprint, async () => {}, async () => { probes++; return "Pages: 1\n"; });
  const result = await handlers.sendDocument({ bot, requestId: "qa" }, {
    chat_id: chat, idempotency_key: "inline-document-1",
    document: { mime_type: "application/pdf", bytes_base64: pdf.toString("base64") },
  });
  assert.deepEqual(result, { message_id: "original" });
  assert.equal(probes, 0);
});

test("direct handlers reject mismatched or multiple inline fields before reservation", async () => {
  let reservations = 0;
  const handlers = createMessageHandlers({
    reserveInlineMedia: async () => { reservations++; throw new Error("must not reserve"); },
  } as unknown as BotMethodRepository, () => fingerprint, async () => {});
  const body = { chat_id: chat, idempotency_key: "inline-wrong-field-1" };
  const source = { mime_type: "audio/webm", bytes_base64: "YQ==" };
  for (const input of [{ ...body, video: source }, { ...body, voice: source, document: source }]) {
    await assert.rejects(() => handlers.sendVoice({ bot, requestId: "qa" }, input as any), /validation_failed/);
  }
  assert.equal(reservations, 0);
});
