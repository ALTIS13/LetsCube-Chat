import assert from "node:assert/strict";
import test from "node:test";

import {
  RETRY_DELAYS_MS,
  classifySendFailure,
  entriesToSend,
  retryDelay,
  type OutboxEntry,
} from "../../artifacts/kub/src/lib/outbox/outboxRules.ts";
import { memoryOutboxStorage } from "../../artifacts/kub/src/lib/outbox/outboxStorage.ts";
import { createOutboxRunner, type SendAttempt } from "../../artifacts/kub/src/lib/outbox/outboxRunner.ts";

/**
 * Tracker item 52. Two testers, first day: a message written without a
 * connection turned red at once and was gone after a restart; a voice note had
 * to be recorded again — «прям сильно пользовательский опыт погубило».
 * Telegram's mechanic: a clock while it waits, kept on the device, sent by
 * itself and in order when the connection returns, red only for a refusal.
 */

const ME = "11111111-1111-4111-8111-000000000001";
const OTHER = "11111111-1111-4111-8111-000000000002";
const CHAT = "22222222-2222-4222-8222-000000000001";
const CHAT_2 = "22222222-2222-4222-8222-000000000002";

function entry(id: string, overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    clientMessageId: id,
    userId: ME,
    chatId: CHAT,
    topicId: null,
    type: "text",
    content: `текст ${id}`,
    replyToId: null,
    forwardedFromId: null,
    mediaBucket: null,
    mediaPath: null,
    mediaUrl: null,
    clientSentAt: `2026-09-28T09:00:0${id.slice(-1)}.000Z`,
    tempId: `tmp:${id}`,
    attempts: 0,
    nextAttemptAt: 0,
    ...overrides,
  };
}

// ── rules ───────────────────────────────────────────────────────────────────

test("no answer is the network's; an answer that says no is a refusal", () => {
  // What PostgREST's client reports for a fetch that failed.
  assert.equal(classifySendFailure({ status: 0, error: { message: "TypeError: Failed to fetch" } }), "unanswered");
  assert.equal(classifySendFailure({ error: new TypeError("Failed to fetch") }), "unanswered");
  assert.equal(classifySendFailure({ error: { message: "Load failed" } }), "unanswered", "Safari's words");
  assert.equal(classifySendFailure({ timedOut: true }), "unanswered");
  // A gateway that could not reach the database: the database never saw it.
  for (const status of [502, 503, 504]) assert.equal(classifySendFailure({ status }), "unanswered", String(status));
  // The server answered and said no: waiting will not change that.
  assert.equal(classifySendFailure({ status: 403, error: { message: "new row violates row-level security policy" } }), "refused");
  assert.equal(classifySendFailure({ status: 400, error: { message: "invalid input" } }), "refused");
  assert.equal(classifySendFailure({ error: { message: "user_muted" } }), "refused");
});

test("the waits grow and then settle at a minute", () => {
  assert.equal(retryDelay(1), RETRY_DELAYS_MS[0]);
  assert.equal(retryDelay(2), RETRY_DELAYS_MS[1]);
  assert.equal(retryDelay(99), 60_000);
});

test("messages go in the order they were written, and never past an earlier one of the same chat", () => {
  const a1 = entry("a1");
  const a2 = entry("a2");
  const b1 = entry("b1", { chatId: CHAT_2 });
  assert.deepEqual(entriesToSend([a2, b1, a1], 0, new Set()).map((e) => e.clientMessageId), ["a1", "b1"]);
  // The first of a chat is out: its successor waits, another chat does not.
  assert.deepEqual(entriesToSend([a1, a2, b1], 0, new Set(["a1"])).map((e) => e.clientMessageId), ["b1"]);
  // The first of a chat is not due yet: nothing of that chat goes.
  assert.deepEqual(entriesToSend([{ ...a1, nextAttemptAt: 10 }, a2], 5, new Set()), []);
});

// ── the runner ──────────────────────────────────────────────────────────────

type Row = { id: string; client_message_id: string };

