import assert from "node:assert/strict";
import test from "node:test";

import {
  createSignedMediaUrlStore,
  type SignedPathResult,
} from "../../artifacts/kub/src/lib/media/signedMediaUrlStore.ts";
import { signedUrlLifetime } from "../../artifacts/kub/src/lib/media/signedUrlLifetime.ts";

/**
 * D-208, step two: where a signed address is held, and what replaces it.
 *
 * The signer, the clock and the scheduler are all injected, so every one of
 * these runs without a network, a browser or a wait.
 */

const TTL = 3600;
const T0 = 1_700_000_000_000;
const LIFE = signedUrlLifetime(T0, TTL);

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
        for (let i = 0; i < 4; i += 1) await Promise.resolve();
      }
    },
  };
}

function movableClock(start = T0) {
  let t = start;
  return {
    now: () => t,
    set(next: number) {
      t = next;
    },
    advance(ms: number) {
      t += ms;
    },
  };
}

/** Records every POST, and answers each path with a token naming the attempt. */
function recordingSigner(options: { refuse?: Set<string>; throwOnce?: boolean } = {}) {
  const calls: Array<{ bucket: string; paths: string[] }> = [];
  let attempt = 0;
  let thrown = false;
  const sign = async (bucket: string, paths: string[]): Promise<SignedPathResult[]> => {
    if (options.throwOnce && !thrown) {
      thrown = true;
      throw new Error("offline");
    }
    attempt += 1;
    calls.push({ bucket, paths: [...paths] });
    return paths.map((path) =>
      options.refuse?.has(path)
        ? { path, signedUrl: null, error: "Object not found" }
        : { path, signedUrl: `https://s/sign/${bucket}/${path}?token=t${attempt}` },
    );
  };
  return { calls, sign };
}

const A = { bucket: "media", path: "owner/a.jpg" };
const B = { bucket: "media", path: "owner/b.jpg" };
const C = { bucket: "chat-media", path: "owner/c.jpg" };

test("a screenful of objects becomes one POST", async () => {
  // The reason the store exists at all: signing is a request, and a picture
  // cannot pay for one each.
  const clock = movableClock();
  const scheduler = manualScheduler();
  const { calls, sign } = recordingSigner();
  const store = createSignedMediaUrlStore({ sign, now: clock.now, schedule: scheduler.schedule, ttlSeconds: TTL });

  for (const ref of [A, B, { bucket: "media", path: "owner/c.jpg" }]) store.request(ref);
  await scheduler.run();

  assert.equal(calls.length, 1, "one POST, not three");
  assert.deepEqual(calls[0].paths.sort(), ["owner/a.jpg", "owner/b.jpg", "owner/c.jpg"]);
  assert.equal(store.get(A), "https://s/sign/media/owner/a.jpg?token=t1");
});

test("two buckets are never mixed into one POST", async () => {
  // `createSignedUrls` is addressed at a bucket; a mixed batch would sign the
  // wrong objects, or nothing.
  const clock = movableClock();
  const scheduler = manualScheduler();
  const { calls, sign } = recordingSigner();
  const store = createSignedMediaUrlStore({ sign, now: clock.now, schedule: scheduler.schedule, ttlSeconds: TTL });

  store.request(A);
  store.request(C);
  await scheduler.run();

  assert.equal(calls.length, 2);
  const buckets = calls.map((c) => c.bucket).sort();
  assert.deepEqual(buckets, ["chat-media", "media"]);
  for (const call of calls) {
    assert.equal(new Set(call.paths.map(() => call.bucket)).size, 1);
  }
});

test("an answered object is not asked about again while it is fresh", async () => {
  const clock = movableClock();
  const scheduler = manualScheduler();
  const { calls, sign } = recordingSigner();
  const store = createSignedMediaUrlStore({ sign, now: clock.now, schedule: scheduler.schedule, ttlSeconds: TTL });

  store.request(A);
  await scheduler.run();
  for (let i = 0; i < 20; i += 1) store.get(A);
  await scheduler.run();

  assert.equal(calls.length, 1, "reading must not re-sign");
});

