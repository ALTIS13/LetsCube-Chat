import assert from "node:assert/strict";
import test from "node:test";

import type { AppContext } from "../../artifacts/pocketflow/src/app/context.ts";
import { parseCallbackData } from "../../artifacts/pocketflow/src/app/context.ts";
import type {
  CallbackContext,
  CommandContext,
} from "../../artifacts/pocketflow/src/app/router.ts";
import {
  FAILURE_NOTICE_AT,
  backoffSeconds,
  createWatcherFeature,
  decideTransition,
  firstFeedEntry,
  lastAvailability,
  nextRowState,
  normalizeContent,
  performCheck,
  renderTransition,
  sha256,
  watcherTick,
  type Check,
  type SafeFetcher,
} from "../../artifacts/pocketflow/src/app/watcher.ts";
import type { SafeFetchResult } from "../../artifacts/pocketflow/src/lib/safeFetch.ts";
import { SafeFetchError } from "../../artifacts/pocketflow/src/lib/safeFetch.ts";
import type { DnsResolver } from "../../artifacts/pocketflow/src/lib/ssrf.ts";
import type { Db } from "../../artifacts/pocketflow/src/store/db.ts";
import {
  countWatchers,
  deleteWatcher,
  listWatchers,
  readOwnedWatcher,
  scheduleWatcherNow,
  setWatcherEnabled,
  toWatcher,
  type Watcher,
} from "../../artifacts/pocketflow/src/store/watchers.ts";
import type { PocketFlowUser } from "../../artifacts/pocketflow/src/store/users.ts";
import type { BotTransport } from "../../artifacts/pocketflow/src/transport/types.ts";

/**
 * The watcher, without a database, a gateway or the network.
 *
 * The fake `Db` below is the load-bearing part of this file and is written to
 * be **generic rather than scripted**: it reads the `col = $n` pairs out of
 * whatever WHERE clause it is handed and filters on all of them. That is the
 * difference between a test that proves ownership is enforced and a test that
 * merely records that a query was sent. If a handler ever issues a read or a
 * write without `owner_id` in its WHERE, this fake will happily return the
 * other person's row and the assertions below go red — which is the only way
 * «callback_data is not authorization» can be a fact instead of a comment.
 */

// ---------------------------------------------------------------------------
// A small SQL engine, honest about the clauses it is given
// ---------------------------------------------------------------------------

const WHITESPACE = new Set([32, 9, 10, 13, 12, 11]);

function squash(sql: string): string {
  const parts: string[] = [];
  let current = "";
  for (let index = 0; index < sql.length; index += 1) {
    if (WHITESPACE.has(sql.charCodeAt(index))) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += sql[index];
  }
  if (current.length > 0) parts.push(current);
  return parts.join(" ").toLowerCase();
}

type FakeRow = Record<string, unknown>;

const TABLES = ["pf_watchers", "pf_inbox_candidates", "pf_users"] as const;

function isIdentifier(text: string): boolean {
  if (text.length === 0) return false;
  for (const character of text) {
    const ok =
      (character >= "a" && character <= "z") || (character >= "0" && character <= "9") || character === "_";
    if (!ok) return false;
  }
  return true;
}

type Where = { filters: [string, number][]; expiresAfterNow: boolean };

function parseWhere(sql: string): Where {
  const at = sql.indexOf(" where ");
  if (at === -1) return { filters: [], expiresAfterNow: false };
  let tail = sql.slice(at + " where ".length);
  for (const stop of [" order by ", " limit ", " returning ", " group by "]) {
    const stopAt = tail.indexOf(stop);
    if (stopAt !== -1) tail = tail.slice(0, stopAt);
  }
  const filters: [string, number][] = [];
  let expiresAfterNow = false;
  for (const part of tail.split(" and ")) {
    const clause = part.trim();
    if (clause.startsWith("expires_at > now()")) {
      expiresAfterNow = true;
      continue;
    }
    const equals = clause.indexOf(" = ");
    if (equals === -1) continue;
    const column = clause.slice(0, equals).trim();
    const right = clause.slice(equals + 3).trim();
    if (!isIdentifier(column) || !right.startsWith("$")) continue;
    const index = Number.parseInt(right.slice(1), 10);
    if (Number.isInteger(index)) filters.push([column, index]);
  }
  return { filters, expiresAfterNow };
}

function literal(token: string, values: readonly unknown[], now: Date): unknown {
  const text = token.trim();
  if (text.startsWith("$")) return values[Number.parseInt(text.slice(1), 10) - 1] ?? null;
  if (text.startsWith("now()")) {
    if (text.includes("minutes")) return new Date(now.getTime() + 120 * 60_000);
    return new Date(now.getTime());
  }
  if (text === "null") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  const asNumber = Number(text);
  return Number.isFinite(asNumber) ? asNumber : text;
}

export type FakeDb = Db & {
  rows: Record<string, FakeRow[]>;
  log: { text: string; values: unknown[] }[];
};

let idCounter = 0;
function newId(): string {
  idCounter += 1;
  const tail = String(idCounter).padStart(12, "0");
  return `00000000-0000-4000-8000-${tail}`;
}

const WATCHER_DEFAULTS: FakeRow = {
  enabled: true,
  interval_seconds: 300,
  last_status: null,
  last_content_hash: null,
  last_checked_at: null,
  last_error: null,
  consecutive_failures: 0,
  claimed_at: null,
  claim_token: null,
};

