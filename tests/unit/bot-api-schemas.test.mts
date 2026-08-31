import assert from "node:assert/strict";
import test from "node:test";

import {
  botMethodNameSchema,
  botMethodSchemas,
  parseBotMethodInput,
} from "../../artifacts/api-server/src/bot/schemas.ts";
import {
  BotApiError,
  botFailure,
  botSuccess,
  toBotApiErrorResponse,
} from "../../artifacts/api-server/src/bot/errors.ts";

const CHAT_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";
const BOT_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "req_20260831_001";

const EXPECTED_METHODS = [
  "getMe",
  "getWebhookInfo",
  "sendMessage",
  "sendPhoto",
  "sendVideo",
  "sendDocument",
  "sendVoice",
  "sendChatAction",
  "editMessageText",
  "deleteMessage",
  "getFile",
  "setMyCommands",
  "getMyCommands",
  "answerCallbackQuery",
  "setWebhook",
  "deleteWebhook",
  "getUpdates",
] as const;

test("method registry is closed and every declared method has a strict schema", () => {
  assert.deepEqual(Object.keys(botMethodSchemas), [...EXPECTED_METHODS]);
  for (const method of EXPECTED_METHODS) {
    assert.equal(botMethodNameSchema.parse(method), method);
  }
  assert.equal(botMethodNameSchema.safeParse("forwardMessage").success, false);
  assert.equal(botMethodNameSchema.safeParse("constructor").success, false);
  assert.throws(
    () => parseBotMethodInput("unknown", {}),
    /bot_method_not_found/,
  );
  assert.throws(() => parseBotMethodInput("getMe", { extra: true }));
});

test("sendMessage accepts bounded text and keyboard callback data", () => {
  const parsed = parseBotMethodInput("sendMessage", {
    chat_id: CHAT_ID,
    text: "Hello",
    reply_to_message_id: MESSAGE_ID,
    idempotency_key: "message:20260831:1",
    reply_markup: {
      inline_keyboard: [[{ text: "Open", callback_data: "open:1" }]],
    },
  });

  assert.equal(parsed.text, "Hello");
  assert.equal(
    parsed.reply_markup?.inline_keyboard[0]?.[0]?.callback_data,
    "open:1",
  );
});

test("sendMessage rejects oversized or unknown input before database access", () => {
  for (const input of [
    { chat_id: CHAT_ID, text: "", idempotency_key: "message:1" },
    { chat_id: CHAT_ID, text: "x".repeat(4097), idempotency_key: "message:1" },
    { chat_id: "not-a-uuid", text: "ok", idempotency_key: "message:1" },
    { chat_id: CHAT_ID, text: "ok", idempotency_key: "short" },
    { chat_id: CHAT_ID, text: "ok", idempotency_key: "has whitespace" },
    { chat_id: CHAT_ID, text: "ok", idempotency_key: "message:1", admin: true },
    {
      chat_id: CHAT_ID,
      text: "ok",
      idempotency_key: "message:1",
      reply_markup: {
        inline_keyboard: Array.from({ length: 9 }, () => [
          { text: "x", callback_data: "x" },
        ]),
      },
    },
    {
      chat_id: CHAT_ID,
      text: "ok",
      idempotency_key: "message:1",
      reply_markup: {
        inline_keyboard: [[{ text: "x", callback_data: "x".repeat(129) }]],
      },
    },
  ]) {
    assert.throws(() => parseBotMethodInput("sendMessage", input));
  }
});

test("inline keyboards reject serialized payloads over 16 KiB", () => {
  const oversizedMarkup = {
    inline_keyboard: Array.from({ length: 8 }, () =>
      Array.from({ length: 8 }, () => ({
        text: "я".repeat(64),
        callback_data: "я".repeat(128),
      })),
    ),
  };
  assert.ok(Buffer.byteLength(JSON.stringify(oversizedMarkup), "utf8") > 16_384);
  assert.throws(() =>
    parseBotMethodInput("sendMessage", {
      chat_id: CHAT_ID,
      text: "ok",
      idempotency_key: "message:markup:1",
      reply_markup: oversizedMarkup,
    }),
  );
});

test("media methods accept only approved Storage object references and never URLs", () => {
  const storage = {
    bucket: "chat-media",
    object_path: `${CHAT_ID}/bots/${BOT_ID}/video.mp4`,
    mime_type: "video/mp4",
    size_bytes: 10_000_000,
  };
  const parsed = parseBotMethodInput("sendVideo", {
    chat_id: CHAT_ID,
    media: storage,
    caption: "Bounded caption",
    idempotency_key: "video:20260831:1",
  });

  assert.deepEqual(parsed.media, storage);
  for (const media of [
    "https://example.test/video.mp4",
    { url: "https://example.test/video.mp4" },
    {
      bucket: "chat-media",
      object_path: "../other-user/video.mp4",
      mime_type: "video/mp4",
      size_bytes: 1,
    },
    {
      bucket: "chat-media",
      object_path: "/absolute/video.mp4",
      mime_type: "video/mp4",
      size_bytes: 1,
    },
    {
      bucket: "chat-media",
      object_path: "https://example.test/video.mp4",
      mime_type: "video/mp4",
      size_bytes: 1,
    },
    {
      bucket: "avatars",
      object_path: `${CHAT_ID}/bots/${BOT_ID}/video.mp4`,
      mime_type: "video/mp4",
      size_bytes: 1,
    },
    {
      bucket: "chat-media",
      object_path: `${CHAT_ID}/bots/${BOT_ID}/archive.zip`,
      mime_type: "application/zip",
      size_bytes: 1,
    },
    {
      bucket: "chat-media",
      object_path: `${CHAT_ID}/bots/${BOT_ID}/video.mp4`,
      mime_type: "video/mp4",
      size_bytes: 104_857_601,
    },
  ]) {
    assert.throws(() =>
      parseBotMethodInput("sendVideo", {
        chat_id: CHAT_ID,
        media,
        idempotency_key: "video:20260831:1",
      }),
    );
  }
});