function harness(answers: Array<"sent" | "unanswered" | "refused"> = []) {
  const storage = memoryOutboxStorage();
  const log: string[] = [];
  let clock = 0;
  let timer: (() => void) | null = null;
  const queue = [...answers];
  const runner = createOutboxRunner<Row>({
    storage,
    send: async (e): Promise<SendAttempt<Row>> => {
      const answer = queue.shift() ?? "sent";
      log.push(`send ${e.clientMessageId}`);
      if (answer === "sent") return { sent: { id: `srv-${e.clientMessageId}`, client_message_id: e.clientMessageId } };
      if (answer === "unanswered") return { failed: { status: 0, error: { message: "TypeError: Failed to fetch" } } };
      return { failed: { status: 403, error: { message: "row-level security" } } };
    },
    onSent: (e, row) => log.push(`sent ${e.clientMessageId} as ${row.id}`),
    onWaiting: (e) => log.push(`waiting ${e.clientMessageId} after ${e.attempts}`),
    onRefused: (e) => log.push(`refused ${e.clientMessageId}`),
    now: () => clock,
    timers: {
      set: (run) => {
        timer = run;
        return run;
      },
      clear: () => {
        timer = null;
      },
    },
  });
  const tick = async (ms: number) => {
    clock += ms;
    const run = timer;
    timer = null;
    run?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { runner, storage, log, tick };
}

test("a message is kept on the device before its first attempt, and let go once the server has it", async () => {
  const { runner, storage, log } = harness(["sent"]);
  await runner.start(ME);
  const outcome = await runner.enqueue(entry("m1"));
  assert.equal(outcome.kind, "sent");
  assert.deepEqual(log, ["send m1", "sent m1 as srv-m1"]);
  assert.deepEqual(await storage.list(ME), []);
});

test("offline, the message waits with its clock, stays on the device, and goes by itself later", async () => {
  const { runner, storage, log, tick } = harness(["unanswered", "sent"]);
  await runner.start(ME);
  const outcome = await runner.enqueue(entry("m1"));
  assert.equal(outcome.kind, "waiting", "an unanswered send was reported as final");
  assert.deepEqual(log, ["send m1", "waiting m1 after 1"]);
  const kept = await storage.list(ME);
  assert.equal(kept.length, 1, "a waiting message is not on the device");
  assert.equal(kept[0].attempts, 1);

  await tick(RETRY_DELAYS_MS[0]);
  assert.deepEqual(log.slice(2), ["send m1", "sent m1 as srv-m1"]);
  assert.deepEqual(await storage.list(ME), []);
});

test("the connection coming back sends at once, without waiting out the backoff", async () => {
  const { runner, log } = harness(["unanswered", "unanswered", "sent"]);
  await runner.start(ME);
  await runner.enqueue(entry("m1"));
  runner.retryNow();
  await new Promise((resolve) => setTimeout(resolve, 0));
  runner.retryNow();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(log.filter((line) => line.startsWith("send ")).length, 3);
  assert.equal(log.at(-1), "sent m1 as srv-m1");
});

test("a refusal is red at once and leaves the outbox — waiting will not change it", async () => {
  const { runner, storage, log } = harness(["refused"]);
  await runner.start(ME);
  const outcome = await runner.enqueue(entry("m1"));
  assert.equal(outcome.kind, "refused");
  assert.deepEqual(log, ["send m1", "refused m1"]);
  assert.deepEqual(await storage.list(ME), []);
});

test("a later message waits behind an earlier one of its chat, and both land in order", async () => {
  const { runner, log, tick } = harness(["unanswered", "sent", "sent"]);
  await runner.start(ME);
  const first = runner.enqueue(entry("m1"));
  const second = runner.enqueue(entry("m2"));
  assert.equal((await first).kind, "waiting");
  // m2 was not sent past the waiting m1.
  assert.ok(!log.includes("send m2"), `m2 overtook m1: ${log.join(", ")}`);
  await tick(RETRY_DELAYS_MS[0]);
  assert.equal((await second).kind, "sent");
  assert.deepEqual(
    log.filter((line) => line.startsWith("sent ")),
    ["sent m1 as srv-m1", "sent m2 as srv-m2"],
  );
});

test("after a restart the waiting messages come back and go by themselves", async () => {
  const storage = memoryOutboxStorage();
  await storage.put(entry("m1", { attempts: 3, nextAttemptAt: 999_999 }));
  await storage.put(entry("x1", { userId: OTHER }));
  const log: string[] = [];
  const runner = createOutboxRunner<Row>({
    storage,
    send: async (e) => {
      log.push(`send ${e.clientMessageId}`);
      return { sent: { id: `srv-${e.clientMessageId}`, client_message_id: e.clientMessageId } };
    },
    onSent: (e) => log.push(`sent ${e.clientMessageId}`),
    onWaiting: () => {},
    onRefused: () => {},
    now: () => 0,
  });
  const restored = await runner.start(ME);
  // Only this account's: another account's waiting messages stay on the device.
  assert.deepEqual(restored.map((e) => e.clientMessageId), ["m1"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  // A restart is itself a moment to try: the old backoff does not hold it.
  assert.deepEqual(log, ["send m1", "sent m1"]);
  assert.deepEqual((await storage.list(OTHER)).map((e) => e.clientMessageId), ["x1"]);
});

test("a waiting message taken off the screen is never sent", async () => {
  const { runner, storage, log, tick } = harness(["unanswered", "sent"]);
  await runner.start(ME);
  await runner.enqueue(entry("m1"));
  await runner.discard("m1");
  await tick(RETRY_DELAYS_MS[0]);
  assert.equal(log.filter((line) => line === "send m1").length, 1, "a discarded message was sent again");
  assert.deepEqual(await storage.list(ME), []);
});