function createFakeDb(now: Date, seed?: Partial<Record<string, FakeRow[]>>): FakeDb {
  const rows: Record<string, FakeRow[]> = {
    pf_watchers: [],
    pf_inbox_candidates: [],
    pf_users: [],
    ...seed,
  };
  const log: { text: string; values: unknown[] }[] = [];

  function tableOf(sql: string): string {
    for (const name of TABLES) if (sql.includes(name)) return name;
    throw new Error(`fake db: unknown table in ${sql}`);
  }

  function matches(row: FakeRow, where: Where, values: readonly unknown[]): boolean {
    for (const [column, index] of where.filters) {
      const expected = values[index - 1];
      const actual = row[column];
      if (actual instanceof Date && expected instanceof Date) {
        if (actual.getTime() !== expected.getTime()) return false;
        continue;
      }
      if (String(actual) !== String(expected)) return false;
    }
    if (where.expiresAfterNow) {
      const expires = row.expires_at;
      if (!(expires instanceof Date) || expires.getTime() <= now.getTime()) return false;
    }
    return true;
  }

  async function run(text: string, values: readonly unknown[]): Promise<{ rows: FakeRow[]; rowCount: number }> {
    const sql = squash(text);
    log.push({ text: sql, values: [...values] });
    const table = tableOf(sql);
    const store = rows[table] as FakeRow[];

    if (sql.startsWith("insert")) {
      const open = sql.indexOf("(");
      const close = sql.indexOf(")", open);
      const columns = sql.slice(open + 1, close).split(",").map((name) => name.trim());
      const valuesAt = sql.indexOf("values (");
      const valuesEnd = sql.indexOf(") returning", valuesAt);
      const tokens = sql
        .slice(valuesAt + "values (".length, valuesEnd === -1 ? sql.length : valuesEnd)
        .split(", ");
      const row: FakeRow = {
        ...(table === "pf_watchers" ? WATCHER_DEFAULTS : {}),
        id: newId(),
        created_at: new Date(now.getTime()),
      };
      columns.forEach((column, index) => {
        row[column] = literal(tokens[index] ?? "null", values, now);
      });
      store.push(row);
      return { rows: [row], rowCount: 1 };
    }

    const where = parseWhere(sql);

    if (sql.startsWith("select")) {
      let selected = store.filter((row) => matches(row, where, values));
      if (sql.includes("count(*)")) {
        return { rows: [{ count: String(selected.length) }], rowCount: 1 };
      }
      const orderAt = sql.indexOf(" order by ");
      if (orderAt !== -1) {
        const column = (sql.slice(orderAt + " order by ".length).split(" ")[0] ?? "").trim();
        selected = [...selected].sort((left, right) =>
          String(left[column]) < String(right[column]) ? -1 : 1,
        );
      }
      const limitAt = sql.indexOf(" limit $");
      if (limitAt !== -1) {
        const index = Number.parseInt(sql.slice(limitAt + " limit $".length), 10);
        selected = selected.slice(0, Number(values[index - 1]));
      }
      return { rows: selected, rowCount: selected.length };
    }

    if (sql.startsWith("delete")) {
      const doomed = store.filter((row) => matches(row, where, values));
      for (const row of doomed) store.splice(store.indexOf(row), 1);
      return { rows: doomed, rowCount: doomed.length };
    }

    if (sql.startsWith("update")) {
      // The scheduler's claim: a subselect with `for update skip locked`, which
      // the generic WHERE parser cannot read. Handled explicitly.
      let affected: FakeRow[];
      if (sql.includes("skip locked")) {
        const at = values[0] as Date;
        const leaseSeconds = Number(values[2]);
        const limit = Number(values[3]);
        affected = store
          .filter((row) => {
            if (row.enabled !== true) return false;
            const next = row.next_check_at as Date;
            if (!(next instanceof Date) || next.getTime() > at.getTime()) return false;
            const claimed = row.claimed_at;
            if (claimed instanceof Date && claimed.getTime() >= at.getTime() - leaseSeconds * 1_000) {
              return false;
            }
            return true;
          })
          .sort((left, right) =>
            (left.next_check_at as Date).getTime() - (right.next_check_at as Date).getTime(),
          )
          .slice(0, limit);
      } else {
        affected = store.filter((row) => matches(row, where, values));
      }
      const setAt = sql.indexOf(" set ");
      const whereAt = sql.indexOf(" where ");
      const assignments = sql.slice(setAt + " set ".length, whereAt).split(", ");
      for (const row of affected) {
        for (const assignment of assignments) {
          const equals = assignment.indexOf(" = ");
          if (equals === -1) continue;
          const column = assignment.slice(0, equals).trim();
          if (!isIdentifier(column)) continue;
          row[column] = literal(assignment.slice(equals + 3), values, now);
        }
      }
      return { rows: affected, rowCount: affected.length };
    }

    throw new Error(`fake db: unsupported statement ${sql}`);
  }

  const db = {
    rows,
    log,
    async query(text: string, values?: readonly unknown[]) {
      const result = await run(text, values ?? []);
      return { rows: result.rows, rowCount: result.rowCount } as never;
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return fn(db as unknown as Db);
    },
    async close() {},
  };
  return db as unknown as FakeDb;
}

// ---------------------------------------------------------------------------
// The rest of the world
// ---------------------------------------------------------------------------

type BotCall = { method: string; args: Record<string, unknown> };

function createFakeBot(options?: { sendTextThrows?: boolean }): BotTransport & { calls: BotCall[] } {
  const calls: BotCall[] = [];
  return {
    calls,
    platform: "fake",
    supports: () => true,
    getMe: async () => ({ id: "bot", username: "pf", displayName: "PF" }),
    sendText: async (input) => {
      calls.push({ method: "sendText", args: { ...input } });
      if (options?.sendTextThrows) throw new Error("chat_not_found");
      return { id: "sent-1", chatId: input.chatId, date: null };
    },
    editText: async (input) => {
      calls.push({ method: "editText", args: { ...input } });
    },
    deleteMessage: async () => {},
    sendChatAction: async () => {},
    answerCallbackQuery: async (id, input) => {
      calls.push({ method: "answerCallbackQuery", args: { id, ...input } });
    },
    getFile: async () => {
      throw new Error("unsupported");
    },
    setMyCommands: async () => {},
    getMyCommands: async () => [],
    getUpdates: async () => [],
    setWebhook: async () => {},
    deleteWebhook: async () => {},
    getWebhookInfo: async () => ({
      configured: false,
      pendingUpdateCount: 0,
      failureCount: 0,
      lastErrorCode: null,
    }),
    parseWebhookUpdate: () => ({ updateId: 0, kind: "unsupported", rawType: "x", raw: null }),
  } as unknown as BotTransport & { calls: BotCall[] };
}

const NOW = new Date("2026-09-19T15:42:00.000Z");

function createContext(db: FakeDb, bot: BotTransport, now = NOW): AppContext {
  return {
    config: {
      defaultTimeZone: "Europe/Moscow",
      developerIds: new Set<string>(),
    } as AppContext["config"],
    db: db as unknown as Db,
    bot,
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      with: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, with: () => null as never }),
    } as unknown as AppContext["log"],
    now: () => now,
  };
}

function createUser(userId: string): PocketFlowUser {
  return {
    userId,
    displayName: userId,
    username: null,
    timeZone: "Europe/Moscow",
    developerMode: false,
  };
}

