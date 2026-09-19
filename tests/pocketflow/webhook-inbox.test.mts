import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import test from "node:test";

import type { Express } from "express";

import { loadConfig, type PocketFlowConfig } from "../../artifacts/pocketflow/src/config.ts";
import { createLogger } from "../../artifacts/pocketflow/src/lib/logger.ts";
import { createApp } from "../../artifacts/pocketflow/src/http/server.ts";
import {
  createRateLimiter,
  readBoundedBody,
} from "../../artifacts/pocketflow/src/http/hookRoute.ts";
import { createRouter } from "../../artifacts/pocketflow/src/app/router.ts";
import { webhooksFeature } from "../../artifacts/pocketflow/src/app/webhooks.ts";
import {
  createWebhook,
  hashSecret,
  mintSecret,
  verifySecret,
  type Webhook,
} from "../../artifacts/pocketflow/src/store/webhooks.ts";
import { LETSCUBE_WEBHOOK_SECRET_HEADER, parseUpdate } from "../../artifacts/pocketflow/src/transport/letscube.ts";
import type { Db } from "../../artifacts/pocketflow/src/store/db.ts";
import type { BotTransport, Update } from "../../artifacts/pocketflow/src/transport/types.ts";

/**
 * The webhook inbox, end to end over real HTTP, with no Postgres and no
 * gateway.
 *
 * **What the fake database is and is not.** It is an in-memory interpreter for
 * the dozen statements this feature issues, and it enforces the parts of them
 * that carry meaning — the owner filter, `on conflict do nothing`, the
 * per-owner limit. It is therefore a real test of the route logic, the
 * ownership rule and the delivery protocol. It is **not** a test of the SQL
 * text: a typo in a column name would pass here and fail against Postgres.
 * Anything it does not recognise throws rather than returning an empty result,
 * so a statement that changes shape shows up as a failure instead of quietly
 * finding nothing.
 */

type WebhookRow = {
  id: string;
  owner_id: string;
  chat_id: string;
  display_name: string;
  secret_hash: string;
  enabled: boolean;
  event_count: number;
  created_at: Date;
  last_used_at: Date | null;
};

type PromptRow = {
  chat_id: string;
  user_id: string;
  kind: string;
  context: Record<string, unknown>;
  expires_at: Date;
};

type FakeDb = {
  db: Db;
  rows: WebhookRow[];
  events: Set<string>;
  prompts: Map<string, PromptRow>;
  queries: { sql: string; values: unknown[] }[];
  /** Every statement that could change a webhook. The ownership tests read this. */
  webhookWrites(): { sql: string; values: unknown[] }[];
};

