/**
 * Reminders: the store, the handlers and the firing.
 *
 * **Against a real PostgreSQL, in process.** PGlite runs the actual
 * `migrations/*.sql` and the actual statements, so `for update skip locked`,
 * the `owner_id = $2` predicates and the `uuid` column's refusal of a junk id
 * are all exercised rather than described. A fake `Db` returning canned rows
 * would make every SQL assertion here vacuous — the claim would «work» because
 * the fake said so — and the claim is the one piece of this feature that cannot
 * be checked by reading it.
 *
 * What the fake covers instead is the transport, where a fake is the right
 * tool: the assertions are about *which* calls are made with *what*, and a real
 * gateway would add a network and remove the ability to make one fail on
 * demand.
 *
 * **The limit worth stating.** PGlite is one connection, so two genuinely
 * concurrent transactions cannot be run here and `skip locked`'s behaviour
 * under contention is not proved by this file. What is proved is the part that
 * fails in production far more often: a second *tick* — a second process a
 * moment later, or the same process after a restart — finds the row already
 * claimed and leaves it alone. Removing either the `claimed_at is null`
 * predicate or the token check in `markFired` turns these tests red.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

import { parseCallbackData, type AppContext } from "../../artifacts/pocketflow/src/app/context.ts";
import {
  createRemindersFeature,
  createRemindersJob,
  deliverDue,
  REMINDER_ACTIONS,
} from "../../artifacts/pocketflow/src/app/reminders.ts";
import type {
  CallbackContext,
  CommandContext,
  MessageContext,
} from "../../artifacts/pocketflow/src/app/router.ts";
import { createLogger } from "../../artifacts/pocketflow/src/lib/logger.ts";
import type { PocketFlowConfig } from "../../artifacts/pocketflow/src/config.ts";
import type { Classification } from "../../artifacts/pocketflow/src/lib/classify.ts";
import { rememberCandidate } from "../../artifacts/pocketflow/src/store/candidates.ts";
import type { Db } from "../../artifacts/pocketflow/src/store/db.ts";
import {
  claimDue,
  cancelReminder,
  completeReminder,
  createReminder,
  isReminderId,
  listPending,
  markFired,
  readPendingPrompt,
  readReminder,
  releaseClaim,
  snoozeReminder,
  type Reminder,
} from "../../artifacts/pocketflow/src/store/reminders.ts";
import type { PocketFlowUser } from "../../artifacts/pocketflow/src/store/users.ts";
import {
  TransportError,
  type BotTransport,
  type EditTextOptions,
  type SendTextOptions,
  type SentMessage,
} from "../../artifacts/pocketflow/src/transport/types.ts";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "artifacts",
  "pocketflow",
  "migrations",
);

const ALICE = "user-alice";
const MALLORY = "user-mallory";
const CHAT = "chat-1";
const MSK = "Europe/Moscow";
const NY = "America/New_York";

let pg: PGlite;
let db: Db;

before(async () => {
  pg = await PGlite.create();
  // Every migration in the directory, in the order `migrate()` would apply
  // them — so a schema change by another feature is either compatible or
  // loudly not, rather than silently absent from this file's world.
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(path.join(MIGRATIONS, file), "utf8"));
  }
  db = {
    async query(text, values) {
      const result = await pg.query(text, values ? [...values] : undefined);
      return {
        rows: result.rows,
        rowCount: result.affectedRows ?? result.rows.length,
        command: "",
        oid: 0,
        fields: [],
      } as never;
    },
    async transaction(fn) {
      await pg.query("begin");
      try {
        const value = await fn(db);
        await pg.query("commit");
        return value;
      } catch (error) {
        await pg.query("rollback");
        throw error;
      }
    },
    async close() {
      await pg.close();
    },
  };
});

after(async () => {
  await pg?.close();
});

async function reset(): Promise<void> {
  await pg.exec(
    "truncate pf_reminders, pf_pending_prompts, pf_inbox_candidates, pf_users restart identity cascade",
  );
}

/** A clock the test moves by hand; `ctx.now()` reads it. */
function clock(startIso: string): { now: () => Date; advance: (ms: number) => void } {
  let current = new Date(startIso).getTime();
  return { now: () => new Date(current), advance: (ms) => { current += ms; } };
}

type FakeBot = BotTransport & {
  sent: SendTextOptions[];
  edited: EditTextOptions[];
  answers: { id: string; text: string | null }[];
  /** Thrown by the next `sendText` and then cleared. */
  failSendWith: Error | null;
};