function callbackContext(
  ctx: AppContext,
  userId: string,
  data: string,
): CallbackContext {
  const { args } = parseCallbackData(data);
  return {
    ctx,
    query: {
      id: "cb-1",
      from: { id: userId, isBot: false, displayName: userId, username: null },
      data,
      message: { id: "bot-message-1", chatId: "chat-1" },
    },
    user: createUser(userId),
    args,
  };
}

function commandContext(ctx: AppContext, userId: string, args: string): CommandContext {
  return {
    ctx,
    message: {
      id: "user-message-1",
      chat: { id: "chat-1", kind: "private", title: null },
      from: { id: userId, isBot: false, displayName: userId, username: null },
      date: NOW,
      text: `/watch ${args}`,
      replyToMessageId: null,
      topicId: null,
      attachment: null,
    },
    user: createUser(userId),
    isGroup: false,
    command: "watch",
    args,
  };
}

const PUBLIC_V4 = "93.184.216.34";
const publicResolver: DnsResolver = async () => [{ address: PUBLIC_V4, family: 4 }];
const loopbackResolver: DnsResolver = async () => [{ address: "127.0.0.1", family: 4 }];

function fetcherReturning(
  response: Partial<SafeFetchResult> & { status: number },
): SafeFetcher {
  return async () => ({
    finalUrl: "https://example.com/",
    headers: {},
    body: Buffer.alloc(0),
    truncated: false,
    redirects: 0,
    address: PUBLIC_V4,
    elapsedMs: 5,
    ...response,
  });
}

function seedWatcher(overrides: FakeRow): FakeRow {
  return {
    ...WATCHER_DEFAULTS,
    id: newId(),
    owner_id: "user-a",
    chat_id: "chat-1",
    kind: "availability",
    url: "https://example.com/status",
    next_check_at: new Date(NOW.getTime() - 1_000),
    created_at: new Date(NOW.getTime() - 60_000),
    ...overrides,
  };
}

function watcherFrom(row: FakeRow): Watcher {
  return toWatcher(row as never);
}

// ---------------------------------------------------------------------------
// callback_data is not authorization
// ---------------------------------------------------------------------------

const MUTATING_ACTIONS = ["watch.open", "watch.toggle", "watch.check", "watch.delete"] as const;

test("a button pressed by somebody else changes nothing, for every action", async () => {
  for (const action of MUTATING_ACTIONS) {
    const row = seedWatcher({ enabled: true });
    const db = createFakeDb(NOW, { pf_watchers: [row] });
    const bot = createFakeBot();
    const ctx = createContext(db, bot);
    const feature = createWatcherFeature({ resolver: publicResolver });

    const before = JSON.stringify(db.rows.pf_watchers);
    db.log.length = 0;

    // user-b presses a button whose data names user-a's watcher. The id is
    // real and correct; the only thing wrong is who pressed it.
    await feature.callbacks?.[action]?.(callbackContext(ctx, "user-b", `${action}:${row.id}`));

    assert.equal(
      JSON.stringify(db.rows.pf_watchers),
      before,
      `${action} must not touch the row`,
    );
    const answers = bot.calls.filter((call) => call.method === "answerCallbackQuery");
    assert.equal(answers.length, 1, `${action} must answer the query exactly once`);
    assert.equal(answers[0]?.args.text, "Это не ваш наблюдатель", action);
    // Nothing was shown either: no card, no list, no message.
    assert.equal(bot.calls.filter((call) => call.method !== "answerCallbackQuery").length, 0, action);

    // And the generic check: every statement this press issued against
    // pf_watchers was scoped by owner. A future handler that forgets it fails
    // here even if it somehow produced the same visible outcome.
    for (const entry of db.log) {
      if (!entry.text.includes("pf_watchers")) continue;
      assert.ok(
        entry.text.includes("owner_id = $"),
        `${action} issued an unscoped statement: ${entry.text}`,
      );
    }
  }
});

test("the same presses by the owner do work, or the test above proves nothing", async () => {
  const row = seedWatcher({ enabled: true });
  const db = createFakeDb(NOW, { pf_watchers: [row] });
  const bot = createFakeBot();
  const ctx = createContext(db, bot);
  const feature = createWatcherFeature({ resolver: publicResolver });

  await feature.callbacks?.["watch.open"]?.(
    callbackContext(ctx, "user-a", `watch.open:${row.id}`),
  );
  assert.equal(bot.calls.filter((call) => call.method === "editText").length, 1);

  await feature.callbacks?.["watch.toggle"]?.(
    callbackContext(ctx, "user-a", `watch.toggle:${row.id}`),
  );
  assert.equal(db.rows.pf_watchers[0]?.enabled, false, "the owner can turn it off");

  await feature.callbacks?.["watch.delete"]?.(
    callbackContext(ctx, "user-a", `watch.delete:${row.id}`),
  );
  assert.equal(db.rows.pf_watchers.length, 0, "the owner can delete it");
});

test("the store itself refuses another owner, so the handler is not the only guard", async () => {
  // The handlers re-read before they write, so an unscoped write would be
  // masked by the read in front of it. Measured here directly instead.
  const row = seedWatcher({ owner_id: "user-a", enabled: true });
  const db = createFakeDb(NOW, { pf_watchers: [row] });
  const id = String(row.id);

  assert.equal(await readOwnedWatcher(db, "user-b", id), null);
  assert.equal(await setWatcherEnabled(db, "user-b", id, false), null);
  assert.equal(db.rows.pf_watchers[0]?.enabled, true, "an unscoped update would have flipped it");
  assert.equal(await scheduleWatcherNow(db, "user-b", id), null);
  assert.equal(await deleteWatcher(db, "user-b", id), false);
  assert.equal(db.rows.pf_watchers.length, 1);
  assert.deepEqual(await listWatchers(db, "user-b"), []);
  assert.equal(await countWatchers(db, "user-b"), 0);

  // The owner can do every one of them, or the above is just "refuses always".
  assert.ok(await readOwnedWatcher(db, "user-a", id));
  assert.ok(await setWatcherEnabled(db, "user-a", id, false));
  assert.equal(db.rows.pf_watchers[0]?.enabled, false);
  assert.ok(await scheduleWatcherNow(db, "user-a", id));
  assert.equal((await listWatchers(db, "user-a")).length, 1);
  assert.equal(await countWatchers(db, "user-a"), 1);
  assert.equal(await deleteWatcher(db, "user-a", id), true);
  assert.equal(db.rows.pf_watchers.length, 0);
});