test("reading past the renewal point queues a replacement and keeps serving the old one", async () => {
  // This is what stops a picture blinking once an hour. The old address is
  // still valid; the new one arrives behind it.
  const clock = movableClock();
  const scheduler = manualScheduler();
  const { calls, sign } = recordingSigner();
  const store = createSignedMediaUrlStore({ sign, now: clock.now, schedule: scheduler.schedule, ttlSeconds: TTL });

  store.request(A);
  await scheduler.run();
  const first = store.get(A);

  clock.set(LIFE.renewAtMs);
  const during = store.get(A);
  assert.equal(during, first, "the address on screen must not change before the new one exists");
  assert.equal(calls.length, 1, "not signed yet — only queued");

  await scheduler.run();
  assert.equal(calls.length, 2, "the replacement was fetched");
  assert.equal(store.get(A), "https://s/sign/media/owner/a.jpg?token=t2");
});

test("a spent signature is withheld rather than handed out to die mid-download", async () => {
  const clock = movableClock();
  const scheduler = manualScheduler();
  const { sign } = recordingSigner();
  const store = createSignedMediaUrlStore({ sign, now: clock.now, schedule: scheduler.schedule, ttlSeconds: TTL });

  store.request(A);
  await scheduler.run();
  assert.ok(store.get(A));

  clock.set(LIFE.expiresAtMs - 60_000);
  assert.equal(store.get(A), null, "under the floor, nothing is offered");

  await scheduler.run();
  assert.ok(store.get(A), "and a fresh one is fetched");
});

test("a refused object is remembered, so a render loop cannot spin on it", async () => {
  // On today's policies this is the common case, not the rare one: a chat
  // member may not select anybody else's object, so every one of them is
  // refused until the read policy is widened.
  const clock = movableClock();
  const scheduler = manualScheduler();
  const { calls, sign } = recordingSigner({ refuse: new Set(["owner/a.jpg"]) });
  const store = createSignedMediaUrlStore({
    sign, now: clock.now, schedule: scheduler.schedule, ttlSeconds: TTL, failureCooldownMs: 30_000,
  });

  store.request(A);
  await scheduler.run();
  assert.equal(store.get(A), null);
  assert.equal(store.isSettled(A), true, "refused is an answer");

  for (let i = 0; i < 50; i += 1) store.get(A);
  await scheduler.run();
  assert.equal(calls.length, 1, "fifty reads inside the cooldown are one POST");
});

test("a refusal heals after the cooldown, without a reload", async () => {
  const clock = movableClock();
  const scheduler = manualScheduler();
  const refuse = new Set(["owner/a.jpg"]);
  const { calls, sign } = recordingSigner({ refuse });
  const store = createSignedMediaUrlStore({
    sign, now: clock.now, schedule: scheduler.schedule, ttlSeconds: TTL, failureCooldownMs: 30_000,
  });

  store.request(A);
  await scheduler.run();
  assert.equal(store.get(A), null);

  refuse.delete("owner/a.jpg");
  clock.advance(30_000);
  store.get(A);
  await scheduler.run();

  assert.equal(calls.length, 2);
  assert.equal(store.get(A), "https://s/sign/media/owner/a.jpg?token=t2");
});

test("a dropped POST is not an answer about anything", async () => {
  // Caching "none" for a blink of network would blank a conversation for the
  // rest of the session. The same rule `avatarVariantStore` follows.
  const clock = movableClock();
  const scheduler = manualScheduler();
  const { calls, sign } = recordingSigner({ throwOnce: true });
  const store = createSignedMediaUrlStore({ sign, now: clock.now, schedule: scheduler.schedule, ttlSeconds: TTL });

  store.request(A);
  await scheduler.run();
  assert.equal(store.isSettled(A), false, "nothing was learned");

  store.get(A);
  await scheduler.run();
  assert.equal(calls.length, 1, "the throw was not recorded as a call");
  assert.equal(store.get(A), "https://s/sign/media/owner/a.jpg?token=t1");
});

