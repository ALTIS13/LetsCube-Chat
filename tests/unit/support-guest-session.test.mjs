import assert from "node:assert/strict";
import test from "node:test";

import { createGuestSupportSessionStore } from "../../artifacts/kub/src/lib/support/guestSessionStore.ts";

function memoryBackend() {
  const values = new Map();
  return {
    values,
    async get(key) {
      return values.get(key) ?? null;
    },
    async put(key, value) {
      values.set(key, structuredClone(value));
    },
    async delete(key) {
      values.delete(key);
    },
  };
}

const SESSION = {
  ticketId: "f7a42e23-bd69-4ca3-a983-1fde8b7c44c1",
  secret: "guest-secret-is-never-placed-in-a-url",
  idleExpiresAt: "2026-08-26T00:00:00.000Z",
  absoluteExpiresAt: "2026-10-25T00:00:00.000Z",
  updatedAt: "2026-07-27T00:00:00.000Z",
};

test("guest session store saves and restores an active IndexedDB record", async () => {
  const backend = memoryBackend();
  const store = createGuestSupportSessionStore(backend, {
    now: () => Date.parse("2026-07-28T00:00:00.000Z"),
  });

  await store.save(SESSION);
  assert.deepEqual(await store.load(), SESSION);
  assert.equal(backend.values.size, 1);
});

test("guest session store removes idle and absolute expired records", async () => {
  const backend = memoryBackend();
  const store = createGuestSupportSessionStore(backend, {
    now: () => Date.parse("2026-11-01T00:00:00.000Z"),
  });

  await store.save(SESSION);
  assert.equal(await store.load(), null);
  assert.equal(backend.values.size, 0);
});

test("guest session store rejects malformed records and supports explicit forgetting", async () => {
  const backend = memoryBackend();
  const store = createGuestSupportSessionStore(backend, {
    now: () => Date.parse("2026-07-28T00:00:00.000Z"),
  });

  await assert.rejects(
    () => store.save({ ...SESSION, secret: "" }),
    /Invalid guest support session/,
  );

  await store.save(SESSION);
  await store.clear();
  assert.equal(await store.load(), null);
});