function createFakeDb(): FakeDb {
  const rows: WebhookRow[] = [];
  const events = new Set<string>();
  const prompts = new Map<string, PromptRow>();
  const users = new Map<string, Record<string, unknown>>();
  const processed = new Set<number>();
  const queries: { sql: string; values: unknown[] }[] = [];

  function result(rowsOut: unknown[], rowCount?: number) {
    return { rows: rowsOut, rowCount: rowCount ?? rowsOut.length } as never;
  }

  const db = {
    async query(text: string, values: readonly unknown[] = []) {
      const sql = text.replace(/\s+/g, " ").trim().toLowerCase();
      const v = [...values];
      queries.push({ sql, values: v });

      if (sql.startsWith("insert into pf_webhooks")) {
        const ownerId = String(v[0]);
        const limit = Number(v[4]);
        if (rows.filter((row) => row.owner_id === ownerId).length >= limit) return result([], 0);
        const row: WebhookRow = {
          id: randomUUID(),
          owner_id: ownerId,
          chat_id: String(v[1]),
          display_name: String(v[2]),
          secret_hash: String(v[3]),
          enabled: true,
          event_count: 0,
          created_at: new Date(),
          last_used_at: null,
        };
        rows.push(row);
        return result([row]);
      }
      if (sql.startsWith("select count(*)") && sql.includes("pf_webhooks")) {
        const owned = rows.filter((row) => row.owner_id === String(v[0])).length;
        return result([{ count: String(owned) }]);
      }
      if (sql.includes("from pf_webhooks where owner_id = $1 order by")) {
        return result(
          rows
            .filter((row) => row.owner_id === String(v[0]))
            .sort((a, b) => b.created_at.getTime() - a.created_at.getTime()),
        );
      }
      if (sql.includes("from pf_webhooks where id = $1")) {
        const row = rows.find((entry) => entry.id === String(v[0]));
        return result(row ? [row] : []);
      }
      if (sql.startsWith("update pf_webhooks set event_count")) {
        const row = rows.find((entry) => entry.id === String(v[0]));
        if (!row) return result([], 0);
        row.event_count += 1;
        row.last_used_at = new Date();
        return result([], 1);
      }
      if (sql.startsWith("update pf_webhooks set")) {
        const row = rows.find(
          (entry) => entry.id === String(v[0]) && entry.owner_id === String(v[1]),
        );
        if (!row) return result([], 0);
        if (sql.includes("display_name = $3")) row.display_name = String(v[2]);
        else if (sql.includes("secret_hash = $3")) row.secret_hash = String(v[2]);
        else if (sql.includes("enabled = $3")) row.enabled = Boolean(v[2]);
        else throw new Error(`unhandled update: ${sql}`);
        return result([row]);
      }
      if (sql.startsWith("delete from pf_webhooks")) {
        const index = rows.findIndex(
          (entry) => entry.id === String(v[0]) && entry.owner_id === String(v[1]),
        );
        if (index < 0) return result([], 0);
        rows.splice(index, 1);
        return result([], 1);
      }
      if (sql.startsWith("insert into pf_webhook_events")) {
        const key = `${String(v[0])}\u0000${String(v[1])}`;
        if (events.has(key)) return result([], 0);
        events.add(key);
        return result([], 1);
      }
      if (sql.startsWith("delete from pf_webhook_events where webhook_id")) {
        const key = `${String(v[0])}\u0000${String(v[1])}`;
        return result([], events.delete(key) ? 1 : 0);
      }
      // `pf_pending_prompts` is owned by `store/prompts.ts`, which reminders
      // and settings use as well — so these three are its statements rather
      // than this feature's.
      if (sql.startsWith("insert into pf_pending_prompts")) {
        const key = `${String(v[0])}\u0000${String(v[1])}`;
        prompts.set(key, {
          chat_id: String(v[0]),
          user_id: String(v[1]),
          kind: String(v[2]),
          context: JSON.parse(String(v[3])) as Record<string, unknown>,
          expires_at: new Date(v[4] as string | number | Date),
        });
        return result([], 1);
      }
      if (sql.startsWith("select chat_id, user_id, kind, context, expires_at")) {
        const key = `${String(v[0])}\u0000${String(v[1])}`;
        const row = prompts.get(key);
        const asOf = new Date(v[2] as string | number | Date);
        if (!row || row.expires_at.getTime() <= asOf.getTime()) return result([]);
        return result([row]);
      }
      // The atomic take: one statement that filters by kind and returns the
      // row it removed. The two older forms stay below, because
      // `clearPendingPrompt` still exists for a feature that means it.
      if (sql.startsWith("delete from pf_pending_prompts") && sql.includes("returning")) {
        const key = `${String(v[0])}\u0000${String(v[1])}`;
        const kinds = (v[2] as string[]) ?? [];
        const asOf = new Date(v[3] as string | number | Date);
        const takeRow = prompts.get(key);
        if (!takeRow || !kinds.includes(takeRow.kind)) return result([]);
        if (takeRow.expires_at.getTime() <= asOf.getTime()) return result([]);
        prompts.delete(key);
        return result([takeRow], 1);
      }
      if (sql.startsWith("delete from pf_pending_prompts") && sql.includes("kind = any")) {
        const key = `${String(v[0])}\u0000${String(v[1])}`;
        const kinds = (v[2] as string[]) ?? [];
        const row = prompts.get(key);
        if (!row || !kinds.includes(row.kind)) return result([], 0);
        prompts.delete(key);
        return result([], 1);
      }
      if (sql.startsWith("delete from pf_pending_prompts")) {
        const key = `${String(v[0])}\u0000${String(v[1])}`;
        return result([], prompts.delete(key) ? 1 : 0);
      }
      if (sql.startsWith("insert into pf_users")) {
        const userId = String(v[0]);
        const row = users.get(userId) ?? {
          user_id: userId,
          display_name: v[1],
          username: v[2],
          time_zone: String(v[3]),
          developer_mode: false,
        };
        row.display_name = v[1];
        row.username = v[2];
        users.set(userId, row);
        return result([row]);
      }
      if (sql.startsWith("insert into pf_processed_updates")) {
        const updateId = Number(v[0]);
        if (processed.has(updateId)) return result([], 0);
        processed.add(updateId);
        return result([], 1);
      }
      if (sql.startsWith("delete from pf_processed_updates")) {
        processed.delete(Number(v[0]));
        return result([], 1);
      }
      throw new Error(`unhandled SQL in the fake database: ${sql}`);
    },
    async transaction(fn: (tx: Db) => Promise<unknown>) {
      return fn(db);
    },
    async close() {},
  } as unknown as Db;

  return {
    db,
    rows,
    events,
    prompts,
    queries,
    webhookWrites: () =>
      queries.filter((entry) => entry.sql.includes("pf_webhooks") && !entry.sql.startsWith("select")),
  };
}