test("each media method accepts only its own MIME category", () => {
  const cases = [
    ["sendPhoto", "image/jpeg", "video/mp4"],
    ["sendVideo", "video/webm", "audio/ogg"],
    ["sendVoice", "audio/mpeg", "image/png"],
    ["sendDocument", "application/pdf", "video/webm"],
  ] as const;

  for (const [method, accepted, rejected] of cases) {
    const base = {
      chat_id: CHAT_ID,
      idempotency_key: `media:${method}:1`,
    };
    assert.doesNotThrow(() =>
      parseBotMethodInput(method, {
        ...base,
        media: {
          bucket: "chat-media",
          object_path: `${CHAT_ID}/bots/${BOT_ID}/object.bin`,
          mime_type: accepted,
          size_bytes: 1,
        },
      }),
    );
    assert.throws(() =>
      parseBotMethodInput(method, {
        ...base,
        media: {
          bucket: "chat-media",
          object_path: `${CHAT_ID}/bots/${BOT_ID}/object.bin`,
          mime_type: rejected,
          size_bytes: 1,
        },
      }),
    );
  }
});

test("commands, callbacks and updates enforce array and scalar bounds", () => {
  assert.equal(
    parseBotMethodInput("setMyCommands", {
      commands: [{ command: "hello_world", description: "Say hello" }],
      idempotency_key: "commands:20260831:1",
    }).commands.length,
    1,
  );
  assert.throws(() =>
    parseBotMethodInput("setMyCommands", {
      commands: Array.from({ length: 101 }, (_, index) => ({
        command: `c${index}`,
        description: "x",
      })),
      idempotency_key: "commands:20260831:1",
    }),
  );
  assert.throws(() =>
    parseBotMethodInput("setMyCommands", {
      commands: [{ command: "Uppercase", description: "x" }],
      idempotency_key: "commands:20260831:1",
    }),
  );
  assert.throws(() =>
    parseBotMethodInput("answerCallbackQuery", {
      callback_query_id: MESSAGE_ID,
      text: "x".repeat(201),
      idempotency_key: "callback:20260831:1",
    }),
  );
  assert.deepEqual(
    parseBotMethodInput("getUpdates", {
      offset: 42,
      limit: 100,
      timeout: 30,
      allowed_updates: [
        "message",
        "edited_message",
        "callback_query",
        "membership",
      ],
    }),
    {
      offset: 42,
      limit: 100,
      timeout: 30,
      allowed_updates: [
        "message",
        "edited_message",
        "callback_query",
        "membership",
      ],
    },
  );
  assert.throws(() => parseBotMethodInput("getUpdates", { limit: 101 }));
  assert.throws(() => parseBotMethodInput("getUpdates", { timeout: 31 }));
  assert.throws(() =>
    parseBotMethodInput("getUpdates", { allowed_updates: ["profile"] }),
  );
});

test("webhook input is bounded and HTTPS-only before SSRF validation", () => {
  assert.equal(
    parseBotMethodInput("setWebhook", {
      url: "https://bot.example.test/hook",
      drop_pending_updates: true,
      idempotency_key: "webhook:20260831:1",
    }).url,
    "https://bot.example.test/hook",
  );
  for (const url of [
    "http://bot.example.test/hook",
    "https://user:pass@bot.example.test/hook",
    "https://bot.example.test/" + "x".repeat(2048),
  ]) {
    assert.throws(() =>
      parseBotMethodInput("setWebhook", {
        url,
        idempotency_key: "webhook:20260831:1",
      }),
    );
  }
});

test("success and failure envelopes are stable and sanitized", () => {
  assert.deepEqual(botSuccess({ bot_id: "public" }), {
    ok: true,
    result: { bot_id: "public" },
  });
  assert.deepEqual(
    botFailure("rate_limited", "Too many requests", REQUEST_ID, 30),
    {
      ok: false,
      error: {
        code: "rate_limited",
        message: "Too many requests",
        request_id: REQUEST_ID,
        retry_after: 30,
      },
    },
  );

  const mappings = [
    ["validation_failed", 400],
    ["unauthorized", 401],
    ["forbidden", 403],
    ["not_found", 404],
    ["conflict", 409],
    ["rate_limited", 429],
    ["internal_error", 500],
  ] as const;
  for (const [code, status] of mappings) {
    const response = toBotApiErrorResponse(
      new BotApiError(code, code === "rate_limited" ? 12 : undefined),
      REQUEST_ID,
    );
    assert.equal(response.status, status);
    assert.equal(response.body.error.code, code);
    assert.equal(response.body.error.request_id, REQUEST_ID);
  }

  let validationError: unknown;
  try {
    parseBotMethodInput("sendMessage", {});
  } catch (error) {
    validationError = error;
  }
  assert.deepEqual(toBotApiErrorResponse(validationError, REQUEST_ID), {
    status: 400,
    body: {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Invalid request",
        request_id: REQUEST_ID,
      },
    },
  });

  const hidden = toBotApiErrorResponse(
    new Error("password, SQL and stack details"),
    "invalid request id with spaces",
  );
  assert.deepEqual(hidden, {
    status: 500,
    body: {
      ok: false,
      error: {
        code: "internal_error",
        message: "Internal server error",
        request_id: "unknown",
      },
    },
  });
});