function fakeBot(): FakeBot {
  const unsupported = (name: string) => () => {
    throw new Error(`fake transport: ${name} was not expected in this test`);
  };
  let counter = 0;
  const bot: FakeBot = {
    platform: "fake",
    sent: [],
    edited: [],
    answers: [],
    failSendWith: null,
    supports: () => true,
    async sendText(options: SendTextOptions): Promise<SentMessage> {
      if (bot.failSendWith) {
        const error = bot.failSendWith;
        bot.failSendWith = null;
        throw error;
      }
      bot.sent.push(options);
      counter += 1;
      return { id: `sent-${counter}`, chatId: options.chatId, date: null };
    },
    async editText(options: EditTextOptions): Promise<void> {
      bot.edited.push(options);
    },
    async answerCallbackQuery(id, options) {
      bot.answers.push({ id: String(id), text: options?.text ?? null });
    },
    getMe: unsupported("getMe") as never,
    deleteMessage: unsupported("deleteMessage") as never,
    sendChatAction: unsupported("sendChatAction") as never,
    getFile: unsupported("getFile") as never,
    setMyCommands: unsupported("setMyCommands") as never,
    getMyCommands: unsupported("getMyCommands") as never,
    getUpdates: unsupported("getUpdates") as never,
    setWebhook: unsupported("setWebhook") as never,
    deleteWebhook: unsupported("deleteWebhook") as never,
    getWebhookInfo: unsupported("getWebhookInfo") as never,
    parseWebhookUpdate: unsupported("parseWebhookUpdate") as never,
  };
  return bot;
}

function appContext(bot: FakeBot, now: () => Date): AppContext {
  return {
    config: { defaultTimeZone: MSK, developerIds: new Set<string>() } as PocketFlowConfig,
    db,
    bot,
    log: createLogger({ write: () => undefined }),
    now,
  };
}

function user(userId: string, timeZone = MSK): PocketFlowUser {
  return { userId, displayName: null, username: null, timeZone, developerMode: false };
}

function commandContext(
  ctx: AppContext,
  who: PocketFlowUser,
  command: string,
  args: string,
): CommandContext {
  return {
    ctx,
    command,
    args,
    user: who,
    isGroup: false,
    message: {
      id: "incoming-1" as never,
      chat: { id: CHAT as never, kind: "private", title: null },
      from: { id: who.userId as never, isBot: false, displayName: null, username: null },
      date: ctx.now(),
      text: `/${command} ${args}`,
      replyToMessageId: null,
      topicId: null,
      attachment: null,
    },
  };
}

function messageContext(ctx: AppContext, who: PocketFlowUser, text: string): MessageContext {
  return {
    ctx,
    user: who,
    isGroup: false,
    message: {
      id: "incoming-2" as never,
      chat: { id: CHAT as never, kind: "private", title: null },
      from: { id: who.userId as never, isBot: false, displayName: null, username: null },
      date: ctx.now(),
      text,
      replyToMessageId: null,
      topicId: null,
      attachment: null,
    },
  };
}

function callbackContext(
  ctx: AppContext,
  who: PocketFlowUser,
  data: string,
  messageId = "bot-msg-1",
): { action: string; input: CallbackContext } {
  const { action, args } = parseCallbackData(data);
  return {
    action,
    input: {
      ctx,
      user: who,
      args,
      query: {
        id: "cbq-1" as never,
        from: { id: who.userId as never, isBot: false, displayName: null, username: null },
        data,
        message: { id: messageId as never, chatId: CHAT as never },
      },
    },
  };
}

const feature = createRemindersFeature();

async function press(input: CallbackContext, action: string): Promise<void> {
  const handler = feature.callbacks?.[action];
  assert.ok(handler, `no handler registered for ${action}`);
  await handler(input);
}

async function runCommand(input: CommandContext): Promise<void> {
  const handler = feature.commands?.[input.command];
  assert.ok(handler, `no handler for /${input.command}`);
  await handler(input);
}

const TEXT_CLASSIFICATION = { kind: "text", text: "whatever" } as Classification;

