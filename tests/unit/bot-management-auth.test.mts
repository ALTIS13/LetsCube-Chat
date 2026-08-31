import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import test from "node:test";

import pino from "../../artifacts/api-server/node_modules/pino/pino.js";

import { createBotGatewayApp } from "../../artifacts/api-server/src/bot/app.ts";
import { BotApiError } from "../../artifacts/api-server/src/bot/errors.ts";
import { parseManagementAuthorization } from "../../artifacts/api-server/src/bot/managementAuth.ts";
import { createBotManagementRateLimiter } from "../../artifacts/api-server/src/bot/managementRoutes.ts";
import { exactAuthorizationHeader } from "../../artifacts/api-server/src/bot/methodRouter.ts";
import {
  createBotToken,
  hashBotToken,
} from "../../artifacts/api-server/src/bot/tokenAuth.ts";

const REQUEST_ID = "management-request-id-1";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const BOT_ID = "22222222-2222-4222-8222-222222222222";
const DEVELOPER_ID = "33333333-3333-4333-8333-333333333333";
const CHAT_ID = "44444444-4444-4444-8444-444444444444";
const ACCESS_TOKEN = "header.payload.signature";
const TEST_PEPPER = "test-only-pepper-with-at-least-32-bytes";
const TRUSTED_ORIGIN = "https://app.letscube.ru";
const WEBHOOK_KEY = Buffer.alloc(32, 11);

type HttpResult = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

type ManagementCall = {
  name: string;
  args?: Record<string, unknown>;
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
          let parsed: unknown = null;
          if (text) {
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = text;
            }
          }
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: parsed,
          });
        });
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}

function createManagementApp(input: {
  getUser?: (token: string) => Promise<unknown>;
  rpc?: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  calls?: ManagementCall[];
  rateLimiter?: {
    consume: (actorId: string, operation: string) => number | null;
  };
} = {}) {
  const calls = input.calls ?? [];
  const managementClient = {
    auth: {
      async getUser(token: string) {
        return (
          (await input.getUser?.(token)) ?? {
            data: { user: { id: USER_ID } },
            error: null,
          }
        );
      },
    },
    async rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ name, args });
      return (
        (await input.rpc?.(name, args)) ?? {
          data: [],
          error: null,
        }
      );
    },
  };

  return createBotGatewayApp({
    logger: pino({ enabled: false }),
    handlers: {},
    requestId: () => REQUEST_ID,
    tokenRepository: {
      async authenticateBotToken() {
        throw new Error("public Bot authentication must not run for management");
      },
    },
    management: {
      client: managementClient,
      tokenPepper: TEST_PEPPER,
      allowedOrigins: [TRUSTED_ORIGIN],
      randomBytes: () => Buffer.alloc(32, 7),
      webhookEncryptionKey: WEBHOOK_KEY,
      validateWebhookTarget: async (rawUrl: string) => ({
        url: new URL(rawUrl),
        hostname: new URL(rawUrl).hostname,
        addresses: [{ address: "203.0.113.10", family: 4 as const }],
      }),
      rateLimiter: input.rateLimiter,
    },
  } as Parameters<typeof createBotGatewayApp>[0]);
}

test("management rate limits by verified user and normalized operation before mutation", async (t) => {
  const calls: ManagementCall[] = [];
  const checks: Array<{ actorId: string; operation: string }> = [];
  const server = await listen(
    createManagementApp({
      calls,
      rateLimiter: {
        consume(actorId, operation) {
          checks.push({ actorId, operation });
          return 17;
        },
      },
    }),
  );
  t.after(() => close(server));

  const response = await call(server, "/bot/manage/v1/bots", {
    method: "POST",
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      username: "rate_limit_bot",
      display_name: "Rate limit bot",
      description: "",
    }),
  });

  assert.equal(response.status, 429, JSON.stringify(response));
  assert.deepEqual(response.body, {
    ok: false,
    error: {
      code: "rate_limited",
      message: "Too many requests",
      request_id: REQUEST_ID,
      retry_after: 17,
    },
  });
  assert.equal(response.headers["retry-after"], "17");
  assert.deepEqual(checks, [{ actorId: USER_ID, operation: "POST /bots" }]);
  assert.deepEqual(calls, []);
});

