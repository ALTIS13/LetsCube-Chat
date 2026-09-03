import assert from "node:assert/strict";
import test from "node:test";

import {
  avatarVariantSrc,
  createAvatarVariantStore,
  type AvatarVariantUrls,
} from "../../artifacts/kub/src/lib/avatarVariantStore.ts";

/** Runs the store's scheduled work on demand instead of on a microtask. */
function manualScheduler() {
  const queue: Array<() => void> = [];
  return {
    schedule: (run: () => void) => {
      queue.push(run);
    },
    async run() {
      while (queue.length > 0) {
        const next = queue.shift()!;
        next();
        // Let the fetch inside the flush settle before the next scheduled run.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
  };
}

function recordingFetcher(answers: Record<string, AvatarVariantUrls> = {}) {
  const calls: string[][] = [];
  const fetcher = async (ids: string[]) => {
    calls.push([...ids]);
    const result: Record<string, AvatarVariantUrls> = {};
    for (const id of ids) {
      if (Object.hasOwn(answers, id)) result[id] = answers[id];
    }
    return result;
  };
  return { calls, fetcher };
}

test("every avatar asked about in one frame becomes one query", async () => {
  // This is the reason the store exists: an avatar can ask for itself only if
  // asking does not cost a query each.
  const scheduler = manualScheduler();
  const { calls, fetcher } = recordingFetcher({ a: { avatar128Url: "a-128" } });
  const store = createAvatarVariantStore(fetcher, { schedule: scheduler.schedule });

  for (const id of ["a", "b", "c", "d"]) store.request(id);
  await scheduler.run();

  assert.equal(calls.length, 1, "one query, not four");
  assert.deepEqual(calls[0].sort(), ["a", "b", "c", "d"]);
  assert.deepEqual(store.get("a"), { avatar128Url: "a-128" });
});

test("an answered profile is never asked about again", async () => {
  const scheduler = manualScheduler();
  const { calls, fetcher } = recordingFetcher({ a: { avatar128Url: "a-128" } });
  const store = createAvatarVariantStore(fetcher, { schedule: scheduler.schedule });

  store.request("a");
  await scheduler.run();
  for (let i = 0; i < 20; i += 1) store.request("a");
  await scheduler.run();

  assert.equal(calls.length, 1, "requesting on every render costs nothing");
});

test("a profile with no variant is remembered as having none", async () => {
  // Otherwise every render asks again, which is worse than the original it was
  // meant to avoid.
  const scheduler = manualScheduler();
  const { calls, fetcher } = recordingFetcher({});
  const store = createAvatarVariantStore(fetcher, { schedule: scheduler.schedule });

  store.request("nobody");
  await scheduler.run();
  assert.deepEqual(store.get("nobody"), {}, "answered, with nothing");

  store.request("nobody");
  await scheduler.run();
  assert.equal(calls.length, 1);
});

test("a failed query is forgotten rather than cached as 'no variant'", async () => {
  // Caching a network blip would serve 734 kB originals for the rest of the
  // session, which is exactly the defect this store exists to remove.
  const scheduler = manualScheduler();
  let attempt = 0;
  const store = createAvatarVariantStore(
    async (ids) => {
      attempt += 1;
      if (attempt === 1) throw new Error("network");
      return Object.fromEntries(ids.map((id) => [id, { avatar128Url: `${id}-128` }]));
    },
    { schedule: scheduler.schedule },
  );

  store.request("a");
  await scheduler.run();
  assert.equal(store.get("a"), undefined, "a failure is not an answer");

  store.request("a");
  await scheduler.run();
  assert.deepEqual(store.get("a"), { avatar128Url: "a-128" }, "and it can be asked again");
});

test("an id in flight is not queued a second time", async () => {
  const scheduler = manualScheduler();
  const { calls, fetcher } = recordingFetcher({ a: { avatar128Url: "a-128" } });
  const store = createAvatarVariantStore(fetcher, { schedule: scheduler.schedule });

  store.request("a");
  store.request("a");
  store.request("a");
  await scheduler.run();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["a"]);
});

test("more ids than a batch holds are split, and none are dropped", async () => {
  const scheduler = manualScheduler();
  const ids = Array.from({ length: 7 }, (_, index) => `p${index}`);
  const { calls, fetcher } = recordingFetcher(
    Object.fromEntries(ids.map((id) => [id, { avatar128Url: `${id}-128` }])),
  );
  const store = createAvatarVariantStore(fetcher, { schedule: scheduler.schedule, batchSize: 3 });

  for (const id of ids) store.request(id);
  await scheduler.run();

  assert.equal(calls.length, 3, "7 ids at 3 per query");
  assert.deepEqual(calls.flat().sort(), [...ids].sort());
  for (const id of ids) assert.deepEqual(store.get(id), { avatar128Url: `${id}-128` });
});

test("subscribers are told once a batch is answered", async () => {
  const scheduler = manualScheduler();
  const { fetcher } = recordingFetcher({ a: { avatar128Url: "a-128" } });
  const store = createAvatarVariantStore(fetcher, { schedule: scheduler.schedule });

  let notifications = 0;
  const stop = store.subscribe(() => {
    notifications += 1;
  });

  store.request("a");
  store.request("b");
  await scheduler.run();
  assert.equal(notifications, 1, "one notification for one batch, not one per id");

  stop();
  store.request("c");
  await scheduler.run();
  assert.equal(notifications, 1, "an unsubscribed listener is not called");
});

test("an empty or missing id is not a request", async () => {
  const scheduler = manualScheduler();
  const { calls, fetcher } = recordingFetcher({});
  const store = createAvatarVariantStore(fetcher, { schedule: scheduler.schedule });

  store.request(null);
  store.request(undefined);
  store.request("");
  await scheduler.run();

  assert.equal(calls.length, 0);
  assert.equal(store.get(null), undefined);
  assert.equal(store.get(""), undefined);
});

test("a small avatar takes the small variant and a large one the large", () => {
  const both: AvatarVariantUrls = { avatar128Url: "small", avatar256Url: "large" };
  assert.equal(avatarVariantSrc(both, "sm"), "small");
  assert.equal(avatarVariantSrc(both, "md"), "small");
  assert.equal(avatarVariantSrc(both, "lg"), "large");
  assert.equal(avatarVariantSrc(both, "xl"), "large");
});

test("whichever variant exists is used rather than falling back to the original", () => {
  assert.equal(avatarVariantSrc({ avatar128Url: "small" }, "xl"), "small");
  assert.equal(avatarVariantSrc({ avatar256Url: "large" }, "sm"), "large");
});

test("nothing known means nothing is claimed", () => {
  assert.equal(avatarVariantSrc(undefined, "md"), undefined);
  assert.equal(avatarVariantSrc({}, "md"), undefined);
});

test("the recorded 'no variant' answer cannot be mutated by a caller", async () => {
  const scheduler = manualScheduler();
  const { fetcher } = recordingFetcher({});
  const store = createAvatarVariantStore(fetcher, { schedule: scheduler.schedule });

  store.request("nobody");
  await scheduler.run();
  const answer = store.get("nobody")!;
  assert.throws(() => {
    (answer as { avatar128Url?: string }).avatar128Url = "forged";
  }, "the shared empty answer is frozen");
});

test("a requested profile is unsettled until the answer arrives", async () => {
  // The picture waits on this. Getting it wrong means an <img> starts the
  // 734 kB original while the 3 kB answer is still in flight, and both are
  // downloaded — which is worse than never having asked.
  const scheduler = manualScheduler();
  const { fetcher } = recordingFetcher({ a: { avatar128Url: "a-128" } });
  const store = createAvatarVariantStore(fetcher, { schedule: scheduler.schedule });

  assert.equal(store.isSettled("a"), true, "nobody has asked yet, so there is nothing to wait for");
  store.request("a");
  assert.equal(store.isSettled("a"), false, "asked, and the answer is coming");

  await scheduler.run();
  assert.equal(store.isSettled("a"), true);
});

test("a profile with no variant settles too, so the original is used", async () => {
  const scheduler = manualScheduler();
  const { fetcher } = recordingFetcher({});
  const store = createAvatarVariantStore(fetcher, { schedule: scheduler.schedule });

  store.request("nobody");
  await scheduler.run();
  assert.equal(store.isSettled("nobody"), true);
  assert.equal(store.get("nobody")?.avatar128Url, undefined);
});

test("a failed query settles rather than hiding the avatar forever", async () => {
  const scheduler = manualScheduler();
  const store = createAvatarVariantStore(async () => {
    throw new Error("network");
  }, { schedule: scheduler.schedule });

  store.request("a");
  assert.equal(store.isSettled("a"), false);
  await scheduler.run();
  assert.equal(store.isSettled("a"), true, "no answer is coming, so show the original");
});

test("an id nobody asked about is settled by definition", () => {
  const scheduler = manualScheduler();
  const { fetcher } = recordingFetcher({});
  const store = createAvatarVariantStore(fetcher, { schedule: scheduler.schedule });
  assert.equal(store.isSettled(null), true);
  assert.equal(store.isSettled(""), true);
  assert.equal(store.isSettled("never-asked"), true);
});

test("asking again while the answer is in flight does not start a second query", async () => {
  // The Set already dedupes ids queued in the same frame. This is the other
  // case: a component mounting while the batch is out — a scrolling list does
  // it constantly — must not queue a query the store is already running.
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[][] = [];
  const store = createAvatarVariantStore(
    async (ids) => {
      calls.push([...ids]);
      await gate;
      return Object.fromEntries(ids.map((id) => [id, { avatar128Url: `${id}-128` }]));
    },
    { schedule: (run) => void Promise.resolve().then(run) },
  );

  store.request("a");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 1, "the first request is out");

  store.request("a");
  store.request("a");
  release?.();
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(calls.length, 1, "and no second query was started for the same id");
  assert.deepEqual(store.get("a"), { avatar128Url: "a-128" });
});