async function rowOf(id: string): Promise<Record<string, unknown>> {
  const result = await pg.query("select * from pf_reminders where id = $1", [id]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  assert.ok(row, "the reminder row is gone");
  return row;
}

// ---------------------------------------------------------------------------
// The claim
// ---------------------------------------------------------------------------

test("a due reminder is claimed once; a second claim at the same instant gets nothing", async () => {
  await reset();
  const now = new Date("2026-09-19T09:00:00.000Z");
  const reminder = await createReminder(db, {
    ownerId: ALICE,
    chatId: CHAT,
    body: "Проверить",
    dueAt: new Date(now.getTime() - 1000),
  });

  const first = randomUUID();
  const second = randomUUID();
  assert.equal((await claimDue(db, { now, claimToken: first })).length, 1);
  // The whole of «two processes must not fire the same reminder twice», in one
  // assertion. Deleting `claimed_at is null` from the claim statement makes
  // this line return 1 and the reminder go out twice.
  assert.equal((await claimDue(db, { now, claimToken: second })).length, 0);

  const row = await rowOf(reminder.id);
  assert.equal(row.claim_token, first);
});

test("a claim older than its TTL is taken back", async () => {
  await reset();
  const now = new Date("2026-09-19T09:00:00.000Z");
  await createReminder(db, {
    ownerId: ALICE,
    chatId: CHAT,
    body: "Проверить",
    dueAt: new Date(now.getTime() - 1000),
  });
  const dead = randomUUID();
  assert.equal((await claimDue(db, { now, claimToken: dead, claimTtlMs: 60_000 })).length, 1);

  // A process that claimed and then died would otherwise hold the work for
  // ever, and a reminder nobody ever fires is the failure mode a person cannot
  // see.
  const later = new Date(now.getTime() + 61_000);
  const alive = randomUUID();
  const retaken = await claimDue(db, { now: later, claimToken: alive, claimTtlMs: 60_000 });
  assert.equal(retaken.length, 1);
  assert.equal(retaken[0]?.claimToken, alive);
});

test("markFired refuses a token that no longer owns the claim", async () => {
  await reset();
  const now = new Date("2026-09-19T09:00:00.000Z");
  const reminder = await createReminder(db, {
    ownerId: ALICE,
    chatId: CHAT,
    body: "Проверить",
    dueAt: new Date(now.getTime() - 1000),
  });
  const mine = randomUUID();
  await claimDue(db, { now, claimToken: mine });

  assert.equal(
    await markFired(db, {
      id: reminder.id,
      claimToken: randomUUID(),
      firedMessageId: "m",
      firedAt: now,
    }),
    false,
    "a process whose claim expired cannot finish work that was reassigned",
  );
  assert.equal((await rowOf(reminder.id)).state, "pending");

  assert.equal(
    await markFired(db, { id: reminder.id, claimToken: mine, firedMessageId: "m", firedAt: now }),
    true,
  );
  const row = await rowOf(reminder.id);
  assert.equal(row.state, "fired");
  assert.equal(row.fired_message_id, "m");
  assert.equal(row.claim_token, null, "the claim is handed back once the work is done");
});

test("a reminder that is not yet due is not claimed", async () => {
  await reset();
  const now = new Date("2026-09-19T09:00:00.000Z");
  await createReminder(db, {
    ownerId: ALICE,
    chatId: CHAT,
    body: "Позже",
    dueAt: new Date(now.getTime() + 60_000),
  });
  assert.equal((await claimDue(db, { now, claimToken: randomUUID() })).length, 0);
  const later = new Date(now.getTime() + 61_000);
  assert.equal((await claimDue(db, { now: later, claimToken: randomUUID() })).length, 1);
});

test("releaseClaim hands the work back for the next tick", async () => {
  await reset();
  const now = new Date("2026-09-19T09:00:00.000Z");
  const reminder = await createReminder(db, {
    ownerId: ALICE,
    chatId: CHAT,
    body: "Проверить",
    dueAt: new Date(now.getTime() - 1000),
  });
  const token = randomUUID();
  await claimDue(db, { now, claimToken: token });
  await releaseClaim(db, reminder.id, token);
  assert.equal((await claimDue(db, { now, claimToken: randomUUID() })).length, 1);
});

// ---------------------------------------------------------------------------
// The store refuses on its own
// ---------------------------------------------------------------------------

test("an id that is not a uuid is refused without reaching Postgres", async () => {
  await reset();
  // `where id = $1` against a uuid column raises 22P02 for a junk value, which
  // inside a handler is a crash rather than a refusal. The shape is decided
  // before the query is made.
  assert.equal(isReminderId("'; drop table pf_reminders; --"), false);
  assert.equal(isReminderId(randomUUID()), true);
  assert.equal(await readReminder(db, ALICE, "'; drop table pf_reminders; --"), null);
  assert.equal(await readReminder(db, ALICE, "../../etc/passwd"), null);
  assert.equal(await completeReminder(db, ALICE, "not-a-uuid", new Date()), null);

  // …and the table is still there, which is the other half of the point.
  const check = await pg.query("select count(*)::int as c from pf_reminders");
  assert.equal((check.rows[0] as { c: number }).c, 0);
});

test("every owner-scoped statement refuses another person's row", async () => {
  await reset();
  const now = new Date("2026-09-19T09:00:00.000Z");
  const reminder = await createReminder(db, {
    ownerId: ALICE,
    chatId: CHAT,
    body: "Личное",
    dueAt: new Date(now.getTime() + 60_000),
  });

  assert.equal(await readReminder(db, MALLORY, reminder.id), null);
  assert.equal(await completeReminder(db, MALLORY, reminder.id, now), null);
  assert.equal(await cancelReminder(db, MALLORY, reminder.id, now), null);
  assert.equal(await snoozeReminder(db, MALLORY, reminder.id, new Date(now.getTime() + 1)), null);

  // Nothing moved. This is the gate that still holds if every check in the
  // handler above it were deleted.
  const row = await rowOf(reminder.id);
  assert.equal(row.state, "pending");
  assert.equal(row.snooze_count, 0);
  assert.equal(new Date(row.due_at as string).toISOString(), reminder.dueAt.toISOString());
});

test("listPending shows only the asker's own, soonest first", async () => {
  await reset();
  const now = new Date("2026-09-19T09:00:00.000Z");
  const later = await createReminder(db, {
    ownerId: ALICE,
    chatId: CHAT,
    body: "Позже",
    dueAt: new Date(now.getTime() + 7_200_000),
  });
  const sooner = await createReminder(db, {
    ownerId: ALICE,
    chatId: CHAT,
    body: "Раньше",
    dueAt: new Date(now.getTime() + 60_000),
  });
  await createReminder(db, {
    ownerId: MALLORY,
    chatId: CHAT,
    body: "Чужое",
    dueAt: new Date(now.getTime() + 1000),
  });

  const listed = await listPending(db, ALICE);
  assert.deepEqual(
    listed.map((entry) => entry.id),
    [sooner.id, later.id],
  );
});

// ---------------------------------------------------------------------------
// callback_data is not authorization
// ---------------------------------------------------------------------------

test("a forged callback naming somebody else's reminder changes nothing", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);

  const alices = await createReminder(db, {
    ownerId: ALICE,
    chatId: CHAT,
    body: "Личное дело Алисы",
    dueAt: new Date(time.now().getTime() + 3_600_000),
  });

  // Mallory has the id — it was in a button she could see, or she guessed it.
  // Every one of these is a well-formed press of a real reminder by the wrong
  // person, which is exactly what `callback_data` cannot rule out on its own.
  for (const data of [
    `${REMINDER_ACTIONS.DONE}:${alices.id}`,
    `${REMINDER_ACTIONS.SNOOZE}:${alices.id}:10`,
    `${REMINDER_ACTIONS.CANCEL}:${alices.id}`,
  ]) {
    bot.edited.length = 0;
    bot.answers.length = 0;
    const { action, input } = callbackContext(ctx, user(MALLORY), data);
    await press(input, action);

    assert.deepEqual(
      bot.answers.map((answer) => answer.text),
      ["Это напоминание больше не действует"],
      `${data} was refused`,
    );
    assert.equal(bot.edited.length, 0, `${data} edited no message`);
  }

  const row = await rowOf(alices.id);
  assert.equal(row.state, "pending");
  assert.equal(row.snooze_count, 0);
  assert.equal(row.completed_at, null);

  // And the body never reached her: the refusal says nothing about what the
  // reminder is, so a guessed id cannot be used to read somebody's text.
  assert.equal(
    bot.answers.some((answer) => (answer.text ?? "").includes("Личное")),
    false,
  );
});