test("default management rate limiter isolates users and operations", () => {
  let now = 1_000;
  const limiter = createBotManagementRateLimiter(() => now);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(limiter.consume(USER_ID, "POST /bots"), null);
  }
  assert.equal(limiter.consume(USER_ID, "POST /bots"), 60);
  assert.equal(limiter.consume(DEVELOPER_ID, "POST /bots"), null);
  assert.equal(limiter.consume(USER_ID, "POST /bots/:botId/pause"), null);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(
      limiter.consume(USER_ID, "POST /bots/:botId/deletion/request"),
      null,
    );
  }
  assert.equal(
    limiter.consume(USER_ID, "POST /bots/:botId/deletion/request"),
    60,
  );

  now += 60_000;
  assert.equal(limiter.consume(USER_ID, "POST /bots"), null);
});

test("management rejects a missing user bearer before any service-role RPC", async (t) => {
  const calls: ManagementCall[] = [];
  const server = await listen(createManagementApp({ calls }));
  t.after(() => close(server));

  const response = await call(server, "/bot/manage/v1/bots");

  assert.equal(response.status, 401, JSON.stringify(response));
  assert.deepEqual(response.body, {
    ok: false,
    error: {
      code: "unauthorized",
      message: "Unauthorized",
      request_id: REQUEST_ID,
    },
  });
  assert.equal(response.headers["cache-control"], "no-store, private");
  assert.equal(response.headers.pragma, "no-cache");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.deepEqual(calls, []);
});

