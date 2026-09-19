/**
 * The background loop.
 *
 * Every test here drives `tick()` — the same function the timer calls — rather
 * than installing a fake timer and waiting. A test built on a fake timer
 * mostly proves the fake works; a test that calls the pass proves the pass
 * does, and it cannot be flaky.
 *
 * The one thing only real time can show is that `start()` actually schedules
 * anything, so `schedule` is injected and the test fires the callback by hand.
 * That is the boundary: the scheduler's arithmetic is tested, and Node's
 * `setTimeout` is not.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createLogger } from "../../artifacts/pocketflow/src/lib/logger.ts";
import {
  createScheduler,
  type SchedulerJob,
  type Timer,
} from "../../artifacts/pocketflow/src/scheduler/index.ts";

const silent = createLogger({ write: () => undefined });

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

/** A clock the test moves by hand. */
function clock(startIso: string): { now: () => Date; advance: (ms: number) => void } {
  let current = new Date(startIso).getTime();
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
  };
}

function countingJob(name: string, intervalMs: number): SchedulerJob & { runs: number } {
  const job = {
    name,
    intervalMs,
    runs: 0,
    async run(): Promise<void> {
      job.runs += 1;
    },
  };
  return job;
}

// ---------------------------------------------------------------------------

test("two jobs under one name is refused at registration", () => {
  const scheduler = createScheduler({ log: silent });
  scheduler.registerJob(countingJob("reminders", 1000));
  assert.throws(
    () => scheduler.registerJob(countingJob("reminders", 5000)),
    /registered twice/,
  );
  // The reminders job and the watcher job are registered by different files.
  // Discovering a collision at construction is the difference between a
  // startup error and «the watcher sometimes does not run».
});

test("an interval that is not a positive number is refused", () => {
  const scheduler = createScheduler({ log: silent });
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => scheduler.registerJob({ name: `job-${bad}`, intervalMs: bad, run: async () => {} }),
      /positive intervalMs/,
    );
  }
});

test("a job that has never run is due immediately — which is what survives a restart", async () => {
  // The scheduler keeps no durable state. A fresh process has no record of
  // when anything last ran, so everything is due at once and each job asks
  // Postgres what is outstanding. If «last run» were persisted and honoured, a
  // deploy at 18:00:05 would skip an 18:00 reminder entirely.
  const time = clock("2026-09-19T09:00:00.000Z");
  const scheduler = createScheduler({ log: silent, now: time.now });
  const job = countingJob("reminders", 30_000);
  scheduler.registerJob(job);

  await scheduler.tick();
  assert.equal(job.runs, 1);
});

test("a job runs on its interval and not before", async () => {
  const time = clock("2026-09-19T09:00:00.000Z");
  const scheduler = createScheduler({ log: silent, now: time.now });
  const job = countingJob("reminders", 30_000);
  scheduler.registerJob(job);

  await scheduler.tick();
  assert.equal(job.runs, 1);

  time.advance(29_000);
  await scheduler.tick();
  assert.equal(job.runs, 1, "not due yet");

  time.advance(1_000);
  await scheduler.tick();
  assert.equal(job.runs, 2, "due exactly on the interval");
});

test("a run still in flight is not started a second time", async () => {
  // Without this, a tick during a slow database query starts a second pass
  // over the same claimed rows. For reminders that is a double send; for a
  // watcher it is a duplicate notification. The overlap guard is the only
  // thing preventing it, since both jobs are idempotent only per claim.
  const time = clock("2026-09-19T09:00:00.000Z");
  const scheduler = createScheduler({ log: silent, now: time.now });
  const gate = deferred();
  let starts = 0;
  scheduler.registerJob({
    name: "slow",
    intervalMs: 1_000,
    async run() {
      starts += 1;
      await gate.promise;
    },
  });

  const first = scheduler.tick();
  assert.equal(starts, 1);

  time.advance(60_000);
  // Started and **not awaited**, on purpose. Awaiting it would deadlock if the
  // overlap guard were ever removed — the second run would block on the same
  // gate this test only opens afterwards — and a deadlocked test is a test
  // that reports nothing. `run` increments `starts` before its first await, so
  // the assertion below is already decided by the time we reach it.
  const second = scheduler.tick();
  assert.equal(starts, 1, "the second tick found the job already running");

  gate.resolve();
  await Promise.all([first, second]);

  time.advance(60_000);
  await scheduler.tick();
  assert.equal(starts, 2, "and runs again once it is free");
});

test("a job that throws is counted, and its sibling still runs", async () => {
  const time = clock("2026-09-19T09:00:00.000Z");
  const lines: string[] = [];
  const scheduler = createScheduler({
    log: createLogger({ write: (line) => lines.push(line) }),
    now: time.now,
  });
  const healthy = countingJob("reminders", 1_000);
  scheduler.registerJob({
    name: "watcher",
    intervalMs: 1_000,
    async run() {
      throw new Error("the network is down");
    },
  });
  scheduler.registerJob(healthy);

  // Must not reject: a throw that reached the timer would stop every job.
  await scheduler.tick();

  assert.equal(healthy.runs, 1, "the failure did not take the sibling with it");
  const status = scheduler.status();
  const watcher = status.find((entry) => entry.name === "watcher");
  assert.equal(watcher?.failures, 1);
  assert.equal(watcher?.lastError, "the network is down");
  assert.equal(status.find((entry) => entry.name === "reminders")?.failures, 0);
  assert.ok(
    lines.some((line) => line.includes("job.failed") && line.includes("watcher")),
    "the failure was said out loud",
  );
});