test("the owner's own press does work", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);
  const reminder = await createReminder(db, {
    ownerId: ALICE,
    chatId: CHAT,
    body: "Проверить сервер",
    dueAt: new Date(time.now().getTime() + 3_600_000),
  });

  const { action, input } = callbackContext(ctx, user(ALICE), `${REMINDER_ACTIONS.DONE}:${reminder.id}`);
  await press(input, action);

  assert.equal((await rowOf(reminder.id)).state, "done");
  assert.equal(bot.answers[0]?.text, "Выполнено");
});

test("a snooze length that was not offered is refused", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);
  const reminder = await createReminder(db, {
    ownerId: ALICE,
    chatId: CHAT,
    body: "Проверить",
    dueAt: new Date(time.now().getTime() + 1000),
  });

  // The minutes arrive in the same client-controlled string as the id.
  const { action, input } = callbackContext(
    ctx,
    user(ALICE),
    `${REMINDER_ACTIONS.SNOOZE}:${reminder.id}:525600`,
  );
  await press(input, action);

  assert.equal(bot.answers[0]?.text, "Так отложить нельзя");
  const row = await rowOf(reminder.id);
  assert.equal(row.snooze_count, 0);
  assert.equal(
    new Date(row.due_at as string).toISOString(),
    reminder.dueAt.toISOString(),
    "a crafted press did not park the reminder a year away",
  );
});

// ---------------------------------------------------------------------------
// /remind
// ---------------------------------------------------------------------------

test("/remind with a time creates the reminder and confirms the absolute moment", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z"); // 12:00 Moscow
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);

  await runCommand(commandContext(ctx, user(ALICE), "remind", "20m Проверить сервер"));

  const listed = await listPending(db, ALICE);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.body, "Проверить сервер");
  assert.equal(listed[0]?.dueAt.toISOString(), "2026-09-19T09:20:00.000Z");

  assert.equal(bot.sent.length, 1);
  // The confirmation names a clock time rather than «через 20 минут», so a
  // misread input is visible immediately instead of at the wrong hour.
  assert.match(bot.sent[0]?.text ?? "", /Напомню сегодня в 12:20 — Проверить сервер/);
  assert.equal(bot.sent[0]?.keyboard?.rows[0]?.[0]?.text, "Отменить");
});

test("the time zone that is used is the person's own, not the configured default", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);
  assert.equal(ctx.config.defaultTimeZone, MSK);

  await runCommand(commandContext(ctx, user(ALICE, NY), "remind", "завтра 18:00 Позвонить"));

  const listed = await listPending(db, ALICE);
  // 18:00 in New York, not 18:00 in Moscow — seven hours apart, and the
  // difference a person notices on the first day they travel.
  assert.equal(listed[0]?.dueAt.toISOString(), "2026-09-20T22:00:00.000Z");
  assert.match(bot.sent[0]?.text ?? "", /Напомню завтра в 18:00/);
});