test("management CORS allows only the exact trusted origin and required headers", async (t) => {
  const server = await listen(createManagementApp());
  t.after(() => close(server));

  const response = await call(server, "/bot/manage/v1/bots", {
    method: "OPTIONS",
    headers: {
      origin: TRUSTED_ORIGIN,
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization, content-type",
    },
  });

  assert.equal(response.status, 204, JSON.stringify(response));
  assert.equal(response.headers["access-control-allow-origin"], TRUSTED_ORIGIN);
  assert.equal(
    response.headers["access-control-allow-methods"],
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  assert.equal(
    response.headers["access-control-allow-headers"],
    "Authorization,Content-Type",
  );
  assert.equal(response.headers["access-control-allow-credentials"], undefined);
  assert.match(String(response.headers.vary), /Origin/);
});

test("management rejects untrusted origins before user authentication", async (t) => {
  let authCalls = 0;
  const calls: ManagementCall[] = [];
  const server = await listen(
    createManagementApp({
      calls,
      async getUser() {
        authCalls += 1;
        return { data: { user: { id: USER_ID } }, error: null };
      },
    }),
  );
  t.after(() => close(server));

  for (const origin of [
    "https://attacker.example",
    "https://app.letscube.ru.attacker.example",
    "null",
  ]) {
    const response = await call(server, "/bot/manage/v1/bots", {
      headers: {
        origin,
        authorization: `Bearer ${ACCESS_TOKEN}`,
      },
    });
    assert.equal(response.status, 403, `${origin}: ${JSON.stringify(response)}`);
    assert.equal(response.headers["access-control-allow-origin"], undefined);
    assert.equal(response.headers.vary, "Origin");
  }
  assert.equal(authCalls, 0);
  assert.deepEqual(calls, []);
});

test("public Bot API remains non-CORS when management CORS is enabled", async (t) => {
  const server = await listen(createManagementApp());
  t.after(() => close(server));

  const response = await call(server, "/bot/v1/getMe", {
    method: "OPTIONS",
    headers: {
      origin: TRUSTED_ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization",
    },
  });

  assert.equal(response.headers["access-control-allow-origin"], undefined);
  assert.equal(response.headers["access-control-allow-methods"], undefined);
});

test("management accepts exactly one canonical Supabase Bearer credential", async (t) => {
  const seenTokens: string[] = [];
  const server = await listen(
    createManagementApp({
      async getUser(token) {
        seenTokens.push(token);
        return { data: { user: { id: USER_ID } }, error: null };
      },
    }),
  );
  t.after(() => close(server));

  for (const authorization of [
    `Bot ${ACCESS_TOKEN}`,
    `bearer ${ACCESS_TOKEN}`,
    `Bearer  ${ACCESS_TOKEN}`,
    `Bearer ${ACCESS_TOKEN},Bearer ${ACCESS_TOKEN}`,
    `Bearer ${"x".repeat(4_097)}`,
  ]) {
    const response = await call(server, "/bot/manage/v1/bots", {
      headers: { authorization },
    });
    assert.equal(
      response.status,
      401,
      `${authorization.slice(0, 40)}: ${JSON.stringify(response)}`,
    );
  }

  assert.deepEqual(seenTokens, []);
  assert.throws(
    () =>
      exactAuthorizationHeader({
        rawHeaders: [
          "Authorization",
          `Bearer ${ACCESS_TOKEN}`,
          "Authorization",
          `Bearer ${ACCESS_TOKEN}`,
        ],
        headersDistinct: {
          authorization: [
            `Bearer ${ACCESS_TOKEN}`,
            `Bearer ${ACCESS_TOKEN}`,
          ],
        },
      } as any),
    (error: unknown) =>
      error instanceof BotApiError && error.code === "unauthorized",
  );
  assert.equal(parseManagementAuthorization(`Bearer ${ACCESS_TOKEN} `), null);
  assert.equal(parseManagementAuthorization(`Bearer ${ACCESS_TOKEN}\nignored`), null);
  assert.equal(parseManagementAuthorization(`Bearer ${ACCESS_TOKEN}`), ACCESS_TOKEN);
});

test("expired user sessions fail before every service-role RPC", async (t) => {
  const calls: ManagementCall[] = [];
  const server = await listen(
    createManagementApp({
      calls,
      async getUser() {
        return {
          data: { user: null },
          error: { message: "expired token detail must not escape" },
        };
      },
    }),
  );
  t.after(() => close(server));

  const response = await call(server, "/bot/manage/v1/bots", {
    headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
  });

  assert.equal(response.status, 401, JSON.stringify(response));
  assert.deepEqual(response.body, {
    ok: false,
    error: {
      code: "unauthorized",
      message: "Unauthorized",
      request_id: REQUEST_ID,
    },
  });
  assert.deepEqual(calls, []);
});

test("management passes only the getUser identity to service-role RPCs", async (t) => {
  const calls: ManagementCall[] = [];
  const server = await listen(
    createManagementApp({
      calls,
      async rpc(name) {
        if (name === "bot_list_owned_internal") {
          return { data: [], error: null };
        }
        assert.equal(name, "bot_creation_eligibility_internal");
        return {
          data: [
            {
              email_verified: true,
              phone_verified: true,
              account_age_met: true,
              not_banned: true,
              under_limit: true,
              active_bot_count: 0,
              max_bots: 3,
              can_create: true,
            },
          ],
          error: null,
        };
      },
    }),
  );
  t.after(() => close(server));

  const response = await call(
    server,
    "/bot/manage/v1/bots?actor_id=99999999-9999-4999-8999-999999999999",
    { headers: { authorization: `Bearer ${ACCESS_TOKEN}` } },
  );

  assert.equal(response.status, 200, JSON.stringify(response));
  assert.deepEqual(response.body, {
    ok: true,
    result: {
      bots: [],
      eligibility: {
        email_verified: true,
        phone_verified: true,
        account_age_met: true,
        not_banned: true,
        under_limit: true,
        active_bot_count: 0,
        max_bots: 3,
        can_create: true,
      },
    },
  });
  assert.deepEqual(calls, [
    {
      name: "bot_list_owned_internal",
      args: { p_actor_id: USER_ID },
    },
    {
      name: "bot_creation_eligibility_internal",
      args: { p_actor_id: USER_ID },
    },
  ]);
});

test("list returns validated safe bot summaries and current-user eligibility", async (t) => {
  const calls: ManagementCall[] = [];
  const server = await listen(
    createManagementApp({
      calls,
      async rpc(name) {
        if (name === "bot_list_owned_internal") {
          return {
            data: [
              {
                bot_id: BOT_ID,
                username: "cube_helper",
                display_name: "Cube Helper",
                description: "Помогает в чатах",
                avatar_url: null,
                state: "paused",
                delete_after: null,
                owner_role: "developer",
                active_token_prefix: "lc_bot_0707070707",
                token_created_at: "2026-08-31T01:00:00.000Z",
                token_last_used_at: null,
                created_at: "2026-08-30T01:00:00.000Z",
                updated_at: "2026-08-31T02:00:00.000Z",
              },
            ],
            error: null,
          };
        }
        assert.equal(name, "bot_creation_eligibility_internal");
        return {
          data: [
            {
              email_verified: true,
              phone_verified: false,
              account_age_met: true,
              not_banned: true,
              under_limit: true,
              active_bot_count: 1,
              max_bots: 3,
              can_create: false,
            },
          ],
          error: null,
        };
      },
    }),
  );
  t.after(() => close(server));

  const response = await call(server, "/bot/manage/v1/bots", {
    headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
  });

  assert.equal(response.status, 200, JSON.stringify(response));
  assert.deepEqual(response.body, {
    ok: true,
    result: {
      bots: [
        {
          id: BOT_ID,
          username: "cube_helper",
          display_name: "Cube Helper",
          description: "Помогает в чатах",
          avatar_url: null,
          state: "paused",
          delete_after: null,
          role: "developer",
          token: {
            prefix: "lc_bot_0707070707",
            created_at: "2026-08-31T01:00:00.000Z",
            last_used_at: null,
          },
          created_at: "2026-08-30T01:00:00.000Z",
          updated_at: "2026-08-31T02:00:00.000Z",
        },
      ],
      eligibility: {
        email_verified: true,
        phone_verified: false,
        account_age_met: true,
        not_banned: true,
        under_limit: true,
        active_bot_count: 1,
        max_bots: 3,
        can_create: false,
      },
    },
  });
  assert.deepEqual(calls, [
    { name: "bot_list_owned_internal", args: { p_actor_id: USER_ID } },
    {
      name: "bot_creation_eligibility_internal",
      args: { p_actor_id: USER_ID },
    },
  ]);
});

test("creation returns deterministic token material once and stores only HMAC data", async (t) => {
  const calls: ManagementCall[] = [];
  const expectedToken = createBotToken(() => Buffer.alloc(32, 7));
  const server = await listen(
    createManagementApp({
      calls,
      async rpc(name) {
        assert.equal(name, "bot_create_internal");
        return {
          data: [
            {
              bot_id: BOT_ID,
              username: "cube_helper",
              display_name: "Cube Helper",
              description: "Помогает в чатах",
              state: "active",
              token_id: DEVELOPER_ID,
              token_prefix: expectedToken.prefix,
              created_at: "2026-08-31T03:00:00.000Z",
            },
          ],
          error: null,
        };
      },
    }),
  );
  t.after(() => close(server));
  const payload = JSON.stringify({
    username: "cube_helper",
    display_name: "Cube Helper",
    description: "Помогает в чатах",
  });

  const response = await call(server, "/bot/manage/v1/bots", {
    method: "POST",
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    body: payload,
  });

  assert.equal(response.status, 201, JSON.stringify(response));
  assert.deepEqual(response.body, {
    ok: true,
    result: {
      bot: {
        id: BOT_ID,
        username: "cube_helper",
        display_name: "Cube Helper",
        description: "Помогает в чатах",
        state: "active",
        created_at: "2026-08-31T03:00:00.000Z",
      },
      token: expectedToken.raw,
    },
  });
  assert.equal(response.headers["cache-control"], "no-store, private");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.deepEqual(calls, [
    {
      name: "bot_create_internal",
      args: {
        p_actor_id: USER_ID,
        p_username: "cube_helper",
        p_display_name: "Cube Helper",
        p_description: "Помогает в чатах",
        p_token_prefix: expectedToken.prefix,
        p_token_hash: hashBotToken(expectedToken.raw, TEST_PEPPER),
        p_request_id: REQUEST_ID,
      },
    },
  ]);
  assert.equal(JSON.stringify(calls).includes(expectedToken.raw), false);
});

test("rotation requires the observed prefix and never sends raw token to SQL", async (t) => {
  const calls: ManagementCall[] = [];
  const expectedToken = createBotToken(() => Buffer.alloc(32, 7));
  const server = await listen(
    createManagementApp({
      calls,
      async rpc(name) {
        assert.equal(name, "bot_rotate_token_internal");
        return {
          data: [
            {
              token_id: DEVELOPER_ID,
              token_prefix: expectedToken.prefix,
              created_at: "2026-08-31T04:00:00.000Z",
            },
          ],
          error: null,
        };
      },
    }),
  );
  t.after(() => close(server));

  const response = await call(
    server,
    `/bot/manage/v1/bots/${BOT_ID}/token/rotate`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expected_token_prefix: "lc_bot_0101010101" }),
    },
  );

  assert.equal(response.status, 200, JSON.stringify(response));
  assert.deepEqual(response.body, {
    ok: true,
    result: {
      token: expectedToken.raw,
      token_prefix: expectedToken.prefix,
      created_at: "2026-08-31T04:00:00.000Z",
    },
  });
  assert.deepEqual(calls, [
    {
      name: "bot_rotate_token_internal",
      args: {
        p_actor_id: USER_ID,
        p_bot_id: BOT_ID,
        p_expected_token_prefix: "lc_bot_0101010101",
        p_token_prefix: expectedToken.prefix,
        p_token_hash: hashBotToken(expectedToken.raw, TEST_PEPPER),
        p_request_id: REQUEST_ID,
      },
    },
  ]);
  assert.equal(JSON.stringify(calls).includes(expectedToken.raw), false);
});

