import assert from "node:assert/strict";
import test from "node:test";

import { createActionFeedbackStore } from "../../artifacts/kub/src/lib/actionFeedback.ts";
import { FORWARD_FEEDBACK_KEY, forwardFeedback } from "../../artifacts/kub/src/lib/messageForward.ts";

/**
 * Complaint 5: «переслал сообщение — ничего не произошло».
 *
 * Forwarding said nothing either way: a refusal went to the console, and the
 * dialog closed whether or not the server had accepted the message. What a
 * person is told is decided here, so these are the rules of that decision. The
 * whole flow — hook, dialog and confirmation — is held by
 * `tests/e2e/message-forward-feedback.spec.ts` against a mocked backend.
 *
 * 2026-09-28, tracker item 55: a delivered forward says nothing any more. The
 * forward opens the destination and puts the message into its feed, so the
 * notice named the chat the reader was already looking at — «я знаю, передо
 * мной чат открыт». Telegram says nothing there either. A failure still says
 * why, and a success clears a failure of the same forward.
 */

test("a delivered forward says nothing: the message in the chat on screen is the confirmation", () => {
  assert.equal(forwardFeedback({ ok: true, error: null }), null);
});

test("a refused forward is an error, and carries the reason it was refused", () => {
  const feedback = forwardFeedback({ ok: false, error: "Недостаточно прав для этого действия." });
  assert.ok(feedback);
  assert.equal(feedback.kind, "error");
  assert.equal(feedback.title, "Не удалось переслать сообщение");
  assert.equal(feedback.detail, "Недостаточно прав для этого действия.");
  assert.equal(feedback.key, FORWARD_FEEDBACK_KEY);
});

test("a failure that arrives without a reason still reads as a failure", () => {
  const feedback = forwardFeedback({ ok: false, error: "   " });
  assert.ok(feedback);
  assert.equal(feedback.kind, "error");
  assert.ok((feedback.detail ?? "").trim().length > 0, "an empty detail leaves only the title to say why");
});

test("a forward that works after one that failed takes the failure away instead of leaving it to contradict", () => {
  const store = createActionFeedbackStore(() => 1000);
  const failure = forwardFeedback({ ok: false, error: "Сетевой сбой. Проверьте подключение и попробуйте ещё раз." });
  assert.ok(failure);
  store.show(failure);
  store.show({ kind: "success", title: "Скопировано", key: "copy" });
  assert.equal(store.getSnapshot().length, 2);

  // What `settleActionFeedback(FORWARD_FEEDBACK_KEY, null)` does on success.
  store.dismissKey(FORWARD_FEEDBACK_KEY);
  const items = store.getSnapshot();
  assert.equal(items.length, 1, "the stale failure is still on screen after the forward went through");
  assert.equal(items[0].key, "copy", "an unrelated notice was taken away with it");
});

test("taking away a key that is not on screen changes nothing", () => {
  const store = createActionFeedbackStore(() => 1000);
  store.show({ kind: "success", title: "Скопировано", key: "copy" });
  const before = store.getSnapshot();
  store.dismissKey(FORWARD_FEEDBACK_KEY);
  // The same object, so `useSyncExternalStore` does not render for nothing.
  assert.equal(store.getSnapshot(), before);
});