test("/remind with a misread time says so instead of offering buttons", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);

  await runCommand(commandContext(ctx, user(ALICE), "remind", "завтра 25:70 Ошибка"));

  assert.equal((await listPending(db, ALICE)).length, 0);
  assert.match(bot.sent[0]?.text ?? "", /Такого времени не бывает/);
  assert.equal(bot.sent[0]?.keyboard, undefined, "a wrong time is a correction, not a menu");
});

test("/remind with no recognisable time opens the quick-choice draft", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);

  await runCommand(commandContext(ctx, user(ALICE), "remind", "Проверить сервер"));

  assert.equal((await listPending(db, ALICE)).length, 0, "nothing is created until a time is chosen");
  const labels = (bot.sent[0]?.keyboard?.rows ?? []).flat().map((entry) => entry.text);
  assert.deepEqual(labels, ["10 минут", "1 час", "Сегодня вечером", "Завтра", "Указать дату"]);

  const prompt = await readPendingPrompt(db, CHAT, ALICE, time.now());
  assert.equal(prompt?.kind, "reminder_when");
  // The body lives in the prompt row, not in `callback_data`: a button is
  // capped at 128 bytes and somebody's note is not.
  assert.equal((prompt?.context as { body?: string }).body, "Проверить сервер");
});

test("a quick button creates the reminder and rewrites the message it is on", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);

  await runCommand(commandContext(ctx, user(ALICE), "remind", "Проверить сервер"));
  const nonce = parseCallbackData(
    bot.sent[0]?.keyboard?.rows[0]?.[0] && "callbackData" in bot.sent[0].keyboard.rows[0][0]
      ? bot.sent[0].keyboard.rows[0][0].callbackData
      : "",
  ).args[1];
  assert.ok(nonce);

  const { action, input } = callbackContext(
    ctx,
    user(ALICE),
    `${REMINDER_ACTIONS.QUICK}:10m:${nonce}`,
  );
  await press(input, action);

  const listed = await listPending(db, ALICE);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.body, "Проверить сервер");
  assert.equal(listed[0]?.dueAt.toISOString(), "2026-09-19T09:10:00.000Z");

  // §2: the question is replaced by its answer rather than followed by one.
  assert.equal(bot.edited.length, 1);
  assert.match(bot.edited[0]?.text ?? "", /Напомню сегодня в 12:10 — Проверить сервер/);
  assert.equal(await readPendingPrompt(db, CHAT, ALICE, time.now()), null, "the draft is closed");
});

test("a quick button from a superseded keyboard is refused", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);

  await runCommand(commandContext(ctx, user(ALICE), "remind", "Первое"));
  const stale = parseCallbackData(
    bot.sent[0]?.keyboard?.rows[0]?.[0] && "callbackData" in bot.sent[0].keyboard.rows[0][0]
      ? bot.sent[0].keyboard.rows[0][0].callbackData
      : "",
  ).args[1];

  // A second draft replaces the first; the first keyboard is still on screen.
  await runCommand(commandContext(ctx, user(ALICE), "remind", "Второе"));

  const { action, input } = callbackContext(
    ctx,
    user(ALICE),
    `${REMINDER_ACTIONS.QUICK}:10m:${stale}`,
  );
  await press(input, action);

  assert.equal(bot.answers.at(-1)?.text, "Это предложение больше не действует");
  assert.equal(
    (await listPending(db, ALICE)).length,
    0,
    "an old button did not quietly schedule the new draft's text",
  );
});

test("«Сегодня вечером» pressed after the evening says so rather than rolling forward", async () => {
  await reset();
  const time = clock("2026-09-19T20:00:00.000Z"); // 23:00 Moscow
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);

  await runCommand(commandContext(ctx, user(ALICE), "remind", "Проверить"));
  const nonce = parseCallbackData(
    bot.sent[0]?.keyboard?.rows[0]?.[0] && "callbackData" in bot.sent[0].keyboard.rows[0][0]
      ? bot.sent[0].keyboard.rows[0][0].callbackData
      : "",
  ).args[1];

  const { action, input } = callbackContext(
    ctx,
    user(ALICE),
    `${REMINDER_ACTIONS.QUICK}:eve:${nonce}`,
  );
  await press(input, action);

  assert.match(bot.answers.at(-1)?.text ?? "", /уже прошло/);
  assert.equal((await listPending(db, ALICE)).length, 0);
});

// ---------------------------------------------------------------------------
// «Указать дату»
// ---------------------------------------------------------------------------