test("management validates mutable identifiers before calling SQL", async (t) => {
  const calls: ManagementCall[] = [];
  const server = await listen(createManagementApp({ calls }));
  t.after(() => close(server));

  const response = await call(
    server,
    "/bot/manage/v1/bots/not-a-uuid/pause",
    {
      method: "POST",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
    },
  );

  assert.equal(response.status, 400, JSON.stringify(response));
  assert.deepEqual(calls, []);
});

test("creation eligibility failures remain generic", async (t) => {
  const server = await listen(
    createManagementApp({
      async rpc() {
        return {
          data: null,
          error: {
            code: "42501",
            message: "bot_creation_not_allowed: phone missing",
          },
        };
      },
    }),
  );
  t.after(() => close(server));

  const response = await call(server, "/bot/manage/v1/bots", {
    method: "POST",
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      username: "cube_helper",
      display_name: "Cube Helper",
      description: "",
    }),
  });

  assert.equal(response.status, 403, JSON.stringify(response));
  assert.deepEqual(response.body, {
    ok: false,
    error: {
      code: "bot_creation_not_allowed",
      message: "Bot creation is not allowed",
      request_id: REQUEST_ID,
    },
  });
  assert.equal(JSON.stringify(response.body).includes("phone"), false);
});

test("owner and developer management verbs map to fixed RPCs", async (t) => {
  const cases = [
    {
      method: "PATCH",
      path: `/bot/manage/v1/bots/${BOT_ID}/profile`,
      body: { display_name: "Cube Helper", description: "Updated" },
      rpc: "bot_update_profile_internal",
    },
    {
      method: "PUT",
      path: `/bot/manage/v1/bots/${BOT_ID}/commands`,
      body: { commands: [{ command: "start", description: "Start" }] },
      rpc: "bot_management_commands_replace_internal",
    },
    {
      method: "POST",
      path: `/bot/manage/v1/bots/${BOT_ID}/pause`,
      body: {},
      rpc: "bot_pause_internal",
    },
    {
      method: "POST",
      path: `/bot/manage/v1/bots/${BOT_ID}/resume`,
      body: {},
      rpc: "bot_resume_internal",
    },
    {
      method: "POST",
      path: `/bot/manage/v1/bots/${BOT_ID}/developers`,
      body: { username: "developer_user" },
      rpc: "bot_developer_add_internal",
    },
    {
      method: "DELETE",
      path: `/bot/manage/v1/bots/${BOT_ID}/developers/${DEVELOPER_ID}`,
      rpc: "bot_developer_remove_internal",
    },
    {
      method: "POST",
      path: `/bot/manage/v1/bots/${BOT_ID}/token/revoke`,
      body: {},
      rpc: "bot_revoke_token_internal",
    },
    {
      method: "POST",
      path: `/bot/manage/v1/bots/${BOT_ID}/deletion/request`,
      body: {},
      rpc: "bot_request_deletion_internal",
    },
    {
      method: "POST",
      path: `/bot/manage/v1/bots/${BOT_ID}/deletion/cancel`,
      body: {},
      rpc: "bot_cancel_deletion_internal",
    },
    {
      method: "PATCH",
      path: `/bot/manage/v1/bots/${BOT_ID}/privacy/${CHAT_ID}`,
      body: { request_full_visibility: true },
      rpc: "bot_privacy_request_internal",
    },
  ] as const;

  for (const current of cases) {
    const calls: ManagementCall[] = [];
    const server = await listen(
      createManagementApp({
        calls,
        async rpc() {
          return { data: { success: true }, error: null };
        },
      }),
    );
    const response = await call(server, current.path, {
      method: current.method,
      headers: {
        authorization: `Bearer ${ACCESS_TOKEN}`,
        ...(current.body ? { "content-type": "application/json" } : {}),
      },
      ...(current.body ? { body: JSON.stringify(current.body) } : {}),
    });
    await close(server);

    assert.equal(response.status, 200, `${current.rpc}: ${JSON.stringify(response)}`);
    assert.equal(calls.length, 1, current.rpc);
    assert.equal(calls[0]?.name, current.rpc);
    assert.equal(calls[0]?.args?.p_actor_id, USER_ID);
    assert.equal(calls[0]?.args?.p_bot_id, BOT_ID);
    assert.equal(calls[0]?.args?.p_request_id, REQUEST_ID);
  }
});

