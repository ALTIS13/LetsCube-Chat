import assert from "node:assert/strict";
import test from "node:test";

import { createAsyncAction } from "../../artifacts/kub/src/lib/asyncAction.ts";

/**
 * The state a control passes through while it is doing something.
 *
 * Two things go wrong when this is written ad hoc at each call site, and both
 * are in the product today: the control changes size between "Сохранить" and
 * "Сохранение…", so the row jumps under the pointer at the moment someone is
 * about to click something else; and the success timer is left running when a
 * second action starts, so the button flickers back to a stale tick.
 *
 * The machine is driven by injected timers, so the order of states can be
 * asserted without waiting for real time — and so a leaked timer is visible as
 * a fact rather than as an intermittent failure.
 */

function fakeTimers() {
  let sequence = 0;
  const pending = new Map<number, { fn: () => void; at: number }>();
  let clock = 0;
  return {
    api: {
      set(fn: () => void, ms: number) {
        const id = ++sequence;
        pending.set(id, { fn, at: clock + ms });
        return id;
      },
      clear(id: number) {
        pending.delete(id);
      },
    },
    advance(ms: number) {
      clock += ms;
      for (const [id, entry] of [...pending]) {
        if (entry.at <= clock) {
          pending.delete(id);
          entry.fn();
        }
      }
    },
    outstanding: () => pending.size,
  };
}

test("a successful action goes idle → loading → success → idle", async () => {
  const timers = fakeTimers();
  const action = createAsyncAction(timers.api);
  const seen: string[] = [action.phase()];
  action.subscribe(() => seen.push(action.phase()));

  await action.run(async () => "ok");
  assert.equal(action.phase(), "success");

  timers.advance(2400);
  assert.equal(action.phase(), "idle");
  assert.deepEqual(seen, ["idle", "loading", "success", "idle"]);
});

test("a failed action ends in error and stays there until the next attempt", async () => {
  const timers = fakeTimers();
  const action = createAsyncAction(timers.api);

  const ok = await action.run(async () => {
    throw new Error("нет сети");
  });
  assert.equal(ok, false);
  assert.equal(action.phase(), "error");

  // An error is not cleared by a timer: it is the state a person has to see,
  // and it goes when they try again.
  timers.advance(60_000);
  assert.equal(action.phase(), "error");

  await action.run(async () => "ok");
  assert.equal(action.phase(), "success");
});

test("a second action cancels the first one's success timer", async () => {
  const timers = fakeTimers();
  const action = createAsyncAction(timers.api);

  await action.run(async () => "ok");
  assert.equal(timers.outstanding(), 1);

  await action.run(async () => "ok");
  assert.equal(
    timers.outstanding(),
    1,
    "the stale timer must be cleared, or the button flickers back to an old tick",
  );

  timers.advance(2400);
  assert.equal(action.phase(), "idle");
  assert.equal(timers.outstanding(), 0);
});

test("disposal clears whatever is still pending", async () => {
  const timers = fakeTimers();
  const action = createAsyncAction(timers.api);
  await action.run(async () => "ok");
  assert.equal(timers.outstanding(), 1);

  action.dispose();
  assert.equal(timers.outstanding(), 0, "a timer surviving unmount sets state on a dead component");
});

test("reduced motion changes the duration and nothing else", async () => {
  const timers = fakeTimers();
  const action = createAsyncAction(timers.api, { reducedMotion: true });
  const seen: string[] = [action.phase()];
  action.subscribe(() => seen.push(action.phase()));

  await action.run(async () => "ok");
  timers.advance(1600);
  assert.equal(action.phase(), "idle");
  assert.deepEqual(seen, ["idle", "loading", "success", "idle"], "the order is not a motion setting");
});

test("a success does not clear early under the full duration", async () => {
  const timers = fakeTimers();
  const action = createAsyncAction(timers.api);
  await action.run(async () => "ok");
  timers.advance(2399);
  assert.equal(action.phase(), "success");
});

test("the result of the task is passed back to the caller", async () => {
  const timers = fakeTimers();
  const action = createAsyncAction(timers.api);
  let ran = false;
  const ok = await action.run(async () => {
    ran = true;
  });
  assert.equal(ran, true);
  assert.equal(ok, true);
});

test("a second run while one is in flight is refused rather than queued", async () => {
  const timers = fakeTimers();
  const action = createAsyncAction(timers.api);

  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const first = action.run(async () => { await held; });

  // Double-clicking a save button must not send two saves.
  const second = await action.run(async () => "second");
  assert.equal(second, false);
  assert.equal(action.phase(), "loading");

  release();
  await first;
  assert.equal(action.phase(), "success");
});