test("«Указать дату» waits for the next message and then schedules it", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);

  await runCommand(commandContext(ctx, user(ALICE), "remind", "Забрать посылку"));
  const nonce = parseCallbackData(
    bot.sent[0]?.keyboard?.rows[0]?.[0] && "callbackData" in bot.sent[0].keyboard.rows[0][0]
      ? bot.sent[0].keyboard.rows[0][0].callbackData
      : "",
  ).args[1];

  const pick = callbackContext(ctx, user(ALICE), `${REMINDER_ACTIONS.PICK_DATE}:${nonce}`);
  await press(pick.input, pick.action);
  assert.match(bot.edited[0]?.text ?? "", /Пришлите дату и время/);
  assert.equal((await readPendingPrompt(db, CHAT, ALICE, time.now()))?.kind, "reminder_date");

  const claimed = await feature.onMessage?.(
    messageContext(ctx, user(ALICE), "05.10 18:00"),
    TEXT_CLASSIFICATION,
  );
  assert.equal(claimed, true, "the answer was taken by the feature that asked the question");

  const listed = await listPending(db, ALICE);
  assert.equal(listed[0]?.body, "Забрать посылку");
  assert.equal(listed[0]?.dueAt.toISOString(), "2026-10-05T15:00:00.000Z");
});

test("a mistyped date keeps the question open", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);

  await runCommand(commandContext(ctx, user(ALICE), "remind", "Забрать посылку"));
  const nonce = parseCallbackData(
    bot.sent[0]?.keyboard?.rows[0]?.[0] && "callbackData" in bot.sent[0].keyboard.rows[0][0]
      ? bot.sent[0].keyboard.rows[0][0].callbackData
      : "",
  ).args[1];
  const pick = callbackContext(ctx, user(ALICE), `${REMINDER_ACTIONS.PICK_DATE}:${nonce}`);
  await press(pick.input, pick.action);

  const claimed = await feature.onMessage?.(
    messageContext(ctx, user(ALICE), "31.02 10:00"),
    TEXT_CLASSIFICATION,
  );
  assert.equal(claimed, true);
  assert.match(bot.sent.at(-1)?.text ?? "", /Такой даты не бывает/);
  // Still waiting: a second attempt must not be filed away as a note.
  assert.equal((await readPendingPrompt(db, CHAT, ALICE, time.now()))?.kind, "reminder_date");

  await feature.onMessage?.(messageContext(ctx, user(ALICE), "завтра 09:30"), TEXT_CLASSIFICATION);
  assert.equal((await listPending(db, ALICE))[0]?.dueAt.toISOString(), "2026-09-20T06:30:00.000Z");
});

test("an answer that retypes the text uses the new text", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);

  await runCommand(commandContext(ctx, user(ALICE), "remind", "Старый текст"));
  const nonce = parseCallbackData(
    bot.sent[0]?.keyboard?.rows[0]?.[0] && "callbackData" in bot.sent[0].keyboard.rows[0][0]
      ? bot.sent[0].keyboard.rows[0][0].callbackData
      : "",
  ).args[1];
  const pick = callbackContext(ctx, user(ALICE), `${REMINDER_ACTIONS.PICK_DATE}:${nonce}`);
  await press(pick.input, pick.action);

  await feature.onMessage?.(
    messageContext(ctx, user(ALICE), "завтра 09:30 Новый текст"),
    TEXT_CLASSIFICATION,
  );
  assert.equal((await listPending(db, ALICE))[0]?.body, "Новый текст");
});

test("an ordinary message is left for the inbox", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const ctx = appContext(fakeBot(), time.now);
  // Nobody was asked anything, so nothing here is an answer. Returning true
  // would silently swallow every message the bot receives.
  const claimed = await feature.onMessage?.(
    messageContext(ctx, user(ALICE), "просто заметка"),
    TEXT_CLASSIFICATION,
  );
  assert.equal(claimed, false);
});

// ---------------------------------------------------------------------------
// The inbox's «Напомнить»
// ---------------------------------------------------------------------------

test("remind.from reads the candidate as the presser and refuses somebody else's", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);

  const candidateId = await rememberCandidate(db, {
    ownerId: ALICE,
    chatId: CHAT,
    sourceMessageId: "m-1",
    kind: "text",
    content: "Позвонить в банк",
  });

  const forged = callbackContext(
    ctx,
    user(MALLORY),
    `${REMINDER_ACTIONS.REMIND_FROM}:${candidateId}`,
  );
  await press(forged.input, forged.action);
  assert.equal(bot.answers.at(-1)?.text, "Это предложение больше не действует");
  assert.equal(bot.edited.length, 0);
  assert.equal(await readPendingPrompt(db, CHAT, MALLORY, time.now()), null);

  const owned = callbackContext(ctx, user(ALICE), `${REMINDER_ACTIONS.REMIND_FROM}:${candidateId}`);
  await press(owned.input, owned.action);
  assert.match(bot.edited.at(-1)?.text ?? "", /Когда напомнить\?\nПозвонить в банк/);
  const prompt = await readPendingPrompt(db, CHAT, ALICE, time.now());
  // The candidate's id, not a copy of its text: the owner check runs again at
  // the moment the quick button is pressed rather than being trusted from now.
  assert.equal((prompt?.context as { candidateId?: string }).candidateId, candidateId);
});