test("a callback id that is not a uuid never reaches the database", async () => {
  const row = seedWatcher({});
  const db = createFakeDb(NOW, { pf_watchers: [row] });
  const bot = createFakeBot();
  const ctx = createContext(db, bot);
  const feature = createWatcherFeature({ resolver: publicResolver });

  for (const forged of [
    "",
    "1",
    "../../etc/passwd",
    "' or 1=1 --",
    "00000000-0000-4000-8000-00000000000",
    "zzzzzzzz-0000-4000-8000-000000000001",
  ]) {
    db.log.length = 0;
    await feature.callbacks?.["watch.toggle"]?.(
      callbackContext(ctx, "user-a", `watch.toggle:${forged}`),
    );
    assert.equal(
      db.log.filter((entry) => entry.text.includes("pf_watchers")).length,
      0,
      `a malformed id must be refused before the query: ${forged}`,
    );
  }
  assert.equal(db.rows.pf_watchers.length, 1);
});

test("no value is ever interpolated into a statement", async () => {
  const secret = "https://example.com/status?token=super-secret-value";
  const row = seedWatcher({ url: secret });
  const db = createFakeDb(NOW, { pf_watchers: [row] });
  const bot = createFakeBot();
  const ctx = createContext(db, bot);
  const feature = createWatcherFeature({ resolver: publicResolver });

  await feature.callbacks?.["watch.open"]?.(callbackContext(ctx, "user-a", `watch.open:${row.id}`));
  await feature.callbacks?.["watch.list"]?.(callbackContext(ctx, "user-a", "watch.list"));
  await feature.callbacks?.["watch.toggle"]?.(
    callbackContext(ctx, "user-a", `watch.toggle:${row.id}`),
  );

  assert.ok(db.log.length > 0);
  for (const entry of db.log) {
    assert.ok(!entry.text.includes("super-secret-value"), entry.text);
    assert.ok(!entry.text.includes("user-a"), entry.text);
    assert.ok(!entry.text.includes(String(row.id)), entry.text);
  }
});

// ---------------------------------------------------------------------------
// The inbox contracts
// ---------------------------------------------------------------------------

function seedCandidate(overrides: FakeRow): FakeRow {
  return {
    id: newId(),
    owner_id: "user-a",
    chat_id: "chat-1",
    source_message_id: "user-message-1",
    kind: "url",
    content: "https://example.com/status",
    file_id: null,
    created_at: new Date(NOW.getTime()),
    expires_at: new Date(NOW.getTime() + 60 * 60_000),
    ...overrides,
  };
}

test("watch.from offers the four kinds, carrying the candidate id forward", async () => {
  const candidate = seedCandidate({});
  const db = createFakeDb(NOW, { pf_inbox_candidates: [candidate] });
  const bot = createFakeBot();
  const ctx = createContext(db, bot);
  const feature = createWatcherFeature({ resolver: publicResolver });

  await feature.callbacks?.["watch.from"]?.(
    callbackContext(ctx, "user-a", `watch.from:${candidate.id}`),
  );

  const edit = bot.calls.find((call) => call.method === "editText");
  assert.ok(edit, "the offer is edited into the bot's own message, not sent again");
  const rows = (edit.args.keyboard as { rows: { callbackData?: string }[][] }).rows;
  const datas = rows.flat().map((entry) => entry.callbackData ?? "");
  assert.equal(datas.length, 4, "four kinds");
  for (const data of datas) {
    const parsed = parseCallbackData(data);
    assert.equal(parsed.action, "watch.kind");
    assert.equal(parsed.args[0], candidate.id);
    assert.ok(Buffer.byteLength(data, "utf8") <= 128, "callback_data must fit the platform cap");
  }
  assert.deepEqual([...new Set(datas.map((data) => parseCallbackData(data).args[1]))].sort(), [
    "a",
    "c",
    "f",
    "s",
  ]);
  // No watcher yet: the kind has not been chosen.
  assert.equal(db.rows.pf_watchers.length, 0);
});

test("watch.from pressed by somebody else creates nothing and says so", async () => {
  const candidate = seedCandidate({ owner_id: "user-a" });
  const db = createFakeDb(NOW, { pf_inbox_candidates: [candidate] });
  const bot = createFakeBot();
  const ctx = createContext(db, bot);
  const feature = createWatcherFeature({ resolver: publicResolver });

  await feature.callbacks?.["watch.from"]?.(
    callbackContext(ctx, "user-b", `watch.from:${candidate.id}`),
  );

  assert.equal(db.rows.pf_watchers.length, 0);
  const answers = bot.calls.filter((call) => call.method === "answerCallbackQuery");
  assert.equal(answers.length, 1);
  assert.equal(answers[0]?.args.text, "Это предложение больше не действует");
  assert.equal(bot.calls.filter((call) => call.method === "editText").length, 0);
});

test("the SSRF guard runs when a watcher is created, not only when it is checked", async () => {
  // A name that resolves inside the network. Nothing about the URL text says
  // so, which is exactly why the check has to resolve it.
  const candidate = seedCandidate({ content: "https://status.example.com/health" });
  const db = createFakeDb(NOW, { pf_inbox_candidates: [candidate] });
  const bot = createFakeBot();
  const ctx = createContext(db, bot);
  const feature = createWatcherFeature({ resolver: loopbackResolver });

  await feature.callbacks?.["watch.from"]?.(
    callbackContext(ctx, "user-a", `watch.from:${candidate.id}`),
  );
  const refusal = bot.calls.find((call) => call.method === "answerCallbackQuery");
  assert.equal(refusal?.args.showAlert, true);
  assert.match(String(refusal?.args.text), /публичн/);
  assert.equal(db.rows.pf_watchers.length, 0);

  // …and directly through the command, with an address that needs no lookup.
  const bot2 = createFakeBot();
  const ctx2 = createContext(db, bot2);
  await feature.commands?.watch?.(commandContext(ctx2, "user-a", "http://169.254.169.254/latest/"));
  assert.equal(db.rows.pf_watchers.length, 0);
  assert.equal(bot2.calls.length, 1);
  assert.equal(bot2.calls[0]?.method, "sendText");
  assert.match(String(bot2.calls[0]?.args.text), /публичн/);
});