type FakeBot = {
  bot: BotTransport;
  sent: { chatId: string; text: string }[];
  answers: { id: string; text: string | null }[];
  failSend: boolean;
};

function createFakeBot(): FakeBot {
  const state: FakeBot = {
    sent: [],
    answers: [],
    failSend: false,
    bot: null as unknown as BotTransport,
  };
  state.bot = {
    platform: "fake",
    supports: () => true,
    async sendText(options: { chatId: string; text: string }) {
      if (state.failSend) throw new Error("gateway refused");
      state.sent.push({ chatId: options.chatId, text: options.text });
      return { id: randomUUID(), chatId: options.chatId, date: new Date() };
    },
    async answerCallbackQuery(id: string, options?: { text?: string }) {
      state.answers.push({ id, text: options?.text ?? null });
    },
    // The real parser, so a malformed update is rejected the way production
    // would reject it rather than the way a stub would.
    parseWebhookUpdate: (body: unknown) => parseUpdate(body),
  } as unknown as BotTransport;
  return state;
}

function testConfig(overrides: Record<string, string | undefined> = {}): PocketFlowConfig {
  return loadConfig({
    BOT_TOKEN: "test-token",
    BOT_API_BASE_URL: "http://127.0.0.1:54321",
    DATABASE_URL: "postgres://localhost/pocketflow_test",
    PUBLIC_BASE_URL: "https://pocketflow.example",
    TRANSPORT: "webhook",
    WEBHOOK_SECRET: "test-webhook-secret-0123456789",
    PORT: "8099",
    ...overrides,
  } as NodeJS.ProcessEnv);
}

/** Logs are discarded, but still produced, so a logging bug fails here too. */
const silentLog = createLogger({ minLevel: "error", write: () => {} });

type Harness = {
  db: FakeDb;
  bot: FakeBot;
  config: PocketFlowConfig;
  app: Express;
  drain(): Promise<void>;
  updates: Update[];
  onUpdate: (update: Update) => Promise<void>;
};

function harness(options?: {
  configOverrides?: Record<string, string | undefined>;
  onUpdate?: (update: Update) => Promise<void>;
  perWebhookLimiter?: ReturnType<typeof createRateLimiter>;
  maxHookBodyBytes?: number;
}): Harness {
  const db = createFakeDb();
  const bot = createFakeBot();
  const config = testConfig(options?.configOverrides);
  const updates: Update[] = [];
  const onUpdate =
    options?.onUpdate ??
    (async (update: Update) => {
      updates.push(update);
    });
  const built = createApp({
    config,
    db: db.db,
    bot: bot.bot,
    log: silentLog,
    onUpdate,
    perWebhookLimiter: options?.perWebhookLimiter,
    maxHookBodyBytes: options?.maxHookBodyBytes,
  });
  return { db, bot, config, app: built.app, drain: built.drain, updates, onUpdate };
}

/**
 * Ports `fetch` refuses to connect to, from the Fetch specification's blocked
 * list.
 *
 * Not theoretical: this workstation's dynamic port range starts low enough to
 * hand one of these out, and it did — once, as an unexplained «bad port»
 * failure in a test that passes on its own, which is exactly the shape of
 * flake that gets rerun until it is green and then believed. Listening again
 * is the whole fix.
 */