test("a reminder made from an inbox candidate carries the candidate's text", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);
  const candidateId = await rememberCandidate(db, {
    ownerId: ALICE,
    chatId: CHAT,
    sourceMessageId: "m-1",
    kind: "text",
    content: "Позвонить в банк",
  });

  const open = callbackContext(ctx, user(ALICE), `${REMINDER_ACTIONS.REMIND_FROM}:${candidateId}`);
  await press(open.input, open.action);
  const nonce = parseCallbackData(
    bot.edited[0]?.keyboard?.rows[0]?.[0] && "callbackData" in bot.edited[0].keyboard.rows[0][0]
      ? bot.edited[0].keyboard.rows[0][0].callbackData
      : "",
  ).args[1];

  const quick = callbackContext(ctx, user(ALICE), `${REMINDER_ACTIONS.QUICK}:1h:${nonce}`);
  await press(quick.input, quick.action);

  const listed = await listPending(db, ALICE);
  assert.equal(listed[0]?.body, "Позвонить в банк");
  assert.equal(listed[0]?.dueAt.toISOString(), "2026-09-19T10:00:00.000Z");
});

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

test("/reminders lists them and rem.list draws the same thing in place", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);
  await createReminder(db, {
    ownerId: ALICE,
    chatId: CHAT,
    body: "Проверить сервер",
    dueAt: new Date("2026-09-19T16:00:00.000Z"),
  });

  await runCommand(commandContext(ctx, user(ALICE), "reminders", ""));
  const sent = bot.sent[0]?.text ?? "";
  assert.match(sent, /Напоминания \(1\)/);
  assert.match(sent, /1\. сегодня в 19:00 — Проверить сервер/);

  // `/start` draws a «Напоминания» button; it must replace the message it is
  // on rather than start a second conversation below it (§2).
  const { action, input } = callbackContext(ctx, user(ALICE), REMINDER_ACTIONS.LIST);
  await press(input, action);
  assert.equal(bot.edited.length, 1);
  assert.equal(bot.edited[0]?.text, sent);
  assert.equal(bot.edited[0]?.messageId, "bot-msg-1");
});

test("an empty list says what to type, and offers no buttons", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);
  await runCommand(commandContext(ctx, user(ALICE), "reminders", ""));
  assert.match(bot.sent[0]?.text ?? "", /Пока нет напоминаний/);
  assert.equal(bot.sent[0]?.keyboard, undefined);
});

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------

async function dueReminder(nowMs: number, body = "Проверить сервер"): Promise<Reminder> {
  return createReminder(db, {
    ownerId: ALICE,
    chatId: CHAT,
    body,
    dueAt: new Date(nowMs - 1000),
  });
}

test("a due reminder is sent with its three buttons and recorded as fired", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);
  const reminder = await dueReminder(time.now().getTime());

  const outcome = await deliverDue(ctx);
  assert.deepEqual(outcome, { claimed: 1, fired: 1, released: 0, abandoned: 0 });

  assert.equal(bot.sent[0]?.text, "⏰ Проверить сервер");
  assert.deepEqual(
    (bot.sent[0]?.keyboard?.rows ?? []).flat().map((entry) => entry.text),
    ["Выполнено", "+10 минут", "+1 час"],
  );

  const row = await rowOf(reminder.id);
  assert.equal(row.state, "fired");
  // The id of the message it went into, so «Выполнено» can edit that message
  // rather than adding a line under it.
  assert.equal(row.fired_message_id, "sent-1");
});

test("two passes over the same due reminder send it once", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);
  await dueReminder(time.now().getTime());

  await deliverDue(ctx);
  await deliverDue(ctx);
  assert.equal(bot.sent.length, 1, "the claim, not the state, is what stops the second send");
});

test("a delivery that may yet succeed is retried on the next pass", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);
  const reminder = await dueReminder(time.now().getTime());

  bot.failSendWith = new TransportError({ code: "rate_limited", message: "slow down", status: 429 });
  const first = await deliverDue(ctx);
  assert.deepEqual(first, { claimed: 1, fired: 0, released: 1, abandoned: 0 });
  assert.equal((await rowOf(reminder.id)).state, "pending");
  assert.equal((await rowOf(reminder.id)).claim_token, null, "the claim went back immediately");

  const second = await deliverDue(ctx);
  assert.equal(second.fired, 1);
  assert.equal(bot.sent.length, 1);
});

test("a delivery that can never succeed is abandoned rather than retried for ever", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);
  const reminder = await dueReminder(time.now().getTime());

  // The bot was removed from the chat. The schema has no attempt counter, so
  // releasing the claim would hand this row to every tick from now on.
  bot.failSendWith = new TransportError({
    code: "bot_chat_forbidden",
    message: "forbidden",
    status: 403,
  });
  const outcome = await deliverDue(ctx);
  assert.deepEqual(outcome, { claimed: 1, fired: 0, released: 0, abandoned: 1 });
  assert.equal((await rowOf(reminder.id)).state, "cancelled");
  assert.equal((await deliverDue(ctx)).claimed, 0);
});

