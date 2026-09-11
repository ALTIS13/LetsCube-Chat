import assert from "node:assert/strict";
import test from "node:test";

import {
  DELIVERED_DEBOUNCE_MS,
  READ_DEBOUNCE_MS,
  createReceiptScheduler,
  type ReceiptRpcClient,
} from "../../artifacts/kub/src/lib/receiptScheduler.ts";
import { createRpcAvailability, isMissingRpcError } from "../../artifacts/kub/src/lib/rpcAvailability.ts";

/**
 * What this device reports as received and read, and when.
 *
 * A read reports the newest message it drew, as the server's own string, to
 * `mark_chat_read_through`; the server keeps the later of that and what it has,
 * so a late report neither moves the pointer back nor marks as read what the
 * device never drew. Where the function is not deployed the report goes to
 * `mark_chat_read`, as before. A failed report is sent again by the next render,
 * which is how a reconnect reconciles.
 */

type Timer = { callback: () => void; ms: number; cancelled: boolean };

function harness(answers: Record<string, unknown | (() => unknown)> = {}) {
  const timers: Timer[] = [];
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const reads: { chatId: string; readUntil: string | null }[] = [];
  const errors: string[] = [];
  const availability = createRpcAvailability({ now: () => 0 });
  const scheduler = createReceiptScheduler({
    setTimer: (callback, ms) => {
      const timer = { callback, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as Timer).cancelled = true;
    },
    now: () => Date.parse("2026-09-11T10:30:00Z"),
    availability,
    isMissingRpc: isMissingRpcError,
    onRead: (detail) => reads.push(detail),
    onError: (name) => errors.push(name),
  });
  const client: ReceiptRpcClient = {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      const answer = answers[fn];
      const error = typeof answer === "function" ? (answer as () => unknown)() : answer;
      return Promise.resolve({ error: error ?? null });
    },
  };
  const live = () => timers.filter((timer) => !timer.cancelled);
  const flush = async () => {
    for (const timer of timers.splice(0)) if (!timer.cancelled) timer.callback();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { scheduler, client, calls, reads, errors, live, flush };
}

const FIRST = "2026-09-11T10:00:00.123456+00:00";
const SECOND = "2026-09-11T10:05:00.000001+00:00";

test("a read reports the newest drawn message's own string, once, after the quiet period", async () => {
  const h = harness();
  h.scheduler.scheduleRead(h.client, "chat", FIRST);
  h.scheduler.scheduleRead(h.client, "chat", SECOND);
  assert.equal(h.live().length, 1, "a second render added a report instead of restarting the wait");
  assert.equal(h.live()[0].ms, READ_DEBOUNCE_MS);
  await h.flush();
  assert.deepEqual(h.calls, [{ fn: "mark_chat_read_through", args: { p_chat_id: "chat", p_read_through: SECOND } }]);
  assert.deepEqual(h.reads, [{ chatId: "chat", readUntil: SECOND }]);
});

test("a stale render reports nothing", async () => {
  const h = harness();
  h.scheduler.scheduleRead(h.client, "chat", SECOND);
  await h.flush();
  h.scheduler.scheduleRead(h.client, "chat", FIRST);
  h.scheduler.scheduleRead(h.client, "chat", SECOND);
  assert.equal(h.live().length, 0);
  await h.flush();
  assert.equal(h.calls.length, 1, "an older or equal watermark was reported again");
});

test("microseconds decide what is newer", async () => {
  const h = harness();
  h.scheduler.scheduleRead(h.client, "chat", "2026-09-11T10:00:00.123100+00:00");
  await h.flush();
  h.scheduler.scheduleRead(h.client, "chat", "2026-09-11T10:00:00.123900+00:00");
  await h.flush();
  assert.equal(h.calls.length, 2, "a message later in the same millisecond was taken for one already read");
  assert.equal(h.calls[1].args.p_read_through, "2026-09-11T10:00:00.123900+00:00");
});

test("where mark_chat_read_through is not deployed the read goes to mark_chat_read, and later reads go there directly", async () => {
  const h = harness({ mark_chat_read_through: { code: "PGRST202", message: "Could not find the function" } });
  h.scheduler.scheduleRead(h.client, "chat", FIRST);
  await h.flush();
  h.scheduler.scheduleRead(h.client, "chat", SECOND);
  await h.flush();
  assert.deepEqual(h.calls.map((call) => call.fn), ["mark_chat_read_through", "mark_chat_read", "mark_chat_read"]);
  assert.deepEqual(h.calls[1].args, { p_chat_id: "chat" });
  assert.equal(h.reads.length, 2);
  assert.deepEqual(h.errors, []);
});

test("a refused read clears its schedule, so the next render reports it again", async () => {
  let refuse = true;
  const h = harness({ mark_chat_read_through: () => (refuse ? { code: "57014", message: "canceling statement" } : null) });
  h.scheduler.scheduleRead(h.client, "chat", FIRST);
  await h.flush();
  assert.deepEqual(h.errors, ["mark_chat_read_through"]);
  assert.equal(h.reads.length, 0);
  refuse = false;
  h.scheduler.scheduleRead(h.client, "chat", FIRST);
  await h.flush();
  assert.equal(h.calls.length, 2, "the same read was not reported again after it failed");
  assert.equal(h.calls[1].fn, "mark_chat_read_through", "a refusal is not a missing function");
  assert.equal(h.reads.length, 1);
});

test("a request that throws is a failure, not an unhandled rejection", async () => {
  const h = harness();
  const offline: ReceiptRpcClient = { rpc: () => Promise.reject(new Error("offline")) };
  h.scheduler.scheduleRead(offline, "chat", FIRST);
  await h.flush();
  assert.deepEqual(h.errors, ["mark_chat_read_through"]);
});

test("delivered keeps its own lane, wait and function", async () => {
  const h = harness();
  h.scheduler.scheduleDelivered(h.client, "chat", FIRST);
  h.scheduler.scheduleRead(h.client, "chat", FIRST);
  assert.deepEqual(h.live().map((timer) => timer.ms).sort((a, b) => a - b), [READ_DEBOUNCE_MS, DELIVERED_DEBOUNCE_MS]);
  await h.flush();
  assert.deepEqual(h.calls.map((call) => call.fn).sort(), ["mark_chat_delivered", "mark_chat_read_through"]);
  assert.deepEqual(h.calls.find((call) => call.fn === "mark_chat_delivered")?.args, { p_chat_id: "chat" });
});

test("a read without a message to date it by asks the server for now, and no chat reports nothing", async () => {
  const h = harness();
  h.scheduler.scheduleRead(h.client, "chat", null);
  h.scheduler.scheduleRead(h.client, null, FIRST);
  await h.flush();
  assert.deepEqual(h.calls, [{ fn: "mark_chat_read_through", args: { p_chat_id: "chat", p_read_through: null } }]);
});