test("watch.kind re-checks the address before it creates the row", async () => {
  const candidate = seedCandidate({});
  const db = createFakeDb(NOW, { pf_inbox_candidates: [candidate] });
  const bot = createFakeBot();
  const ctx = createContext(db, bot);

  // The offer was made two hours ago against a public address; by the time the
  // button is pressed the name points inside. The row must not be created.
  const feature = createWatcherFeature({ resolver: loopbackResolver });
  await feature.callbacks?.["watch.kind"]?.(
    callbackContext(ctx, "user-a", `watch.kind:${candidate.id}:a`),
  );
  assert.equal(db.rows.pf_watchers.length, 0);

  // The same press with the name still public does create it.
  const ok = createWatcherFeature({ resolver: publicResolver });
  await ok.callbacks?.["watch.kind"]?.(
    callbackContext(ctx, "user-a", `watch.kind:${candidate.id}:c`),
  );
  assert.equal(db.rows.pf_watchers.length, 1);
  assert.equal(db.rows.pf_watchers[0]?.kind, "content_change");
  assert.equal(db.rows.pf_watchers[0]?.owner_id, "user-a");
  // The chat is the one the button was pressed in, never one from the data.
  assert.equal(db.rows.pf_watchers[0]?.chat_id, "chat-1");
});

test("watch.list edits the message in place rather than sending another", async () => {
  const row = seedWatcher({});
  const db = createFakeDb(NOW, { pf_watchers: [row] });
  const bot = createFakeBot();
  const ctx = createContext(db, bot);
  const feature = createWatcherFeature({ resolver: publicResolver });

  await feature.callbacks?.["watch.list"]?.(callbackContext(ctx, "user-a", "watch.list"));

  assert.equal(bot.calls.filter((call) => call.method === "sendText").length, 0);
  const edit = bot.calls.find((call) => call.method === "editText");
  assert.ok(edit);
  assert.equal(edit.args.messageId, "bot-message-1");
  assert.match(String(edit.args.text), /Наблюдатели/);
  // …and it lists only this person's watchers.
  const other = createFakeDb(NOW, { pf_watchers: [seedWatcher({ owner_id: "user-b" })] });
  const bot2 = createFakeBot();
  await feature.callbacks?.["watch.list"]?.(
    callbackContext(createContext(other, bot2), "user-a", "watch.list"),
  );
  assert.match(
    String(bot2.calls.find((call) => call.method === "editText")?.args.text),
    /Наблюдателей пока нет/,
  );
});

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

function watcher(overrides: FakeRow): Watcher {
  return watcherFrom(seedWatcher(overrides));
}

const OK_200: Check = { ok: true, status: 200, contentHash: null, entry: null };
const OK_503: Check = { ok: true, status: 503, contentHash: null, entry: null };
const DOWN: Check = { ok: false, errorCode: "timeout" };

test("the first check establishes a baseline and notifies nobody", () => {
  for (const kind of ["availability", "http_status", "content_change", "feed"] as const) {
    const fresh = watcher({ kind, last_checked_at: null });
    assert.deepEqual(decideTransition(fresh, OK_200), { kind: "baseline" }, kind);
    assert.deepEqual(decideTransition(fresh, DOWN), { kind: "baseline" }, kind);
    assert.equal(renderTransition(fresh, { kind: "baseline" }, NOW, "Europe/Moscow"), null);
  }
});

test("availability reports the transition and stays quiet in between", () => {
  const up = watcher({ last_checked_at: NOW, last_status: 200, last_error: null });
  assert.equal(lastAvailability(up), "up");
  assert.deepEqual(decideTransition(up, OK_200), { kind: "unchanged" });
  assert.deepEqual(decideTransition(up, OK_503), { kind: "down", from: 200, to: 503 });
  assert.deepEqual(decideTransition(up, DOWN), { kind: "down", from: 200, to: null });

  const down = watcher({ last_checked_at: NOW, last_status: 200, last_error: "timeout" });
  assert.equal(lastAvailability(down), "down");
  // A host that stays down says nothing more. This is the rule that keeps a
  // five-minute watcher from sending 288 messages a day.
  assert.deepEqual(decideTransition(down, DOWN), { kind: "unchanged" });
  assert.deepEqual(decideTransition(down, OK_503), { kind: "unchanged" });
  assert.deepEqual(decideTransition(down, OK_200), { kind: "recovered", from: 200, to: 200 });

  // A 5xx counts as down even though the fetch itself succeeded.
  const serving500 = watcher({ last_checked_at: NOW, last_status: 500, last_error: null });
  assert.equal(lastAvailability(serving500), "down");
});

test("the notification reads exactly as the brief writes it", () => {
  const subject = watcher({ url: "https://example.com/status", last_status: 200 });
  const moscow = "Europe/Moscow";
  assert.equal(
    renderTransition(subject, { kind: "down", from: 200, to: 503 }, NOW, moscow),
    "🔴 example.com недоступен / 200 → 503 / 18:42",
  );
  assert.equal(
    renderTransition(subject, { kind: "recovered", from: 503, to: 200 }, NOW, moscow),
    "🟢 example.com снова доступен / 503 → 200 / 18:42",
  );
  // No previous status: the message does not invent one.
  assert.equal(
    renderTransition(subject, { kind: "down", from: null, to: null }, NOW, moscow),
    "🔴 example.com недоступен / 18:42",
  );
  assert.equal(
    renderTransition(subject, { kind: "down", from: 200, to: null }, NOW, moscow),
    "🔴 example.com недоступен / 200 → нет ответа / 18:42",
  );
  assert.equal(
    renderTransition(subject, { kind: "status", from: 200, to: 301 }, NOW, moscow),
    "🟡 example.com / 200 → 301 / 18:42",
  );
  assert.equal(
    renderTransition(subject, { kind: "content" }, NOW, moscow),
    "📝 example.com изменился / 18:42",
  );
  // The clock is the owner's, not the server's.
  assert.equal(
    renderTransition(subject, { kind: "content" }, NOW, "UTC"),
    "📝 example.com изменился / 15:42",
  );
});