test("detail projects only bounded owner/developer configuration and diagnostics", async (t) => {
  const calls: ManagementCall[] = [];
  const detailRow = {
    bot_id: BOT_ID,
    username: "cube_helper",
    display_name: "Cube Helper",
    description: "Помогает в чатах",
    avatar_url: null,
    state: "active",
    delete_after: null,
    owner_role: "owner",
    active_token_prefix: "lc_bot_0707070707",
    token_created_at: "2026-08-31T01:00:00.000Z",
    token_last_used_at: "2026-08-31T02:00:00.000Z",
    created_at: "2026-08-30T01:00:00.000Z",
    updated_at: "2026-08-31T02:00:00.000Z",
    commands: [{ command: "start", description: "Start" }],
    developers: [
      {
        user_id: DEVELOPER_ID,
        display_name: "Developer",
        username: "developer_user",
        created_at: "2026-08-31T01:30:00.000Z",
      },
    ],
    privacy: [
      {
        chat_id: CHAT_ID,
        chat_name: "Operations",
        privacy_mode: "restricted",
        full_visibility_requested_at: "2026-08-31T02:30:00.000Z",
        full_visibility_approved: false,
      },
    ],
    webhook_configured: true,
    webhook_url: "https://hooks.example.test/cube",
    delivery_mode: "webhook",
    pending_update_count: 2,
    failure_count: 1,
    last_error_code: "timeout",
    diagnostics_refreshed_at: "2026-08-31T03:00:00.000Z",
  };
  const server = await listen(
    createManagementApp({
      calls,
      async rpc(name) {
        assert.equal(name, "bot_management_detail_internal");
        return { data: [detailRow], error: null };
      },
    }),
  );
  t.after(() => close(server));

  const response = await call(server, `/bot/manage/v1/bots/${BOT_ID}`, {
    headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
  });

  assert.equal(response.status, 200, JSON.stringify(response));
  assert.deepEqual(response.body, {
    ok: true,
    result: {
      bot: {
        id: BOT_ID,
        username: "cube_helper",
        display_name: "Cube Helper",
        description: "Помогает в чатах",
        avatar_url: null,
        state: "active",
        delete_after: null,
        role: "owner",
        token: {
          prefix: "lc_bot_0707070707",
          created_at: "2026-08-31T01:00:00.000Z",
          last_used_at: "2026-08-31T02:00:00.000Z",
        },
        created_at: "2026-08-30T01:00:00.000Z",
        updated_at: "2026-08-31T02:00:00.000Z",
      },
      commands: [{ command: "start", description: "Start" }],
      developers: [
        {
          user_id: DEVELOPER_ID,
          display_name: "Developer",
          username: "developer_user",
          created_at: "2026-08-31T01:30:00.000Z",
        },
      ],
      privacy: [
        {
          chat_id: CHAT_ID,
          chat_name: "Operations",
          privacy_mode: "restricted",
          full_visibility_requested_at: "2026-08-31T02:30:00.000Z",
          full_visibility_approved: false,
        },
      ],
      webhook: {
        configured: true,
        url: "https://hooks.example.test/cube",
      },
      diagnostics: {
        delivery_mode: "webhook",
        pending_update_count: 2,
        failure_count: 1,
        last_error_code: "timeout",
        refreshed_at: "2026-08-31T03:00:00.000Z",
      },
    },
  });
  assert.deepEqual(calls, [
    {
      name: "bot_management_detail_internal",
      args: { p_actor_id: USER_ID, p_bot_id: BOT_ID },
    },
  ]);
});

