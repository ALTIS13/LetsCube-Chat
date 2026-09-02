import assert from "node:assert/strict";
import test from "node:test";

import { createActionFeedbackStore } from "../../artifacts/kub/src/lib/actionFeedback.ts";

/**
 * The confirmation that an action happened, bounded so it can never become the
 * interface.
 *
 * Five places in the product copy something to the clipboard and say nothing at
 * all, which leaves a person pressing the button again to find out whether the
 * first press worked. The fix is a shared, transient confirmation — and the
 * reason it needs a contract rather than a component is that an unbounded one
 * is worse than none: a queue that grows covers the thing it is confirming.
 */

test("the queue is bounded and keyed entries replace their predecessor", () => {
  const store = createActionFeedbackStore(() => 1000);
  store.show({ kind: "success", title: "Один", key: "copy" });
  store.show({ kind: "success", title: "Два", key: "copy" });
  store.show({ kind: "info", title: "Три" });
  store.show({ kind: "warning", title: "Четыре" });
  store.show({ kind: "error", title: "Пять" });

  assert.equal(store.getSnapshot().length, 3);
  assert.equal(
    store.getSnapshot().some((item) => item.title === "Один"),
    false,
    "a keyed entry must be replaced, not stacked: pressing copy twice is one result",
  );
});

test("a keyed repeat replaces rather than stacks, on its own", () => {
  // Isolated from the bound deliberately. Asserting this inside a queue of five
  // passed even when replacement was removed entirely, because the bound of
  // three dropped the first entry anyway — the test agreed for the wrong reason.
  const store = createActionFeedbackStore(() => 1000);
  store.show({ kind: "success", title: "Скопировано", key: "copy" });
  store.show({ kind: "success", title: "Скопировано", key: "copy" });
  assert.equal(store.getSnapshot().length, 1, "pressing copy twice is one result");
});

test("entries without a key are independent of each other", () => {
  const store = createActionFeedbackStore(() => 1000);
  store.show({ kind: "info", title: "Один" });
  store.show({ kind: "info", title: "Два" });
  assert.equal(store.getSnapshot().length, 2, "only a shared key groups two results");
});

test("different keys do not collapse into one another", () => {
  const store = createActionFeedbackStore(() => 1000);
  store.show({ kind: "success", title: "Ссылка", key: "invite-link" });
  store.show({ kind: "success", title: "Никнейм", key: "username" });
  assert.equal(store.getSnapshot().length, 2);
});

test("the oldest goes first when the bound is reached", () => {
  const store = createActionFeedbackStore(() => 1000);
  for (const title of ["A", "B", "C", "D"]) store.show({ kind: "info", title });
  assert.deepEqual(
    store.getSnapshot().map((item) => item.title),
    ["B", "C", "D"],
  );
});

test("each entry gets its own identity even when everything else matches", () => {
  const store = createActionFeedbackStore(() => 1000);
  store.show({ kind: "info", title: "Одно и то же" });
  store.show({ kind: "info", title: "Одно и то же" });
  const [first, second] = store.getSnapshot();
  assert.notEqual(first.id, second.id, "React needs stable distinct keys for these");
});

test("a snapshot is immutable, so a render cannot corrupt the queue", () => {
  const store = createActionFeedbackStore(() => 1000);
  store.show({ kind: "info", title: "Один" });
  const snapshot = store.getSnapshot();
  assert.throws(() => {
    (snapshot as unknown as { push: (value: unknown) => void }).push({ title: "Два" });
  }, TypeError);
});

test("the same snapshot is returned until something changes", () => {
  // `useSyncExternalStore` re-renders whenever the snapshot is a new object, so
  // returning a fresh array each call would loop forever.
  const store = createActionFeedbackStore(() => 1000);
  assert.equal(store.getSnapshot(), store.getSnapshot());
  store.show({ kind: "info", title: "Один" });
  const after = store.getSnapshot();
  assert.equal(after, store.getSnapshot());
});

test("subscribers hear about changes and stop when they unsubscribe", () => {
  const store = createActionFeedbackStore(() => 1000);
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });
  store.show({ kind: "info", title: "Один" });
  assert.equal(calls, 1);
  unsubscribe();
  store.show({ kind: "info", title: "Два" });
  assert.equal(calls, 1, "an unsubscribed listener must not be called again");
});

test("success clears itself; an error waits longer and is not silently dropped", () => {
  let now = 0;
  const store = createActionFeedbackStore(() => now);
  store.show({ kind: "success", title: "Скопировано" });
  store.show({ kind: "error", title: "Не удалось" });

  now = 2500;
  store.prune();
  assert.deepEqual(
    store.getSnapshot().map((item) => item.title),
    ["Не удалось"],
    "a success that has had its 2.4s is gone; the error has not had its 5s",
  );

  now = 5200;
  store.prune();
  assert.deepEqual(store.getSnapshot(), []);
});

test("reduced motion shortens a success but never an error", () => {
  let now = 0;
  const store = createActionFeedbackStore(() => now, { reducedMotion: true });
  store.show({ kind: "success", title: "Скопировано" });
  store.show({ kind: "error", title: "Не удалось" });

  now = 1700;
  store.prune();
  assert.deepEqual(
    store.getSnapshot().map((item) => item.title),
    ["Не удалось"],
    "reduced motion is about movement, not about how long a failure stays readable",
  );
});

test("a detail is bounded, because it may carry a message from elsewhere", () => {
  const store = createActionFeedbackStore(() => 1000);
  store.show({ kind: "error", title: "Ошибка", detail: "я".repeat(400) });
  const [item] = store.getSnapshot();
  assert.equal(item.detail?.length, 160);
});

test("dismissing removes exactly the entry asked for", () => {
  const store = createActionFeedbackStore(() => 1000);
  store.show({ kind: "info", title: "Один" });
  store.show({ kind: "info", title: "Два" });
  const [first] = store.getSnapshot();
  store.dismiss(first.id);
  assert.deepEqual(
    store.getSnapshot().map((item) => item.title),
    ["Два"],
  );
});