test("http_status, content and feed each notify only on their own change", () => {
  const status = watcher({ kind: "http_status", last_checked_at: NOW, last_status: 200 });
  assert.deepEqual(decideTransition(status, OK_200), { kind: "unchanged" });
  assert.deepEqual(decideTransition(status, OK_503), { kind: "status", from: 200, to: 503 });

  const content = watcher({
    kind: "content_change",
    last_checked_at: NOW,
    last_content_hash: sha256("before"),
  });
  assert.deepEqual(
    decideTransition(content, { ok: true, status: 200, contentHash: sha256("before"), entry: null }),
    { kind: "unchanged" },
  );
  assert.deepEqual(
    decideTransition(content, { ok: true, status: 200, contentHash: sha256("after"), entry: null }),
    { kind: "content" },
  );

  const entry = { id: "guid-2", title: "Вторая запись", link: "https://example.com/2" };
  const feed = watcher({
    kind: "feed",
    last_checked_at: NOW,
    last_content_hash: sha256("guid-1"),
  });
  assert.deepEqual(
    decideTransition(feed, { ok: true, status: 200, contentHash: sha256("guid-2"), entry }),
    { kind: "feed", entry },
  );
  const rendered = renderTransition(feed, { kind: "feed", entry }, NOW, "Europe/Moscow");
  assert.match(String(rendered), /📰 example.com — новая запись \/ 18:42/);
  assert.match(String(rendered), /Вторая запись/);
  assert.match(String(rendered), /https:\/\/example.com\/2/);
});

test("a feed title cannot reformat the message it is in", () => {
  // G-5: the client formats every message it receives. A title carrying `*`
  // would otherwise italicise the rest of the line.
  const entry = { id: "g", title: "Release *2.0* and ~~old~~", link: null };
  const feed = watcher({ kind: "feed", last_checked_at: NOW, last_content_hash: sha256("x") });
  const rendered = String(renderTransition(feed, { kind: "feed", entry }, NOW, "UTC"));
  assert.ok(rendered.includes("`"), "an unsafe title is wrapped in a code span");
});

test("a persistent failure is mentioned once and then not again", () => {
  const base = { kind: "content_change" as const, last_checked_at: NOW, last_content_hash: sha256("x") };
  for (let failures = 0; failures < FAILURE_NOTICE_AT - 1; failures += 1) {
    assert.deepEqual(
      decideTransition(watcher({ ...base, consecutive_failures: failures }), DOWN),
      { kind: "unchanged" },
      `after ${failures} failures`,
    );
  }
  assert.deepEqual(
    decideTransition(watcher({ ...base, consecutive_failures: FAILURE_NOTICE_AT - 1 }), DOWN),
    { kind: "failing", failures: FAILURE_NOTICE_AT, errorCode: "timeout" },
  );
  // And not again on the next one, or the notice becomes the firehose it exists
  // to prevent.
  assert.deepEqual(
    decideTransition(watcher({ ...base, consecutive_failures: FAILURE_NOTICE_AT }), DOWN),
    { kind: "unchanged" },
  );
});

test("a failure keeps the last status so the next message can name it", () => {
  const subject = watcher({ last_checked_at: NOW, last_status: 200, consecutive_failures: 1 });
  const state = nextRowState(subject, DOWN);
  assert.equal(state.status, 200, "kept, not cleared");
  assert.equal(state.error, "timeout");
  assert.equal(state.failures, 2);
  // A success clears the error and resets the counter.
  assert.deepEqual(nextRowState(subject, OK_200), {
    status: 200,
    contentHash: null,
    error: null,
    failures: 0,
  });
});

test("backoff grows and then stops growing", () => {
  assert.equal(backoffSeconds(300, 0), 300);
  assert.equal(backoffSeconds(300, 1), 600);
  assert.equal(backoffSeconds(300, 2), 1_200);
  assert.equal(backoffSeconds(300, 3), 2_400);
  assert.equal(backoffSeconds(300, 4), 3_600);
  assert.equal(backoffSeconds(300, 40), 3_600);
  // A long interval is never shortened by the cap.
  assert.equal(backoffSeconds(7_200, 0), 7_200);
  assert.equal(backoffSeconds(7_200, 3), 3_600);
});

// ---------------------------------------------------------------------------
// Reading the body
// ---------------------------------------------------------------------------

test("content normalisation ignores what changes on every poll", () => {
  // The same page served twice. Only the noise differs: a cache-busting
  // script variable, a rotated stylesheet, a build-time comment, and the
  // amount of whitespace between the lines.
  const page = (token: string, colour: string, built: string, gap: string): string =>
    [
      "<html><head>",
      `<style>a{color:${colour}}</style>`,
      `</head>${gap}<body>`,
      "<p>Привет</p>",
      `<script>var t=${token};</script>`,
      `<!-- built ${built} -->`,
      "</body></html>",
    ].join(gap);
  const first = page("1758291720", "red", "15:42", "\n  ");
  const second = page("1758291999", "blue", "15:47", " ");
  assert.equal(
    normalizeContent(first, "text/html"),
    normalizeContent(second, "text/html"),
    "a changed script, style, comment and indentation are not a content change",
  );

  // …but the text itself still is, or the normaliser would have eaten the
  // signal along with the noise.
  assert.notEqual(
    normalizeContent(first, "text/html"),
    normalizeContent(first.replace("Привет", "Пока"), "text/html"),
  );

  // The limit, pinned rather than left to be discovered: whitespace runs are
  // collapsed, not removed, so a page that is reformatted between tags — a
  // switch from pretty-printed to minified — does read as a change. That is a
  // once-in-a-deploy false positive and the honest cost of not parsing HTML.
  assert.notEqual(
    normalizeContent("<p>a</p> <p>b</p>", "text/html"),
    normalizeContent("<p>a</p><p>b</p>", "text/html"),
  );

  // Plain text is not stripped, only collapsed. A script tag in a text/plain
  // document is content, not markup.
  assert.equal(normalizeContent("a\n\n  b\t c ", "text/plain"), "a b c");
  assert.equal(normalizeContent("<script>x</script>", "text/plain"), "<script>x</script>");
});

test("the feed reader finds the newest entry in RSS and in Atom", () => {
  const rss = [
    '<?xml version="1.0"?><rss version="2.0"><channel>',
    "<title>Канал</title>",
    "<item><guid isPermaLink=\"false\">urn:2</guid><title><![CDATA[Вторая & новая]]></title><link>https://example.com/2</link></item>",
    "<item><guid>urn:1</guid><title>Первая</title><link>https://example.com/1</link></item>",
    "</channel></rss>",
  ].join("");
  assert.deepEqual(firstFeedEntry(rss), {
    id: "urn:2",
    title: "Вторая & новая",
    link: "https://example.com/2",
  });

  const atom = [
    '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">',
    "<title>Канал</title>",
    '<entry><id>tag:example.com,2026:2</id><title>Запись &amp; две</title>',
    '<link rel="alternate" href="https://example.com/a2"/></entry>',
    "</feed>",
  ].join("");
  assert.deepEqual(firstFeedEntry(atom), {
    id: "tag:example.com,2026:2",
    title: "Запись & две",
    link: "https://example.com/a2",
  });

  // The channel's own <title> must not be mistaken for an entry's.
  assert.notEqual(firstFeedEntry(rss)?.title, "Канал");
  assert.equal(firstFeedEntry("<html><body>not a feed</body></html>"), null);
  assert.equal(firstFeedEntry(""), null);
});