const BLOCKED_PORTS = new Set(
  (
    "1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109," +
    "110,111,113,115,117,119,123,135,137,138,139,143,161,179,389,427,465,512,513,514,515," +
    "526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049," +
    "3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080"
  )
    .split(",")
    .map(Number),
);

async function listenOnFreePort(app: Express) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    if (!BLOCKED_PORTS.has(port)) return { server, port };
    await new Promise((resolve) => server.close(resolve));
  }
  throw new Error("could not get a port fetch is willing to connect to");
}

async function withServer<T>(app: Express, fn: (base: string) => Promise<T>): Promise<T> {
  const { server, port } = await listenOnFreePort(app);
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function seed(
  db: FakeDb,
  input?: { ownerId?: string; chatId?: string; displayName?: string },
): Promise<{ webhook: Webhook; secret: string }> {
  const created = await createWebhook(db.db, {
    ownerId: input?.ownerId ?? "owner-1",
    chatId: input?.chatId ?? "chat-1",
    displayName: input?.displayName ?? "Grafana",
  });
  assert.ok(created, "seeding a webhook must succeed");
  return created;
}

// ---------------------------------------------------------------------------
// The secret itself
// ---------------------------------------------------------------------------

test("a stored secret is a salted KDF output, not a hash of the secret alone", async () => {
  const secret = mintSecret();
  const stored = await hashSecret(secret);
  assert.ok(stored.startsWith("scrypt$"), stored);
  assert.ok(!stored.includes(secret), "the secret itself must not be in the stored value");
  assert.ok(
    !stored.includes(createHash("sha256").update(secret).digest("base64url")),
    "a bare SHA-256 of the secret would make a rainbow table useful",
  );
  // Salted: the same secret hashed twice must not produce the same row value.
  assert.notEqual(stored, await hashSecret(secret));
  assert.equal(await verifySecret(secret, stored), true);
  assert.equal(await verifySecret(`${secret}x`, stored), false);
  assert.equal(await verifySecret(secret.slice(0, -1), stored), false);
  assert.equal(await verifySecret(secret, "not-a-hash"), false);
});

// ---------------------------------------------------------------------------
// POST /hook/:id
// ---------------------------------------------------------------------------

test("a delivery with the bearer secret reaches the owner's chat", async () => {
  const h = harness();
  const { webhook, secret } = await seed(h.db);
  await withServer(h.app, async (base) => {
    const response = await fetch(`${base}/hook/${webhook.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ title: "Сборка упала", status: "failed" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });
  assert.equal(h.bot.sent.length, 1);
  assert.equal(h.bot.sent[0]?.chatId, "chat-1");
  assert.ok(h.bot.sent[0]?.text.includes("Сборка упала"));
  assert.equal(h.db.rows[0]?.event_count, 1);
});

test("the dedicated header works for senders that cannot set Authorization", async () => {
  const h = harness();
  const { webhook, secret } = await seed(h.db);
  await withServer(h.app, async (base) => {
    const response = await fetch(`${base}/hook/${webhook.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-pocketflow-secret": secret },
      body: JSON.stringify({ message: "ok" }),
    });
    assert.equal(response.status, 200);
  });
  assert.equal(h.bot.sent.length, 1);
});

test("no credential, a wrong credential and a credential in the URL are all refused", async () => {
  const h = harness();
  const { webhook, secret } = await seed(h.db);
  await withServer(h.app, async (base) => {
    const none = await fetch(`${base}/hook/${webhook.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(none.status, 401);
    assert.match(none.headers.get("www-authenticate") ?? "", /Bearer/);

    const wrong = await fetch(`${base}/hook/${webhook.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${mintSecret()}` },
      body: "{}",
    });
    assert.equal(wrong.status, 401);

    // §5 asks for the header forms to be preferred over a secret in the URL.
    // This route does not accept one at all: a query string is written to
    // access logs by default, and a credential there leaks without anybody
    // making a mistake.
    const inUrl = await fetch(`${base}/hook/${webhook.id}?secret=${encodeURIComponent(secret)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(inUrl.status, 401);
  });
  assert.equal(h.bot.sent.length, 0, "nothing may be delivered without the secret");
});

test("an unknown id is a 404, and a malformed one never reaches the database", async () => {
  const h = harness();
  await withServer(h.app, async (base) => {
    const unknown = await fetch(`${base}/hook/${randomUUID()}`, {
      method: "POST",
      headers: { authorization: "Bearer whatever" },
      body: "{}",
    });
    assert.equal(unknown.status, 404);
    assert.ok(h.db.queries.length > 0, "a well-formed id is looked up");

    h.db.queries.length = 0;
    const malformed = await fetch(`${base}/hook/..%2Fadmin`, {
      method: "POST",
      headers: { authorization: "Bearer whatever" },
      body: "{}",
    });
    assert.equal(malformed.status, 404);
    assert.equal(h.db.queries.length, 0, "a malformed id must cost a regex, not a query");
  });
});

test("a disabled webhook answers 403, and only after the secret has been checked", async () => {
  const h = harness();
  const { webhook, secret } = await seed(h.db);
  h.db.rows[0]!.enabled = false;
  await withServer(h.app, async (base) => {
    const wrongSecret = await fetch(`${base}/hook/${webhook.id}`, {
      method: "POST",
      headers: { authorization: `Bearer ${mintSecret()}` },
      body: "{}",
    });
    // 401 rather than 403: whether a webhook is switched off is not a question
    // an unauthenticated caller gets an answer to.
    assert.equal(wrongSecret.status, 401);

    const rightSecret = await fetch(`${base}/hook/${webhook.id}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      body: "{}",
    });
    assert.equal(rightSecret.status, 403);
  });
  assert.equal(h.bot.sent.length, 0);
});

test("a body over the cap is refused rather than truncated", async () => {
  const h = harness({ maxHookBodyBytes: 512 });
  const { webhook, secret } = await seed(h.db);
  await withServer(h.app, async (base) => {
    const response = await fetch(`${base}/hook/${webhook.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ message: "x".repeat(2000) }),
    });
    assert.equal(response.status, 413);
  });
  assert.equal(h.bot.sent.length, 0);
});

test("the byte counter, not the declared length, is what enforces the cap", async () => {
  // A chunked request has no Content-Length to check, and a lying one is
  // trivial to send — so the bound has to hold while the body is arriving.
  const lying = Object.assign(Readable.from([Buffer.alloc(600), Buffer.alloc(600)]), {
    headers: { "content-length": "12" },
  }) as unknown as IncomingMessage;
  assert.deepEqual(await readBoundedBody(lying, 1000), { ok: false, reason: "too_large" });

  const honest = Object.assign(Readable.from([Buffer.from("ab"), Buffer.from("cd")]), {
    headers: {},
  }) as unknown as IncomingMessage;
  const result = await readBoundedBody(honest, 1000);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.bytes.toString("utf8"), "abcd");
});

test("a repeated Idempotency-Key is answered, not delivered twice", async () => {
  const h = harness();
  const { webhook, secret } = await seed(h.db);
  await withServer(h.app, async (base) => {
    const send = () =>
      fetch(`${base}/hook/${webhook.id}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret}`,
          "idempotency-key": "delivery-7",
        },
        body: JSON.stringify({ title: "once" }),
      });
    assert.equal((await send()).status, 200);
    const second = await send();
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { ok: true, duplicate: true });
  });
  assert.equal(h.bot.sent.length, 1);
  assert.equal(h.db.rows[0]?.event_count, 1);
});