test("a job recovers: lastError is cleared by the next good run", async () => {
  const time = clock("2026-09-19T09:00:00.000Z");
  const scheduler = createScheduler({ log: silent, now: time.now });
  let shouldFail = true;
  scheduler.registerJob({
    name: "watcher",
    intervalMs: 1_000,
    async run() {
      if (shouldFail) throw new Error("boom");
    },
  });

  await scheduler.tick();
  assert.equal(scheduler.status()[0]?.lastError, "boom");

  shouldFail = false;
  time.advance(1_000);
  await scheduler.tick();
  assert.equal(scheduler.status()[0]?.lastError, null);
  assert.equal(scheduler.status()[0]?.failures, 1, "the count is kept even though the error cleared");
});

test("stop aborts the signal the running job holds, and waits for it", async () => {
  const time = clock("2026-09-19T09:00:00.000Z");
  const scheduler = createScheduler({ log: silent, now: time.now });
  const gate = deferred();
  let sawAbort = false;
  let finished = false;
  scheduler.registerJob({
    name: "reminders",
    intervalMs: 1_000,
    async run({ signal }) {
      signal.addEventListener("abort", () => {
        sawAbort = true;
      });
      await gate.promise;
      finished = true;
    },
  });

  scheduler.start();
  const running = scheduler.tick();

  const stopping = scheduler.stop({ timeoutMs: 1_000 });
  assert.equal(sawAbort, true, "the job was told to stop");
  assert.equal(finished, false, "and stop has not resolved while it is still going");

  gate.resolve();
  const drained = await stopping;
  await running;
  assert.equal(finished, true);
  assert.equal(drained, true, "a clean shutdown reports that it drained");
});

test("stop is bounded: a job that ignores the abort does not hold shutdown for ever", async () => {
  const time = clock("2026-09-19T09:00:00.000Z");
  const scheduler = createScheduler({ log: silent, now: time.now });
  const gate = deferred();
  scheduler.registerJob({
    name: "wedged",
    intervalMs: 1_000,
    async run() {
      await gate.promise;
    },
  });

  scheduler.start();
  const running = scheduler.tick();
  const drained = await scheduler.stop({ timeoutMs: 20 });
  assert.equal(drained, false, "the caller is told the shutdown was not clean");

  // Let the process go: the point was the bound, not a leaked promise.
  gate.resolve();
  await running;
});

test("stopping and starting again hands the jobs a live signal", async () => {
  // A scheduler restarted in the same process — which is how `/selftest` and a
  // configuration reload would work — must not give its jobs a signal that is
  // already aborted, or every job would abandon its first pass for ever.
  const time = clock("2026-09-19T09:00:00.000Z");
  const scheduler = createScheduler({ log: silent, now: time.now });
  const seen: boolean[] = [];
  scheduler.registerJob({
    name: "reminders",
    intervalMs: 1_000,
    async run({ signal }) {
      seen.push(signal.aborted);
    },
  });

  scheduler.start();
  await scheduler.tick();
  assert.equal(await scheduler.stop(), true);

  scheduler.start();
  time.advance(60_000);
  await scheduler.tick();
  await scheduler.stop();

  assert.deepEqual(seen, [false, false]);
});

test("start schedules a repeating pass at the shortest interval, clamped", async () => {
  const time = clock("2026-09-19T09:00:00.000Z");
  const delays: number[] = [];
  let pending: (() => void) | null = null;
  const schedule = (fn: () => void, delayMs: number): Timer => {
    delays.push(delayMs);
    pending = fn;
    return { cancel: () => { pending = null; } };
  };

  const scheduler = createScheduler({
    log: silent,
    now: time.now,
    schedule,
    minTickMs: 100,
    maxTickMs: 10_000,
  });
  const fast = countingJob("reminders", 500);
  scheduler.registerJob(fast);
  scheduler.registerJob(countingJob("watcher", 60_000));

  scheduler.start();
  assert.deepEqual(delays, [500], "the loop runs as often as the most frequent job needs");

  // Fire the timer by hand and let the pass settle.
  const fire = pending;
  assert.ok(fire, "start armed a timer");
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fast.runs, 1);
  assert.equal(delays.length, 2, "the loop re-armed itself after the pass");
  await scheduler.stop();
  assert.equal(pending, null, "and stop cancelled the outstanding timer");
});

test("the tick period is clamped at both ends", () => {
  const delays: number[] = [];
  const make = (intervalMs: number) => {
    const scheduler = createScheduler({
      log: silent,
      schedule: (_fn, delayMs) => {
        delays.push(delayMs);
        return { cancel: () => undefined };
      },
      minTickMs: 250,
      maxTickMs: 60_000,
    });
    scheduler.registerJob(countingJob("job", intervalMs));
    scheduler.start();
    return scheduler;
  };
  make(1).stop();
  make(3_600_000).stop();
  assert.deepEqual(delays, [250, 60_000]);
});

test("a job registered after start is picked up by the next pass", async () => {
  // The composition root registers reminders and the watcher from different
  // modules; requiring both before `start()` would be a hidden ordering rule.
  const time = clock("2026-09-19T09:00:00.000Z");
  const scheduler = createScheduler({ log: silent, now: time.now });
  scheduler.start();
  const late = countingJob("watcher", 1_000);
  scheduler.registerJob(late);
  await scheduler.tick();
  assert.equal(late.runs, 1);
  await scheduler.stop();
});