test("a pass that is aborted mid-way hands its remaining claims straight back", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);
  await dueReminder(time.now().getTime(), "Первое");
  await dueReminder(time.now().getTime(), "Второе");

  const controller = new AbortController();
  controller.abort();
  const outcome = await deliverDue(ctx, { signal: controller.signal });
  assert.equal(outcome.claimed, 2);
  assert.equal(outcome.fired, 0);
  assert.equal(outcome.released, 2, "nothing waits out the claim TTL because of a deploy");
  assert.equal((await deliverDue(ctx)).fired, 2);
});

test("«Выполнено» rewrites the fired message and takes its buttons away", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);
  const reminder = await dueReminder(time.now().getTime());
  await deliverDue(ctx);

  const { action, input } = callbackContext(
    ctx,
    user(ALICE),
    `${REMINDER_ACTIONS.DONE}:${reminder.id}`,
    "sent-1",
  );
  await press(input, action);

  assert.equal(bot.sent.length, 1, "nothing new was sent");
  assert.equal(bot.edited.length, 1);
  assert.equal(bot.edited[0]?.messageId, "sent-1");
  assert.equal(bot.edited[0]?.text, "✅ Проверить сервер");
  // An edit carrying no `reply_markup` clears the platform's stored markup, so
  // this is what stops a finished reminder offering to be finished again.
  assert.equal(bot.edited[0]?.keyboard, undefined);
  assert.equal((await rowOf(reminder.id)).state, "done");
});

test("«+10 минут» moves it, counts the snooze, and rewrites the message in place", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);
  const reminder = await dueReminder(time.now().getTime());
  await deliverDue(ctx);

  const { action, input } = callbackContext(
    ctx,
    user(ALICE),
    `${REMINDER_ACTIONS.SNOOZE}:${reminder.id}:10`,
    "sent-1",
  );
  await press(input, action);

  const row = await rowOf(reminder.id);
  assert.equal(row.state, "pending");
  assert.equal(row.snooze_count, 1);
  assert.equal(new Date(row.due_at as string).toISOString(), "2026-09-19T09:10:00.000Z");
  // The message that now reads «отложено» is no longer the reminder, so the
  // next firing must send a new one rather than overwrite a read line.
  assert.equal(row.fired_message_id, null);

  assert.equal(bot.edited[0]?.messageId, "sent-1");
  assert.match(bot.edited[0]?.text ?? "", /⏰ Проверить сервер\nОтложено до сегодня в 12:10/);
  assert.equal(bot.edited[0]?.keyboard, undefined);

  // And it really does come back round.
  time.advance(11 * 60_000);
  assert.equal((await deliverDue(ctx)).fired, 1);
  assert.equal(bot.sent.length, 2);
});

test("«Отменить» removes it and redraws the list", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);
  const reminder = await createReminder(db, {
    ownerId: ALICE,
    chatId: CHAT,
    body: "Проверить",
    dueAt: new Date(time.now().getTime() + 3_600_000),
  });

  const { action, input } = callbackContext(
    ctx,
    user(ALICE),
    `${REMINDER_ACTIONS.CANCEL}:${reminder.id}`,
  );
  await press(input, action);

  assert.equal((await rowOf(reminder.id)).state, "cancelled");
  assert.equal(bot.answers[0]?.text, "Отменено");
  assert.match(bot.edited[0]?.text ?? "", /Пока нет напоминаний/);
  assert.equal((await claimDue(db, { now: new Date("2027-01-01T00:00:00Z"), claimToken: randomUUID() })).length, 0);
});

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

test("the scheduler job delivers and tidies, and holds no state of its own", async () => {
  await reset();
  const time = clock("2026-09-19T09:00:00.000Z");
  const bot = fakeBot();
  const ctx = appContext(bot, time.now);
  await dueReminder(time.now().getTime());
  // An abandoned conversation from an hour ago.
  await pg.query(
    "insert into pf_pending_prompts (chat_id, user_id, kind, expires_at) values ($1, $2, $3, $4)",
    [CHAT, MALLORY, "reminder_date", new Date(time.now().getTime() - 3_600_000)],
  );

  const job = createRemindersJob(ctx, { intervalMs: 1000 });
  assert.equal(job.name, "reminders");
  await job.run({ signal: new AbortController().signal, now: time.now() });

  assert.equal(bot.sent.length, 1);
  const prompts = await pg.query("select count(*)::int as c from pf_pending_prompts");
  assert.equal((prompts.rows[0] as { c: number }).c, 0, "the expired prompt was swept up");

  // A brand-new job object over the same database picks up exactly where the
  // last one left off, because nothing about the schedule lives in the object.
  const replacement = createRemindersJob(appContext(bot, time.now));
  await replacement.run({ signal: new AbortController().signal, now: time.now() });
  assert.equal(bot.sent.length, 1, "nothing was re-sent");
});