test("a failed delivery answers 502 and releases the key so the retry gets through", async () => {
  const h = harness();
  const { webhook, secret } = await seed(h.db);
  h.bot.failSend = true;
  await withServer(h.app, async (base) => {
    const send = () =>
      fetch(`${base}/hook/${webhook.id}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret}`,
          "idempotency-key": "delivery-8",
        },
        body: JSON.stringify({ title: "retry me" }),
      });
    const failed = await send();
    assert.equal(failed.status, 502);
    assert.equal(h.db.events.size, 0, "the claim must be released, or the retry is swallowed");

    h.bot.failSend = false;
    const retried = await send();
    assert.equal(retried.status, 200);
  });
  assert.equal(h.bot.sent.length, 1);
});

test("the rate limiter answers 429 with Retry-After before touching the database", async () => {
  const limiter = createRateLimiter({ capacity: 1, refillPerMinute: 1 });
  const h = harness({ perWebhookLimiter: limiter });
  const { webhook, secret } = await seed(h.db);
  await withServer(h.app, async (base) => {
    const send = () =>
      fetch(`${base}/hook/${webhook.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify({ title: "flood" }),
      });
    assert.equal((await send()).status, 200);
    const queriesBefore = h.db.queries.length;
    const limited = await send();
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
    assert.equal(
      h.db.queries.length,
      queriesBefore,
      "a throttled delivery must cost neither a query nor a key derivation",
    );
  });
  assert.equal(h.bot.sent.length, 1);
});

test("a plain text body from a shell script is delivered as itself", async () => {
  const h = harness();
  const { webhook, secret } = await seed(h.db);
  await withServer(h.app, async (base) => {
    const response = await fetch(`${base}/hook/${webhook.id}`, {
      method: "POST",
      headers: { "content-type": "text/plain", authorization: `Bearer ${secret}` },
      body: "диск заполнен на 95%",
    });
    assert.equal(response.status, 200);
  });
  assert.ok(h.bot.sent[0]?.text.includes("диск заполнен на 95%"));
});

test("a body that claims to be JSON and is not is a 400", async () => {
  const h = harness();
  const { webhook, secret } = await seed(h.db);
  await withServer(h.app, async (base) => {
    const broken = await fetch(`${base}/hook/${webhook.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: "{oops",
    });
    assert.equal(broken.status, 400);

    const empty = await fetch(`${base}/hook/${webhook.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: "   ",
    });
    assert.equal(empty.status, 400);
  });
  assert.equal(h.bot.sent.length, 0);
});

test("GET on a webhook address says POST instead of 404", async () => {
  const h = harness();
  const { webhook } = await seed(h.db);
  await withServer(h.app, async (base) => {
    const response = await fetch(`${base}/hook/${webhook.id}`);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
  });
});

test("healthz answers without touching the database", async () => {
  const h = harness();
  await withServer(h.app, async (base) => {
    const response = await fetch(`${base}/healthz`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(body.transport, "webhook");
  });
  assert.equal(h.db.queries.length, 0);
});

// ---------------------------------------------------------------------------
// POST /bot/updates
// ---------------------------------------------------------------------------

/**
 * The deadline and the `finally` are not decoration.
 *
 * This is the one test that deliberately holds a handler open, so it is the
 * one test that can hang the whole file if the route ever awaits the handler
 * inside the request — which is exactly the regression it exists to catch. A
 * hang reports as a CI timeout with no failing assertion and reads as flaky
 * infrastructure; the abort turns the same bug into a named failure in five
 * seconds. (Measured: with that regression applied on purpose, this file used
 * to run for ever. It now fails.)
 */
test("an update is acknowledged before its handler runs", { timeout: 15_000 }, async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finished = false;
  const h = harness({
    onUpdate: async () => {
      await gate;
      finished = true;
    },
  });
  try {
    await withServer(h.app, async (base) => {
      const response = await fetch(`${base}/bot/updates`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [LETSCUBE_WEBHOOK_SECRET_HEADER]: h.config.webhookSecret ?? "",
        },
        body: JSON.stringify({
          update_id: 5,
          message: { id: "m1", chat: { id: "c1" }, text: "hi" },
        }),
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(response.status, 200);
      // The whole contract: the platform has its answer while the work is
      // still outstanding. A handler that ran inside the request would make
      // this true only by accident of timing.
      assert.equal(finished, false, "the handler must not run inside the request");
      release();
      await h.drain();
      assert.equal(finished, true, "drain must wait for the accepted update");
    });
  } finally {
    // Nothing may be left waiting on this gate, whatever went wrong above.
    release();
  }
});

test("an update without the shared secret is refused and never reaches the handler", async () => {
  const h = harness();
  await withServer(h.app, async (base) => {
    const missing = await fetch(`${base}/bot/updates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ update_id: 1 }),
    });
    assert.equal(missing.status, 401);

    const wrong = await fetch(`${base}/bot/updates`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [LETSCUBE_WEBHOOK_SECRET_HEADER]: "test-webhook-secret-0123456780",
      },
      body: JSON.stringify({ update_id: 1 }),
    });
    assert.equal(wrong.status, 401);

    // A secret that is a prefix of the real one must not be accepted either.
    const prefix = await fetch(`${base}/bot/updates`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [LETSCUBE_WEBHOOK_SECRET_HEADER]: (h.config.webhookSecret ?? "").slice(0, 10),
      },
      body: JSON.stringify({ update_id: 1 }),
    });
    assert.equal(prefix.status, 401);
  });
  await h.drain();
  assert.equal(h.updates.length, 0);
});

