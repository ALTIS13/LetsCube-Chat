import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";

import { LetscubeTransport, LETSCUBE_GAPS } from "../../artifacts/pocketflow/src/transport/letscube.ts";
import { TransportError, type SendBytesOptions } from "../../artifacts/pocketflow/src/transport/types.ts";

const CHAT = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "22222222-2222-4222-8222-222222222222";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1cAAAAASUVORK5CYII=", "base64");

type Request = { path: string; body: Record<string, unknown> };

function receipt(response: ServerResponse) {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ ok: true, result: {
    message_id: MESSAGE, chat_id: CHAT, kind: "image", duplicate: false,
    created_at: "2026-10-02T12:00:00.000Z",
  } }));
}

async function loopback(
  run: (input: { bot: LetscubeTransport; requests: Request[]; sleeps: number[] }) => Promise<void>,
  respond: (request: Request, response: ServerResponse, raw: IncomingMessage, index: number) => void = (_request, response) => receipt(response),
  beforeSleep?: () => void,
) {
  const requests: Request[] = [];
  const sleeps: number[] = [];
  const server = createServer(async (raw, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of raw) chunks.push(Buffer.from(chunk));
    const request = { path: raw.url ?? "", body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    requests.push(request);
    respond(request, response, raw, requests.length);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const bot = new LetscubeTransport({
    baseUrl: `http://127.0.0.1:${address.port}`,
    token: "synthetic-test-token",
    maxAttempts: 3,
    sleep: async (ms) => { sleeps.push(ms); beforeSleep?.(); },
  });
  try {
    await run({ bot, requests, sleeps });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function sender(bot: LetscubeTransport) {
  assert.equal(typeof bot.sendBytes, "function", "PocketFlow has no new-byte sender");
  return bot.sendBytes.bind(bot);
}

const TYPES = [
  { kind: "photo", mimeType: "image/jpeg", method: "sendPhoto" },
  { kind: "photo", mimeType: "image/png", method: "sendPhoto" },
  { kind: "photo", mimeType: "image/webp", method: "sendPhoto" },
  { kind: "photo", mimeType: "image/gif", method: "sendPhoto" },
  { kind: "document", mimeType: "application/pdf", method: "sendDocument" },
  { kind: "video", mimeType: "video/mp4", method: "sendVideo" },
  { kind: "video", mimeType: "video/webm", method: "sendVideo" },
  { kind: "voice", mimeType: "audio/webm", method: "sendVoice" },
  { kind: "voice", mimeType: "audio/ogg", method: "sendVoice" },
  { kind: "voice", mimeType: "audio/mpeg", method: "sendVoice" },
] as const;

for (const entry of TYPES) {
  test(`sendBytes serializes ${entry.kind} ${entry.mimeType} to its one typed source`, async () => {
    await loopback(async ({ bot, requests }) => {
      const sent = await sender(bot)({ chatId: CHAT, kind: entry.kind, mimeType: entry.mimeType, bytes: new Uint8Array([1, 2, 3, 255]),
        caption: "Synthetic fixture", idempotencyKey: "fixture-media-01" } as SendBytesOptions);
      assert.equal(sent.id, MESSAGE);
      assert.equal(sent.chatId, CHAT);
      assert.equal(sent.date?.toISOString(), "2026-10-02T12:00:00.000Z");
      assert.equal(requests.length, 1);
      assert.equal(requests[0].path, `/bot/v1/${entry.method}`);
      assert.deepEqual(requests[0].body, {
        chat_id: CHAT, [entry.kind]: { mime_type: entry.mimeType, bytes_base64: "AQID/w==" },
        caption: "Synthetic fixture", idempotency_key: "fixture-media-01",
      });
    });
  });
}

test("document bytes preserve a safe display filename without accepting caller-derived duration", async () => {
  await loopback(async ({ bot, requests }) => {
    await sender(bot)({ chatId: CHAT, kind: "document", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.7\n%%EOF\n"), fileName: "  report.pdf  " });
    assert.deepEqual(requests[0].body.document, {
      mime_type: "application/pdf", bytes_base64: "JVBERi0xLjcKJSVFT0YK", file_name: "report.pdf",
    });
  });
});

test("a 500 retry snapshots bytes and keeps the same explicit key", async () => {
  const bytes = Buffer.from(PNG);
  await loopback(async ({ bot, requests, sleeps }) => {
    await sender(bot)({ chatId: CHAT, kind: "photo", mimeType: "image/png", bytes, idempotencyKey: "durable-send-01" });
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].body, requests[1].body);
    assert.equal(requests[1].body.idempotency_key, "durable-send-01");
    assert.deepEqual(requests[1].body.photo, {
      mime_type: "image/png", bytes_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1cAAAAASUVORK5CYII=",
    });
    assert.deepEqual(sleeps, [500]);
  }, (_request, response, _raw, index) => {
    if (index === 1) { response.statusCode = 500; response.end('{"ok":false,"error":{"code":"internal_error"}}'); }
    else receipt(response);
  }, () => bytes.fill(0));
});

test("a lost response retries with the same generated key; a separate send gets a new key", async () => {
  await loopback(async ({ bot, requests }) => {
    const send = sender(bot);
    await send({ chatId: CHAT, kind: "photo", mimeType: "image/png", bytes: PNG });
    await send({ chatId: CHAT, kind: "photo", mimeType: "image/png", bytes: PNG });
    assert.equal(requests.length, 3);
    assert.deepEqual(requests[0].body, requests[1].body);
    assert.match(String(requests[0].body.idempotency_key), /^pf-[0-9a-f-]{36}$/);
    assert.notEqual(requests[1].body.idempotency_key, requests[2].body.idempotency_key);
  }, (_request, response, _raw, index) => {
    if (index === 1) response.destroy();
    else receipt(response);
  });
});

test("an active equivalent lease waits 120 seconds without replacing its payload or key", async () => {
  await loopback(async ({ bot, requests, sleeps }) => {
    await sender(bot)({ chatId: CHAT, kind: "photo", mimeType: "image/png", bytes: PNG });
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].body, requests[1].body);
    assert.deepEqual(sleeps, [120_000]);
  }, (_request, response, _raw, index) => {
    if (index === 1) { response.statusCode = 429; response.end('{"ok":false,"error":{"code":"rate_limited","retry_after":120}}'); }
    else receipt(response);
  });
});

for (const status of [429, 500]) {
  test(`quota_exceeded ${status} is not retried automatically`, async () => {
    await loopback(async ({ bot, requests, sleeps }) => {
      await assert.rejects(() => sender(bot)({ chatId: CHAT, kind: "photo", mimeType: "image/png", bytes: PNG }),
        (error) => error instanceof TransportError && error.code === "quota_exceeded" && !error.retryable);
      assert.equal(requests.length, 1);
      assert.deepEqual(sleeps, []);
    }, (_request, response) => { response.statusCode = status; response.end('{"ok":false,"error":{"code":"quota_exceeded"}}'); });
  });
}

test("idempotency conflict is surfaced without trying a new key", async () => {
  await loopback(async ({ bot, requests }) => {
    await assert.rejects(() => sender(bot)({ chatId: CHAT, kind: "photo", mimeType: "image/png", bytes: PNG, idempotencyKey: "durable-send-01" }),
      (error) => error instanceof TransportError && error.status === 409);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.idempotency_key, "durable-send-01");
  }, (_request, response) => { response.statusCode = 409; response.end('{"ok":false,"error":{"code":"conflict"}}'); });
});

test("every type accepts exactly 6291456 bytes and rejects 6291457 before HTTP", async () => {
  await loopback(async ({ bot, requests }) => {
    const send = sender(bot);
    for (const entry of TYPES.filter((entry) => ["image/png", "application/pdf", "video/mp4", "audio/ogg"].includes(entry.mimeType))) {
      await send({ chatId: CHAT, kind: entry.kind, mimeType: entry.mimeType, bytes: Buffer.alloc(6_291_456, 1) } as SendBytesOptions);
      const body = requests.at(-1)!.body[entry.kind] as { bytes_base64: string };
      assert.equal(body.bytes_base64.length, 8_388_608);
      await assert.rejects(() => send({ chatId: CHAT, kind: entry.kind, mimeType: entry.mimeType, bytes: Buffer.alloc(6_291_457, 1) } as SendBytesOptions),
        (error) => error instanceof TransportError && error.code === "validation_failed");
    }
    assert.equal(requests.length, 4);
  });
});

const INVALID = [
  { bytes: new Uint8Array() },
  { bytes: "https://example.invalid/file.png" },
  { kind: "video", mimeType: "image/png" },
  { kind: "document", mimeType: "application/zip" },
  { kind: "voice", mimeType: "audio/mp4" },
  { fileName: "photo.png" },
  { fileId: MESSAGE },
  { media: { object_path: "someone-elses-object" } },
  { url: "https://example.invalid/file.png" },
  { topicId: MESSAGE },
  { replyToMessageId: MESSAGE },
  { keyboard: { rows: [] } },
  { durationSeconds: 1 },
  { caption: "" },
  { caption: "x".repeat(4097) },
  { idempotencyKey: "short" },
  { idempotencyKey: "x".repeat(129) },
  { idempotencyKey: "invalid key" },
  { kind: "document", mimeType: "application/pdf", fileName: "../report.pdf" },
  { kind: "document", mimeType: "application/pdf", fileName: "C:\\report.pdf" },
  { kind: "document", mimeType: "application/pdf", fileName: "report\n.pdf" },
  { kind: "document", mimeType: "application/pdf", fileName: ".." },
  { kind: "document", mimeType: "application/pdf", fileName: " " },
  { kind: "document", mimeType: "application/pdf", fileName: "x".repeat(129) },
];

test("invalid type, URL, alternate source, unsupported fields and filenames fail before HTTP", async () => {
  await loopback(async ({ bot, requests }) => {
    const send = sender(bot);
    for (const invalid of INVALID) {
      await assert.rejects(() => send({ chatId: CHAT, kind: "photo", mimeType: "image/png", bytes: PNG, ...invalid } as SendBytesOptions),
        (error) => error instanceof TransportError && error.code === "validation_failed" && !error.retryable);
    }
    assert.equal(requests.length, 0);
  });
});

test("sendBytes capability does not claim a standalone upload endpoint or change file_id resends", async () => {
  await loopback(async ({ bot, requests }) => {
    assert.equal(bot.supports("sendBytes"), true);
    assert.equal(bot.supports("uploadFile"), false);
    assert.match(LETSCUBE_GAPS.get("uploadFile") ?? "", /standalone|larger/i);
    await bot.sendFileById({ chatId: CHAT, kind: "document", fileId: MESSAGE, topicId: MESSAGE });
    assert.deepEqual(Object.keys(requests[0].body).sort(), ["chat_id", "file_id", "idempotency_key", "topic_id"]);
    assert.equal(requests[0].body.file_id, MESSAGE);
  });
});