test("detail fails closed when SQL includes private token or webhook fields", async (t) => {
  const server = await listen(
    createManagementApp({
      async rpc() {
        return {
          data: [
            {
              token_hash: "0".repeat(64),
              webhook_secret: "must-not-escape",
            },
          ],
          error: null,
        };
      },
    }),
  );
  t.after(() => close(server));

  const response = await call(server, `/bot/manage/v1/bots/${BOT_ID}`, {
    headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
  });

  assert.equal(response.status, 500, JSON.stringify(response));
  assert.equal(JSON.stringify(response.body).includes("must-not-escape"), false);
  assert.equal(JSON.stringify(response.body).includes("token_hash"), false);
});

test("webhook management validates then encrypts the write-only secret", async (t) => {
  const calls: ManagementCall[] = [];
  const secret = "webhook_secret_123456789";
  const server = await listen(
    createManagementApp({
      calls,
      async rpc() {
        return { data: { success: true }, error: null };
      },
    }),
  );
  t.after(() => close(server));

  const response = await call(
    server,
    `/bot/manage/v1/bots/${BOT_ID}/webhook`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://hooks.example.test/cube",
        secret,
        drop_pending_updates: false,
      }),
    },
  );

  assert.equal(response.status, 200, JSON.stringify(response));
  assert.equal(calls[0]?.name, "bot_management_webhook_set_internal");
  assert.equal(calls[0]?.args?.p_url, "https://hooks.example.test/cube");
  assert.match(String(calls[0]?.args?.p_secret_ciphertext), /^enc:v1:/);
  assert.match(String(calls[0]?.args?.p_secret_fingerprint), /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(calls).includes(secret), false);
  assert.equal(JSON.stringify(response.body).includes(secret), false);
});