test("a malformed update body is a 400, and an unreadable one is still delivered as unsupported", async () => {
  const h = harness();
  await withServer(h.app, async (base) => {
    const broken = await fetch(`${base}/bot/updates`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [LETSCUBE_WEBHOOK_SECRET_HEADER]: h.config.webhookSecret ?? "",
      },
      body: "{not json",
    });
    assert.equal(broken.status, 400);

    // An update type this adapter does not know must not crash the bot; the
    // transport turns it into `unsupported` and the handler still sees it.
    const unknown = await fetch(`${base}/bot/updates`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [LETSCUBE_WEBHOOK_SECRET_HEADER]: h.config.webhookSecret ?? "",
      },
      body: JSON.stringify({ update_id: 9, reaction: { emoji: "👍" } }),
    });
    assert.equal(unknown.status, 200);
  });
  await h.drain();
  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0]?.kind, "unsupported");
});

test("under polling the update route does not exist at all", async () => {
  const h = harness({
    configOverrides: { TRANSPORT: "polling", WEBHOOK_SECRET: undefined },
  });
  await withServer(h.app, async (base) => {
    const response = await fetch(`${base}/bot/updates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ update_id: 1 }),
    });
    assert.equal(response.status, 404);
  });
});

// ---------------------------------------------------------------------------
// The management surface: callback_data is never authorization
// ---------------------------------------------------------------------------

function callbackUpdate(input: {
  updateId: number;
  data: string;
  userId: string;
  chatId?: string;
}): Update {
  return {
    updateId: input.updateId,
    kind: "callback_query",
    callbackQuery: {
      id: `cb-${input.updateId}`,
      from: { id: input.userId, isBot: false, displayName: "Кто-то", username: null },
      data: input.data,
      message: { id: "m1", chatId: input.chatId ?? "chat-1" },
    },
  } as Update;
}

function appContext(h: Harness) {
  return {
    config: h.config,
    db: h.db.db,
    bot: h.bot.bot,
    log: silentLog,
    now: () => new Date(),
    botUsername: "pocketflow",
  };
}

test("a stranger pressing Delete changes nothing and is told so", async () => {
  const h = harness();
  const { webhook } = await seed(h.db);
  const router = createRouter([webhooksFeature()]);

  h.db.queries.length = 0;
  await router.handle(
    appContext(h) as never,
    callbackUpdate({ updateId: 101, data: `whdelok:${webhook.id}`, userId: "intruder" }),
  );

  assert.equal(h.db.rows.length, 1, "the row must still be there");
  assert.deepEqual(
    h.db.webhookWrites(),
    [],
    "the handler must refuse before it issues any statement that could change a webhook",
  );
  assert.equal(h.bot.answers.at(-1)?.text, "Это не ваш webhook");
  assert.equal(h.bot.sent.length, 0, "and the stranger learns nothing about it");
});

test("a stranger pressing Rotate gets no secret", async () => {
  const h = harness();
  const { webhook, secret } = await seed(h.db);
  const router = createRouter([webhooksFeature()]);
  const hashBefore = h.db.rows[0]?.secret_hash;

  h.db.queries.length = 0;
  await router.handle(
    appContext(h) as never,
    callbackUpdate({ updateId: 102, data: `whrot:${webhook.id}`, userId: "intruder" }),
  );

  assert.equal(h.db.rows[0]?.secret_hash, hashBefore, "the secret must not have been rotated");
  assert.deepEqual(h.db.webhookWrites(), []);
  assert.equal(h.bot.sent.length, 0);
  assert.equal(await verifySecret(secret, h.db.rows[0]?.secret_hash ?? ""), true);
});

test("a stranger pressing Show is not shown somebody else's webhook", async () => {
  const h = harness();
  const { webhook } = await seed(h.db, { displayName: "Секретный монитор" });
  const router = createRouter([webhooksFeature()]);

  await router.handle(
    appContext(h) as never,
    callbackUpdate({ updateId: 103, data: `whshow:${webhook.id}`, userId: "intruder" }),
  );

  assert.equal(h.bot.sent.length, 0);
  assert.ok(
    !h.bot.sent.some((message) => message.text.includes("Секретный монитор")),
    "not even the name may leak",
  );
});

test("the owner rotates: the new secret is shown once and the old one stops working", async () => {
  const h = harness();
  const { webhook, secret } = await seed(h.db);
  const router = createRouter([webhooksFeature()]);

  await router.handle(
    appContext(h) as never,
    callbackUpdate({ updateId: 104, data: `whrot:${webhook.id}`, userId: "owner-1" }),
  );

  const shown = h.bot.sent.at(-1)?.text ?? "";
  const match = /pfwh_[A-Za-z0-9_-]+/.exec(shown);
  assert.ok(match, `the rotation message must contain the new secret: ${shown}`);
  const rotated = match[0];
  assert.notEqual(rotated, secret);
  assert.equal(await verifySecret(rotated, h.db.rows[0]?.secret_hash ?? ""), true);
  assert.equal(await verifySecret(secret, h.db.rows[0]?.secret_hash ?? ""), false);

  // And the list, which is the screen a person sees next, contains no secret.
  h.bot.sent.length = 0;
  await router.handle(
    appContext(h) as never,
    callbackUpdate({ updateId: 105, data: "whlist", userId: "owner-1" }),
  );
  assert.ok(!(h.bot.sent.at(-1)?.text ?? "").includes(rotated));
  assert.ok(!(h.bot.sent.at(-1)?.text ?? "").includes("pfwh_"));
});

test("creating: the name is asked for, the secret is shown once, and the hook works", async () => {
  const h = harness();
  const router = createRouter([webhooksFeature()]);
  const ctx = appContext(h) as never;

  await router.handle(ctx, callbackUpdate({ updateId: 106, data: "whnew", userId: "owner-1" }));
  assert.equal(h.db.prompts.size, 1, "the bot must be waiting for a name");

  await router.handle(ctx, {
    updateId: 107,
    kind: "message",
    message: {
      id: "m2",
      chat: { id: "chat-1", kind: "private", title: null },
      from: { id: "owner-1", isBot: false, displayName: "Владелец", username: null },
      date: new Date(),
      text: "  Grafana  ",
      replyToMessageId: null,
      topicId: null,
      attachment: null,
    },
  } as Update);

  assert.equal(h.db.rows.length, 1);
  assert.equal(h.db.rows[0]?.display_name, "Grafana");
  const shown = h.bot.sent.at(-1)?.text ?? "";
  const secret = /pfwh_[A-Za-z0-9_-]+/.exec(shown)?.[0];
  assert.ok(secret, shown);
  assert.ok(shown.includes("curl"), "the reply has to be usable, not just correct");
  assert.equal(await verifySecret(secret, h.db.rows[0]?.secret_hash ?? ""), true);
  assert.equal(h.db.prompts.size, 0, "the prompt is consumed");
});

test("another feature's pending question is not eaten", async () => {
  const h = harness();
  const feature = webhooksFeature();
  h.db.prompts.set("chat-1\u0000owner-1", {
    chat_id: "chat-1",
    user_id: "owner-1",
    kind: "reminder_when",
    context: {},
    expires_at: new Date(Date.now() + 60_000),
  });

  const taken = await feature.onMessage?.(
    {
      ctx: appContext(h) as never,
      message: {
        id: "m3",
        chat: { id: "chat-1", kind: "private", title: null },
        from: { id: "owner-1", isBot: false, displayName: "Владелец", username: null },
        date: new Date(),
        text: "завтра в 9",
        replyToMessageId: null,
        topicId: null,
        attachment: null,
      },
      user: {
        userId: "owner-1",
        displayName: "Владелец",
        username: null,
        timeZone: "Europe/Moscow",
        developerMode: false,
      },
      isGroup: false,
    } as never,
    { kind: "text" } as never,
  );

  assert.equal(taken, false, "this feature must not claim a message it was not waiting for");
  assert.equal(h.db.prompts.size, 1, "and must not consume another feature's prompt row");
});

test("the per-owner limit is enforced", async () => {
  const h = harness();
  for (let index = 0; index < 20; index += 1) {
    await seed(h.db, { displayName: `hook-${index}` });
  }
  const extra = await createWebhook(h.db.db, {
    ownerId: "owner-1",
    chatId: "chat-1",
    displayName: "one too many",
  });
  assert.equal(extra, null);
  assert.equal(h.db.rows.length, 20);
});