test("performCheck turns a response into a comparable observation", async () => {
  const feedBody = "<rss><channel><item><guid>urn:7</guid><title>Семь</title></item></channel></rss>";
  const feed = await performCheck(watcher({ kind: "feed" }), {
    fetch: fetcherReturning({
      status: 200,
      headers: { "content-type": "application/rss+xml" },
      body: Buffer.from(feedBody, "utf8"),
    }),
  });
  assert.equal(feed.ok, true);
  assert.equal(feed.ok && feed.contentHash, sha256("urn:7"));
  assert.equal(feed.ok && feed.entry?.title, "Семь");

  // A status-only watcher never hashes anything, so a page that changes on
  // every poll does not wake it up.
  const status = await performCheck(watcher({ kind: "availability" }), {
    fetch: fetcherReturning({ status: 204, body: Buffer.from("anything") }),
  });
  assert.deepEqual(status, { ok: true, status: 204, contentHash: null, entry: null });

  // A refusal and a transport failure are both recorded as a code, never as a
  // body and never as a URL.
  const refused = await performCheck(watcher({ url: "http://10.0.0.5/" }), {});
  assert.deepEqual(refused, { ok: false, errorCode: "denied:private_network" });

  const failed = await performCheck(watcher({}), {
    fetch: async () => {
      throw new SafeFetchError("timeout");
    },
  });
  assert.deepEqual(failed, { ok: false, errorCode: "timeout" });
});

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

test("a tick claims what is due, records it, and says nothing the first time", async () => {
  const row = seedWatcher({ next_check_at: new Date(NOW.getTime() - 1_000) });
  const db = createFakeDb(NOW, { pf_watchers: [row] });
  const bot = createFakeBot();
  const ctx = createContext(db, bot);

  const summary = await watcherTick(ctx, {
    fetch: fetcherReturning({ status: 200 }),
    newClaimToken: () => "11111111-1111-4111-8111-111111111111",
  });

  assert.deepEqual(summary, { checked: 1, notified: 0, failed: 0 });
  const stored = db.rows.pf_watchers[0] as FakeRow;
  assert.equal(stored.last_status, 200);
  assert.equal(stored.last_error, null);
  assert.equal(stored.consecutive_failures, 0);
  assert.equal(stored.claim_token, null, "the claim is released by the write");
  assert.equal(
    (stored.next_check_at as Date).getTime(),
    NOW.getTime() + 300 * 1_000,
    "the next check is one interval away",
  );
  assert.equal(bot.calls.length, 0, "a baseline notifies nobody");
});

test("a tick notifies on the transition, once, and not on the poll after it", async () => {
  const row = seedWatcher({
    last_checked_at: new Date(NOW.getTime() - 300_000),
    last_status: 200,
    next_check_at: new Date(NOW.getTime() - 1_000),
  });
  const db = createFakeDb(NOW, { pf_watchers: [row] });
  const bot = createFakeBot();
  const ctx = createContext(db, bot);
  const deps = { fetch: fetcherReturning({ status: 503 }) };

  const first = await watcherTick(ctx, deps);
  assert.deepEqual(first, { checked: 1, notified: 1, failed: 0 });
  const message = bot.calls.find((call) => call.method === "sendText");
  assert.equal(message?.args.chatId, "chat-1");
  assert.equal(message?.args.text, "🔴 example.com недоступен / 200 → 503 / 18:42");
  // The notification carries the two buttons a person wants at that moment.
  const buttons = (message?.args.keyboard as { rows: { callbackData?: string }[][] }).rows
    .flat()
    .map((entry) => parseCallbackData(entry.callbackData ?? "").action);
  assert.deepEqual(buttons, ["watch.check", "watch.toggle"]);

  // The same observation again is silence.
  (db.rows.pf_watchers[0] as FakeRow).next_check_at = new Date(NOW.getTime() - 1_000);
  bot.calls.length = 0;
  const second = await watcherTick(ctx, deps);
  assert.deepEqual(second, { checked: 1, notified: 0, failed: 0 });
  assert.equal(bot.calls.length, 0);

  // And recovery is announced.
  (db.rows.pf_watchers[0] as FakeRow).next_check_at = new Date(NOW.getTime() - 1_000);
  await watcherTick(ctx, { fetch: fetcherReturning({ status: 200 }) });
  assert.equal(
    bot.calls.find((call) => call.method === "sendText")?.args.text,
    "🟢 example.com снова доступен / 503 → 200 / 18:42",
  );
});

test("a failing check backs off instead of hammering the host", async () => {
  const row = seedWatcher({
    last_checked_at: new Date(NOW.getTime() - 300_000),
    last_status: 200,
    next_check_at: new Date(NOW.getTime() - 1_000),
  });
  const db = createFakeDb(NOW, { pf_watchers: [row] });
  const bot = createFakeBot();
  const ctx = createContext(db, bot);
  const failing = {
    fetch: async () => {
      throw new SafeFetchError("timeout");
    },
  };

  const delays: number[] = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    (db.rows.pf_watchers[0] as FakeRow).next_check_at = new Date(NOW.getTime() - 1_000);
    const summary = await watcherTick(ctx, failing);
    assert.equal(summary.failed, 1);
    delays.push(
      ((db.rows.pf_watchers[0] as FakeRow).next_check_at as Date).getTime() - NOW.getTime(),
    );
  }
  assert.deepEqual(delays, [600_000, 1_200_000, 2_400_000, 3_600_000]);
  assert.equal(db.rows.pf_watchers[0]?.consecutive_failures, 4);
  assert.equal(db.rows.pf_watchers[0]?.last_error, "timeout");
  // One message: the transition to down. Not four.
  assert.equal(bot.calls.filter((call) => call.method === "sendText").length, 1);
});