test("dedicated diagnostics and webhook removal remain fixed RPCs", async (t) => {
  const calls: ManagementCall[] = [];
  const server = await listen(
    createManagementApp({
      calls,
      async rpc(name) {
        if (name === "bot_management_diagnostics_internal") {
          return {
            data: [
              {
                delivery_mode: "polling",
                webhook_configured: false,
                pending_update_count: 4,
                failure_count: 0,
                last_error_code: null,
                diagnostics_refreshed_at: "2026-08-31T03:00:00.000Z",
              },
            ],
            error: null,
          };
        }
        return { data: { success: true }, error: null };
      },
    }),
  );
  t.after(() => close(server));

  const diagnostics = await call(
    server,
    `/bot/manage/v1/bots/${BOT_ID}/diagnostics`,
    { headers: { authorization: `Bearer ${ACCESS_TOKEN}` } },
  );
  assert.equal(diagnostics.status, 200, JSON.stringify(diagnostics));
  assert.deepEqual(diagnostics.body, {
    ok: true,
    result: {
      delivery_mode: "polling",
      webhook_configured: false,
      pending_update_count: 4,
      failure_count: 0,
      last_error_code: null,
      refreshed_at: "2026-08-31T03:00:00.000Z",
    },
  });

  const deletePayload = JSON.stringify({ drop_pending_updates: true });
  const removed = await call(
    server,
    `/bot/manage/v1/bots/${BOT_ID}/webhook`,
    {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${ACCESS_TOKEN}`,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(deletePayload).toString(),
      },
      body: deletePayload,
    },
  );
  assert.equal(removed.status, 200, JSON.stringify(removed));
  const removeCall = calls.at(-1);
  assert.equal(removeCall?.name, "bot_management_webhook_delete_internal");
  assert.equal(removeCall?.args?.p_drop_pending_updates, true);
  assert.equal(removeCall?.args?.p_actor_id, USER_ID);
  assert.equal(removeCall?.args?.p_request_id, REQUEST_ID);
});

test("platform admin inspect and suspension use separate safe RPCs", async (t) => {
  const calls: ManagementCall[] = [];
  const server = await listen(
    createManagementApp({
      calls,
      async rpc(name) {
        if (name === "bot_admin_list_internal") {
          return {
            data: [
              {
                bot_id: BOT_ID,
                username: "cube_helper",
                display_name: "Cube Helper",
                state: "suspended",
                owner_count: 1,
                developer_count: 1,
                created_at: "2026-08-30T01:00:00.000Z",
                updated_at: "2026-08-31T02:00:00.000Z",
              },
            ],
            error: null,
          };
        }
        return { data: { success: true }, error: null };
      },
    }),
  );
  t.after(() => close(server));

  const list = await call(server, "/bot/manage/v1/admin/bots", {
    headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  assert.equal(list.status, 200, JSON.stringify(list));
  assert.deepEqual(list.body, {
    ok: true,
    result: {
      bots: [
        {
          id: BOT_ID,
          username: "cube_helper",
          display_name: "Cube Helper",
          state: "suspended",
          owner_count: 1,
          developer_count: 1,
          created_at: "2026-08-30T01:00:00.000Z",
          updated_at: "2026-08-31T02:00:00.000Z",
        },
      ],
    },
  });

  for (const [verb, suspend] of [
    ["suspend", true],
    ["unsuspend", false],
  ] as const) {
    const response = await call(
      server,
      `/bot/manage/v1/admin/bots/${BOT_ID}/${verb}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      },
    );
    assert.equal(response.status, 200, `${verb}: ${JSON.stringify(response)}`);
    const rpc = calls.at(-1);
    assert.equal(rpc?.name, "bot_suspend_internal");
    assert.equal(rpc?.args?.p_suspend, suspend);
    assert.equal(rpc?.args?.p_actor_id, USER_ID);
  }
  assert.equal(JSON.stringify(list.body).includes("token"), false);
  assert.equal(JSON.stringify(list.body).includes("webhook"), false);
});
