import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  createBotToken,
  extractBotTokenPrefix,
  hashBotToken,
  parseBotAuthorization,
  resolveBotAuthConfig,
  verifyBotTokenHash,
} from "../../artifacts/api-server/src/bot/tokenAuth.ts";
import {
  createBotTokenRepository,
  type BotRpcClient,
} from "../../artifacts/api-server/src/bot/repository.ts";
import { BotApiError } from "../../artifacts/api-server/src/bot/errors.ts";

const TEST_PEPPER = "test-only-pepper-with-at-least-32-bytes";
const BOT_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN_ID = "22222222-2222-4222-8222-222222222222";

function deterministicBytes(): Buffer {
  return Buffer.from(Array.from({ length: 32 }, (_, index) => index));
}

test("createBotToken derives prefix and secret from one 32-byte CSPRNG value", () => {
  let requestedBytes = 0;
  const source = (size: number) => {
    requestedBytes = size;
    return deterministicBytes();
  };

  const token = createBotToken(source);

  assert.equal(requestedBytes, 32);
  assert.equal(token.prefix, "lc_bot_0001020304");
  assert.equal(
    token.raw,
    `lc_bot_0001020304.${deterministicBytes().toString("base64url")}`,
  );
  assert.match(token.raw, /^lc_bot_[0-9a-f]{10}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(extractBotTokenPrefix(token.raw), token.prefix);
});

test("createBotToken rejects a malformed random source without exposing bytes", () => {
  assert.throws(
    () => createBotToken(() => Buffer.alloc(31, 7)),
    /bot_token_generation_failed/,
  );
});

test("hashBotToken is HMAC-SHA256 and verification is fail-closed", () => {
  const raw = createBotToken(() => Buffer.alloc(32, 7)).raw;
  const expected = createHmac("sha256", TEST_PEPPER)
    .update(raw, "utf8")
    .digest("hex");

  assert.equal(hashBotToken(raw, TEST_PEPPER), expected);
  assert.equal(verifyBotTokenHash(raw, TEST_PEPPER, expected), true);
  assert.equal(verifyBotTokenHash(`${raw}x`, TEST_PEPPER, expected), false);
  assert.equal(verifyBotTokenHash(raw, TEST_PEPPER, "not-a-hash"), false);
});

test("parseBotAuthorization accepts only one exact Bot credential", () => {
  const raw = createBotToken(() => Buffer.alloc(32, 9)).raw;

  assert.equal(parseBotAuthorization(`Bot ${raw}`), raw);
  for (const header of [
    undefined,
    "",
    `Bearer ${raw}`,
    `bot ${raw}`,
    `Bot  ${raw}`,
    `Bot\t${raw}`,
    ` Bot ${raw}`,
    `Bot ${raw} `,
    `Bot ${raw}, Bot ${raw}`,
    `Bot ${raw}\nignored`,
    `Bot ${"x".repeat(257)}`,
    ["Bot first", "Bot second"],
  ] as const) {
    assert.equal(parseBotAuthorization(header), null);
  }
});

test("extractBotTokenPrefix rejects non-canonical tokens", () => {
  assert.equal(extractBotTokenPrefix("lc_bot_ABCDEF1234.secret"), null);
  assert.equal(extractBotTokenPrefix("lc_bot_0001020304.short"), null);
  assert.equal(extractBotTokenPrefix("https://example.test/token"), null);
});

test("resolveBotAuthConfig uses trusted aliases and requires a strong private pepper", () => {
  assert.deepEqual(
    resolveBotAuthConfig({
      SUPABASE_URL: "https://primary.example.test",
      VITE_SUPABASE_URL: "https://fallback.example.test",
      SUPABASE_SERVICE_ROLE_KEY: "primary-service-key",
      SELFHOST_SERVICE_ROLE_KEY: "fallback-service-key",
      BOT_TOKEN_PEPPER: TEST_PEPPER,
    }),
    {
      url: "https://primary.example.test",
      serviceRoleKey: "primary-service-key",
      pepper: TEST_PEPPER,
    },
  );

  assert.deepEqual(
    resolveBotAuthConfig({
      VITE_SUPABASE_URL: "https://fallback.example.test",
      SELFHOST_SERVICE_ROLE_KEY: "fallback-service-key",
      BOT_TOKEN_PEPPER: TEST_PEPPER,
    }),
    {
      url: "https://fallback.example.test",
      serviceRoleKey: "fallback-service-key",
      pepper: TEST_PEPPER,
    },
  );

  for (const environment of [
    {},
    {
      SUPABASE_URL: "https://example.test",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      VITE_BOT_TOKEN_PEPPER: TEST_PEPPER,
    },
    {
      SUPABASE_URL: "https://example.test",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      BOT_TOKEN_PEPPER: "too-short",
    },
  ]) {
    assert.throws(
      () => resolveBotAuthConfig(environment),
      /bot_auth_config_invalid/,
    );
  }
});

function createRpcClient(handler: BotRpcClient["rpc"]): BotRpcClient {
  return { rpc: handler };
}

test("repository authenticates an active token and touches stale usage", async () => {
  const token = createBotToken(() => Buffer.alloc(32, 5));
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = createRpcClient(async (name, args) => {
    calls.push({ name, args });
    if (name === "bot_token_lookup_internal") {
      return {
        data: [
          {
            token_id: TOKEN_ID,
            bot_id: BOT_ID,
            token_hash: hashBotToken(token.raw, TEST_PEPPER),
            token_created_at: "2026-08-31T10:00:00.000Z",
            token_last_used_at: "2026-08-31T10:04:59.000Z",
            bot_state: "active",
          },
        ],
        error: null,
      };
    }
    return { data: true, error: null };
  });
  const repository = createBotTokenRepository(
    {
      SUPABASE_URL: "https://example.test",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      BOT_TOKEN_PEPPER: TEST_PEPPER,
    },
    client,
    () => new Date("2026-08-31T10:10:00.000Z"),
  );

  const result = await repository.authenticateBotToken(`Bot ${token.raw}`);

  assert.deepEqual(result, { botId: BOT_ID, tokenId: TOKEN_ID });
  assert.deepEqual(calls, [
    {
      name: "bot_token_lookup_internal",
      args: { p_token_prefix: token.prefix },
    },
    {
      name: "bot_token_touch_internal",
      args: {
        p_token_id: TOKEN_ID,
        p_used_at: "2026-08-31T10:10:00.000Z",
      },
    },
  ]);
});

test("repository skips a recent touch and ignores a sanitized touch failure", async () => {
  const token = createBotToken(() => Buffer.alloc(32, 6));
  let touchCalls = 0;
  const recentClient = createRpcClient(async (name) => {
    if (name === "bot_token_lookup_internal") {
      return {
        data: [
          {
            token_id: TOKEN_ID,
            bot_id: BOT_ID,
            token_hash: hashBotToken(token.raw, TEST_PEPPER),
            token_created_at: "2026-08-31T10:00:00.000Z",
            token_last_used_at: "2026-08-31T10:08:00.001Z",
            bot_state: "active",
          },
        ],
        error: null,
      };
    }
    touchCalls += 1;
    return { data: null, error: { message: "must not escape" } };
  });
  const recentRepository = createBotTokenRepository(
    {
      SUPABASE_URL: "https://example.test",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      BOT_TOKEN_PEPPER: TEST_PEPPER,
    },
    recentClient,
    () => new Date("2026-08-31T10:10:00.000Z"),
  );

  assert.deepEqual(
    await recentRepository.authenticateBotToken(`Bot ${token.raw}`),
    { botId: BOT_ID, tokenId: TOKEN_ID },
  );
  assert.equal(touchCalls, 0);

  const staleRepository = createBotTokenRepository(
    {
      SUPABASE_URL: "https://example.test",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      BOT_TOKEN_PEPPER: TEST_PEPPER,
    },
    createRpcClient(async (name) =>
      name === "bot_token_lookup_internal"
        ? {
            data: [
              {
                token_id: TOKEN_ID,
                bot_id: BOT_ID,
                token_hash: hashBotToken(token.raw, TEST_PEPPER),
                token_created_at: "2026-08-31T10:00:00.000Z",
                token_last_used_at: null,
                bot_state: "active",
              },
            ],
            error: null,
          }
        : { data: null, error: { message: "sensitive database detail" } },
    ),
    () => new Date("2026-08-31T10:10:00.000Z"),
  );

  assert.deepEqual(
    await staleRepository.authenticateBotToken(`Bot ${token.raw}`),
    { botId: BOT_ID, tokenId: TOKEN_ID },
  );
});

test("repository returns one generic unauthorized error for every credential failure", async () => {
  const validToken = createBotToken(() => Buffer.alloc(32, 8));
  const cases: Array<{ header: string | undefined; rows: unknown[] }> = [
    { header: undefined, rows: [] },
    { header: "Bearer hidden", rows: [] },
    { header: `Bot ${validToken.raw}`, rows: [] },
    {
      header: `Bot ${validToken.raw}`,
      rows: [
        {
          token_id: TOKEN_ID,
          bot_id: BOT_ID,
          token_hash: "0".repeat(64),
          token_created_at: "2026-08-31T10:00:00.000Z",
          token_last_used_at: null,
          bot_state: "active",
        },
      ],
    },
    ...["paused", "suspended", "pending_delete", "deleted"].map((state) => ({
      header: `Bot ${validToken.raw}`,
      rows: [
        {
          token_id: TOKEN_ID,
          bot_id: BOT_ID,
          token_hash: hashBotToken(validToken.raw, TEST_PEPPER),
          token_created_at: "2026-08-31T10:00:00.000Z",
          token_last_used_at: null,
          bot_state: state,
        },
      ],
    })),
  ];

  for (const current of cases) {
    const repository = createBotTokenRepository(
      {
        SUPABASE_URL: "https://example.test",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
        BOT_TOKEN_PEPPER: TEST_PEPPER,
      },
      createRpcClient(async () => ({ data: current.rows, error: null })),
    );

    await assert.rejects(
      repository.authenticateBotToken(current.header),
      (error: unknown) =>
        error instanceof BotApiError &&
        error.code === "unauthorized" &&
        error.status === 401 &&
        error.message === "bot_api_unauthorized",
    );
  }
});

test("repository sanitizes lookup and malformed database responses", async () => {
  const token = createBotToken(() => Buffer.alloc(32, 4));
  for (const response of [
    { data: null, error: { message: "database host and query" } },
    { data: [{ token_id: "bad" }], error: null },
    { data: [{}, {}], error: null },
  ]) {
    const repository = createBotTokenRepository(
      {
        SUPABASE_URL: "https://example.test",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
        BOT_TOKEN_PEPPER: TEST_PEPPER,
      },
      createRpcClient(async () => response),
    );

    await assert.rejects(
      repository.authenticateBotToken(`Bot ${token.raw}`),
      (error: unknown) =>
        error instanceof BotApiError &&
        error.code === "internal_error" &&
        error.message === "bot_api_internal_error",
    );
  }
});