test("a watcher that is off is not checked, and one not yet due is not either", async () => {
  const db = createFakeDb(NOW, {
    pf_watchers: [
      seedWatcher({ enabled: false, next_check_at: new Date(NOW.getTime() - 10_000) }),
      seedWatcher({ next_check_at: new Date(NOW.getTime() + 10_000) }),
      seedWatcher({
        next_check_at: new Date(NOW.getTime() - 10_000),
        claimed_at: new Date(NOW.getTime() - 5_000),
        claim_token: "22222222-2222-4222-8222-222222222222",
      }),
    ],
  });
  const ctx = createContext(db, createFakeBot());
  let fetches = 0;
  const summary = await watcherTick(ctx, {
    fetch: async () => {
      fetches += 1;
      return fetcherReturning({ status: 200 })("");
    },
  });
  assert.deepEqual(summary, { checked: 0, notified: 0, failed: 0 });
  assert.equal(fetches, 0, "off, not due, and already claimed are all skipped");
});

test("a claim held past its lease is taken by the next tick", async () => {
  const db = createFakeDb(NOW, {
    pf_watchers: [
      seedWatcher({
        next_check_at: new Date(NOW.getTime() - 10_000),
        claimed_at: new Date(NOW.getTime() - 500_000),
        claim_token: "22222222-2222-4222-8222-222222222222",
      }),
    ],
  });
  const ctx = createContext(db, createFakeBot());
  const summary = await watcherTick(ctx, {
    fetch: fetcherReturning({ status: 200 }),
    leaseSeconds: 120,
  });
  assert.equal(summary.checked, 1, "a dead process must not park a watcher for ever");
});

test("an observation whose claim was taken away is not announced", async () => {
  // The tick ran past its lease, another process re-claimed the watcher and
  // has its own, newer observation. Ours is stale: writing it would overwrite
  // a newer one and announcing it would double the message.
  const row = seedWatcher({
    last_checked_at: new Date(NOW.getTime() - 300_000),
    last_status: 200,
    next_check_at: new Date(NOW.getTime() - 1_000),
  });
  const db = createFakeDb(NOW, { pf_watchers: [row] });
  const bot = createFakeBot();
  const ctx = createContext(db, bot);

  const summary = await watcherTick(ctx, {
    fetch: async () => {
      // Somebody else takes the claim while our request is in flight.
      (db.rows.pf_watchers[0] as FakeRow).claim_token = "33333333-3333-4333-8333-333333333333";
      return fetcherReturning({ status: 503 })("");
    },
  });

  assert.equal(summary.checked, 1);
  assert.equal(summary.notified, 0, "a transition we no longer own is not announced");
  assert.equal(bot.calls.length, 0);
  assert.equal(db.rows.pf_watchers[0]?.last_status, 200, "and the older observation is not written");
});

test("a shutdown hands back what it claimed instead of holding it for a lease", async () => {
  const db = createFakeDb(NOW, {
    pf_watchers: [
      seedWatcher({ next_check_at: new Date(NOW.getTime() - 10_000) }),
      seedWatcher({ next_check_at: new Date(NOW.getTime() - 9_000) }),
    ],
  });
  const ctx = createContext(db, createFakeBot());
  const controller = new AbortController();
  let fetches = 0;

  const summary = await watcherTick(
    ctx,
    {
      fetch: async () => {
        fetches += 1;
        // The scheduler is asked to stop while the first check is in flight.
        controller.abort();
        return fetcherReturning({ status: 200 })("");
      },
    },
    { signal: controller.signal },
  );

  assert.equal(fetches, 1, "the second watcher is not checked");
  assert.equal(summary.checked, 1);
  for (const row of db.rows.pf_watchers) {
    assert.equal(row.claim_token, null, "no claim is left behind for the lease to expire");
  }
  assert.equal(
    (db.rows.pf_watchers[1] as FakeRow).next_check_at instanceof Date &&
      ((db.rows.pf_watchers[1] as FakeRow).next_check_at as Date).getTime() < NOW.getTime(),
    true,
    "the unchecked watcher is still due",
  );
});

test("a send that fails still leaves the observation written down", async () => {
  const row = seedWatcher({
    last_checked_at: new Date(NOW.getTime() - 300_000),
    last_status: 200,
    next_check_at: new Date(NOW.getTime() - 1_000),
  });
  const db = createFakeDb(NOW, { pf_watchers: [row] });
  const bot = createFakeBot({ sendTextThrows: true });
  const ctx = createContext(db, bot);

  const summary = await watcherTick(ctx, { fetch: fetcherReturning({ status: 503 }) });

  assert.equal(summary.checked, 1);
  assert.equal(summary.notified, 0, "the message did not land");
  assert.equal(db.rows.pf_watchers[0]?.last_status, 503, "but the observation did");
  // The next tick must not re-announce it: the row already moved on.
  (db.rows.pf_watchers[0] as FakeRow).next_check_at = new Date(NOW.getTime() - 1_000);
  bot.calls.length = 0;
  await watcherTick(ctx, { fetch: fetcherReturning({ status: 503 }) });
  assert.equal(bot.calls.length, 0);
});

test("the tick never sends the URL or the body to the fetcher's caller by accident", async () => {
  // The watcher's URL carries a query string that must not appear in any
  // recorded error, and the body must never be persisted or logged.
  const row = seedWatcher({
    kind: "content_change",
    url: "https://example.com/p?token=abcdef",
    last_checked_at: new Date(NOW.getTime() - 300_000),
    last_content_hash: sha256("old"),
    next_check_at: new Date(NOW.getTime() - 1_000),
  });
  const db = createFakeDb(NOW, { pf_watchers: [row] });
  const bot = createFakeBot();
  const ctx = createContext(db, bot);

  await watcherTick(ctx, {
    fetch: fetcherReturning({
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from("<p>совершенно новое содержимое</p>", "utf8"),
    }),
  });

  const stored = db.rows.pf_watchers[0] as FakeRow;
  assert.equal(stored.last_content_hash, sha256(normalizeContent("<p>совершенно новое содержимое</p>", "text/html")));
  assert.ok(!String(stored.last_content_hash).includes("совершенно"));
  const sent = String(bot.calls.find((call) => call.method === "sendText")?.args.text);
  assert.equal(sent, "📝 example.com изменился / 18:42");
  assert.ok(!sent.includes("abcdef"), "the query string stays out of the message");
  assert.ok(!sent.includes("совершенно"), "the body stays out of the message");
});
