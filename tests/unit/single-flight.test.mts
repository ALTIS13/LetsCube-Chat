import assert from "node:assert/strict";
import test from "node:test";

import { createSingleFlight } from "../../artifacts/kub/src/lib/singleFlight.ts";

/**
 * The concurrency guard behind the profile load.
 *
 * Its absence was a real, measured defect rather than a tidiness concern: the
 * profile was fetched three times at once on a restored session, and six
 * restores out of ten ended stuck on the loading screen. One request instead of
 * three took that to zero out of ten.
 */

test("concurrent callers for one key share a single run", async () => {
  const flight = createSingleFlight<string>();
  let runs = 0;
  let release: (value: string) => void = () => {};
  const held = new Promise<string>((resolve) => { release = resolve; });

  const operation = () => {
    runs += 1;
    return held;
  };

  const first = flight.run("user-1", operation);
  const second = flight.run("user-1", operation);
  const third = flight.run("user-1", operation);
  assert.equal(runs, 1, "three callers must cost one request, not three");

  release("profile");
  assert.deepEqual(await Promise.all([first, second, third]), ["profile", "profile", "profile"]);
});

test("different keys do not share anything", async () => {
  const flight = createSingleFlight<string>();
  let runs = 0;
  const operation = async () => {
    runs += 1;
    return "ok";
  };
  await Promise.all([flight.run("a", operation), flight.run("b", operation)]);
  assert.equal(runs, 2, "two users are two loads");
});

test("the key is released once the run settles, so it is a guard and not a cache", async () => {
  const flight = createSingleFlight<number>();
  let runs = 0;
  const operation = async () => {
    runs += 1;
    return runs;
  };

  assert.equal(await flight.run("user-1", operation), 1);
  assert.equal(await flight.run("user-1", operation), 2, "the second call must do fresh work");
  assert.equal(flight.size(), 0);
});

test("a failure releases the key too", async () => {
  const flight = createSingleFlight<string>();
  await assert.rejects(
    flight.run("user-1", async () => {
      throw new Error("нет сети");
    }),
  );
  assert.equal(flight.size(), 0, "one failure must not wedge the key for the life of the page");

  // And the next attempt is allowed to run.
  assert.equal(await flight.run("user-1", async () => "recovered"), "recovered");
});

test("every waiter sees the same failure", async () => {
  const flight = createSingleFlight<string>();
  let release: (reason: Error) => void = () => {};
  const held = new Promise<string>((_, reject) => { release = reject; });

  const first = flight.run("user-1", () => held);
  const second = flight.run("user-1", () => held);
  release(new Error("нет сети"));

  await assert.rejects(first, /нет сети/);
  await assert.rejects(second, /нет сети/);
});