test("a good address survives a dropped renewal", async () => {
  const clock = movableClock();
  const scheduler = manualScheduler();
  let failNext = false;
  const calls: string[][] = [];
  let attempt = 0;
  const sign = async (bucket: string, paths: string[]): Promise<SignedPathResult[]> => {
    if (failNext) throw new Error("offline");
    attempt += 1;
    calls.push([...paths]);
    return paths.map((path) => ({ path, signedUrl: `https://s/sign/${bucket}/${path}?token=t${attempt}` }));
  };
  const store = createSignedMediaUrlStore({ sign, now: clock.now, schedule: scheduler.schedule, ttlSeconds: TTL });

  store.request(A);
  await scheduler.run();
  const first = store.get(A);

  failNext = true;
  clock.set(LIFE.renewAtMs);
  store.get(A);
  await scheduler.run();

  assert.equal(store.get(A), first, "a minute offline does not take the picture off the screen");
});

test("listeners hear an answer, and only when something changed", async () => {
  const clock = movableClock();
  const scheduler = manualScheduler();
  const { sign } = recordingSigner();
  const store = createSignedMediaUrlStore({ sign, now: clock.now, schedule: scheduler.schedule, ttlSeconds: TTL });

  let notified = 0;
  const stop = store.subscribe(() => {
    notified += 1;
  });

  store.request(A);
  await scheduler.run();
  assert.equal(notified, 1);

  store.get(A);
  await scheduler.run();
  assert.equal(notified, 1, "a read of a fresh answer notifies nobody");

  stop();
  clock.set(LIFE.renewAtMs);
  store.get(A);
  await scheduler.run();
  assert.equal(notified, 1, "an unsubscribed listener is not called");
});

test("the cache is bounded, and it is the least recently read that goes", async () => {
  const clock = movableClock();
  const scheduler = manualScheduler();
  const { sign } = recordingSigner();
  const store = createSignedMediaUrlStore({
    sign, now: clock.now, schedule: scheduler.schedule, ttlSeconds: TTL, cacheLimit: 2,
  });

  store.request({ bucket: "media", path: "p1" });
  await scheduler.run();
  clock.advance(1000);
  store.request({ bucket: "media", path: "p2" });
  await scheduler.run();
  clock.advance(1000);
  // Reading p1 makes p2 the older one.
  store.get({ bucket: "media", path: "p1" });
  clock.advance(1000);
  store.request({ bucket: "media", path: "p3" });
  await scheduler.run();

  assert.equal(store.__debug().known, 2);
  assert.equal(store.isSettled({ bucket: "media", path: "p2" }), false, "the least recently read was dropped");
  assert.equal(store.isSettled({ bucket: "media", path: "p1" }), true);
});

test("a batch is capped, and the remainder follows", async () => {
  const clock = movableClock();
  const scheduler = manualScheduler();
  const { calls, sign } = recordingSigner();
  const store = createSignedMediaUrlStore({
    sign, now: clock.now, schedule: scheduler.schedule, ttlSeconds: TTL, batchSize: 2,
  });

  for (const path of ["a", "b", "c", "d", "e"]) store.request({ bucket: "media", path });
  await scheduler.run();

  assert.deepEqual(calls.map((c) => c.paths.length), [2, 2, 1]);
  for (const path of ["a", "b", "c", "d", "e"]) {
    assert.ok(store.get({ bucket: "media", path }), path);
  }
});

test("reset forgets every signature — no address outlives a session", async () => {
  const clock = movableClock();
  const scheduler = manualScheduler();
  const { sign } = recordingSigner();
  const store = createSignedMediaUrlStore({ sign, now: clock.now, schedule: scheduler.schedule, ttlSeconds: TTL });

  store.request(A);
  await scheduler.run();
  assert.ok(store.get(A));

  store.reset();
  assert.equal(store.__debug().known, 0);
});

test("nothing is a null ref's problem", () => {
  const { sign } = recordingSigner();
  const store = createSignedMediaUrlStore({ sign, schedule: manualScheduler().schedule });
  store.request(null);
  store.request(undefined);
  assert.equal(store.get(null), null);
  assert.equal(store.isSettled(null), true);
});
