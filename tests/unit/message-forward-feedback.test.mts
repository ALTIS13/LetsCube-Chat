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
 */

test("a delivered forward is a success, and it names the chat it went to", () => {
  const feedback = forwardFeedback({ ok: true, error: null }, "Архив задач");
  assert.equal(feedback.kind, "success");
  assert.equal(feedback.title, "Сообщение переслано");
  assert.match(feedback.detail ?? "", /«Архив задач»/);
});

test("a delivered forward to a chat without a usable name leaves the name out rather than printing it blank", () => {
  for (const name of [null, undefined, "", "   "]) {
    const feedback = forwardFeedback({ ok: true, error: null }, name);
    assert.equal(feedback.kind, "success", `name ${JSON.stringify(name)}`);
    assert.equal(feedback.detail, undefined, `name ${JSON.stringify(name)}`);
  }
});

test("a refused forward is an error, and carries the reason it was refused", () => {
  const feedback = forwardFeedback({ ok: false, error: "Недостаточно прав для этого действия." }, "Архив задач");
  assert.equal(feedback.kind, "error");
  assert.equal(feedback.title, "Не удалось переслать сообщение");
  assert.equal(feedback.detail, "Недостаточно прав для этого действия.");
});

test("a failure that arrives without a reason still reads as a failure", () => {
  const feedback = forwardFeedback({ ok: false, error: "   " }, "Архив задач");
  assert.equal(feedback.kind, "error");
  assert.ok((feedback.detail ?? "").trim().length > 0, "an empty detail leaves only the title to say why");
});

test("a forward that works after one that failed replaces the failure instead of contradicting it", () => {
  const store = createActionFeedbackStore(() => 1000);
  store.show(forwardFeedback({ ok: false, error: "Сетевой сбой. Проверьте подключение и попробуйте ещё раз." }, "Архив задач"));
  store.show(forwardFeedback({ ok: true, error: null }, "Архив задач"));

  const items = store.getSnapshot();
  assert.equal(items.length, 1, "the stale failure is still on screen beside the success");
  assert.equal(items[0].kind, "success");
  assert.equal(items[0].key, FORWARD_FEEDBACK_KEY);
});
