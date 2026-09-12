import assert from "node:assert/strict";
import test from "node:test";

import {
  createHintStore,
  DEFAULT_HINT_BUDGET_MS,
  HINTS_STORAGE_KEY,
  type HintStorage,
} from "../../artifacts/kub/src/lib/hints.ts";

/** A storage a test can look inside, and break on purpose. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  let refuseWrites = false;
  let refuseReads = false;
  const storage: HintStorage = {
    getItem(key) {
      if (refuseReads) throw new Error("storage refused the read");
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (refuseWrites) throw new Error("storage refused the write");
      data.set(key, value);
    },
  };
  return {
    storage,
    raw: () => data.get(HINTS_STORAGE_KEY) ?? null,
    breakWrites: () => {
      refuseWrites = true;
    },
    breakReads: () => {
      refuseReads = true;
    },
  };
}

test("a hint that has never been seen shows as soon as it is offered", () => {
  const store = createHintStore();
  assert.equal(store.isVisible("admin-entry"), false, "nothing is on screen before it is offered");
  store.offer({ id: "admin-entry" });
  assert.equal(store.isVisible("admin-entry"), true);
  assert.deepEqual([...store.getSnapshot()], ["admin-entry"]);
});

test("closing it is final, and it stays closed in the next session", () => {
  const kept = fakeStorage();
  const first = createHintStore({ storage: kept.storage });
  first.offer({ id: "admin-entry" });
  first.dismiss("admin-entry");
  assert.equal(first.isVisible("admin-entry"), false, "it goes as soon as it is closed");

  // A new store over the same storage is the next launch of the application.
  const second = createHintStore({ storage: kept.storage });
  second.offer({ id: "admin-entry" });
  assert.equal(
    second.isVisible("admin-entry"),
    false,
    "a hint the person has read must not come back on the next launch",
  );
});

test("the budget is spent only while the hint is being offered", () => {
  const store = createHintStore();
  store.spend(60 * 60 * 1000);
  store.offer({ id: "admin-entry" });
  assert.equal(
    store.getRecord("admin-entry"),
    null,
    "an hour that passed before the hint existed must not be charged to it",
  );
  assert.equal(store.isVisible("admin-entry"), true);
});

test("a hint stops appearing once its budget of real use is gone", () => {
  const store = createHintStore();
  store.offer({ id: "admin-entry", budgetMs: 1000 });
  store.spend(400);
  assert.equal(store.isVisible("admin-entry"), true, "400ms of a 1000ms budget is not spent out");
  store.spend(600);
  assert.equal(store.isVisible("admin-entry"), false, "the budget is gone, so the hint is done");
  assert.deepEqual([...store.getSnapshot()], []);
});

test("withdrawing an offer neither dismisses it nor spends it", () => {
  const store = createHintStore();
  store.offer({ id: "admin-entry", budgetMs: 1000 });
  store.spend(300);
  store.withdraw("admin-entry");
  assert.equal(store.isVisible("admin-entry"), false, "a withdrawn hint is not on screen");
  store.spend(5000);
  store.offer({ id: "admin-entry", budgetMs: 1000 });
  assert.equal(
    store.isVisible("admin-entry"),
    true,
    "time while it was withdrawn is not charged, so 300ms of 1000ms is still left",
  );
});

test("two hints keep their own budgets", () => {
  const store = createHintStore();
  store.offer({ id: "a", budgetMs: 1000 });
  store.offer({ id: "b", budgetMs: 5000 });
  store.spend(1200);
  assert.equal(store.isVisible("a"), false, "a spent its budget");
  assert.equal(store.isVisible("b"), true, "b did not");
});

test("dismissing one leaves the other alone", () => {
  const store = createHintStore();
  store.offer({ id: "a" });
  store.offer({ id: "b" });
  store.dismiss("a");
  assert.deepEqual([...store.getSnapshot()], ["b"]);
});

test("a storage that refuses writes costs the memory of the decision, nothing more", () => {
  const broken = fakeStorage();
  broken.breakWrites();
  const store = createHintStore({ storage: broken.storage });
  store.offer({ id: "admin-entry" });
  assert.doesNotThrow(() => store.dismiss("admin-entry"), "a private window must not throw");
  assert.equal(store.isVisible("admin-entry"), false, "it still goes for this session");
  assert.equal(broken.raw(), null, "and nothing was written, which is the whole cost");
});

test("a storage that refuses reads is the same as no storage", () => {
  const broken = fakeStorage();
  broken.breakReads();
  assert.doesNotThrow(() => createHintStore({ storage: broken.storage }));
  const store = createHintStore({ storage: broken.storage });
  store.offer({ id: "admin-entry" });
  assert.equal(store.isVisible("admin-entry"), true);
});

test("rubbish in storage is ignored rather than trusted", () => {
  for (const raw of ["not json", "[]", "null", '{"admin-entry": 5}', '{"admin-entry": {"spentMs": -9}}']) {
    const kept = fakeStorage({ [HINTS_STORAGE_KEY]: raw });
    const store = createHintStore({ storage: kept.storage });
    store.offer({ id: "admin-entry", budgetMs: 1000 });
    assert.equal(store.isVisible("admin-entry"), true, `«${raw}» should read as no decision at all`);
  }
});

test("a dismissal written by an earlier version is honoured", () => {
  const kept = fakeStorage({
    [HINTS_STORAGE_KEY]: JSON.stringify({ "admin-entry": { dismissed: true, spentMs: 0 } }),
  });
  const store = createHintStore({ storage: kept.storage });
  store.offer({ id: "admin-entry" });
  assert.equal(store.isVisible("admin-entry"), false);
});

test("subscribers hear a change once, and not when nothing changed", () => {
  const store = createHintStore();
  let calls = 0;
  const stop = store.subscribe(() => {
    calls += 1;
  });
  store.offer({ id: "a" });
  assert.equal(calls, 1, "appearing is a change");
  store.offer({ id: "a" });
  assert.equal(calls, 1, "offering the same hint again is not");
  store.dismiss("a");
  assert.equal(calls, 2, "going is a change");
  stop();
  store.offer({ id: "b" });
  assert.equal(calls, 2, "an unsubscribed listener hears nothing");
});

// This test exists in this shape because its first shape did not work. It
// asserted that two reads of `getSnapshot` return the same array, which is
// true of any getter; breaking the dedupe inside `rebuild` left it green.
// `offer` returns early when a hint is already offered, so re-offering never
// reaches `rebuild` at all. Dismissing something that was never offered does:
// it writes a record and rebuilds, and the visible set is unchanged by it.
test("a rebuild that changes nothing keeps the snapshot and wakes nobody", () => {
  const store = createHintStore();
  store.offer({ id: "a" });
  const first = store.getSnapshot();
  let calls = 0;
  store.subscribe(() => {
    calls += 1;
  });

  store.dismiss("never-offered");
  assert.equal(calls, 0, "nothing visible changed, so no listener should have been woken");
  assert.equal(store.getSnapshot(), first, "and the snapshot must keep its identity");

  store.offer({ id: "b" });
  assert.notEqual(store.getSnapshot(), first, "a real change must be a new array");
  assert.equal(calls, 1, "and that one must be announced exactly once");
});

test("the default budget is the two hours the owner asked for", () => {
  assert.equal(DEFAULT_HINT_BUDGET_MS, 7_200_000);
});
