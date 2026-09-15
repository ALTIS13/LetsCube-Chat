// What the support workspace's controls require, and how it says so (D-144).
//
// Every bound below is checked against the function the press actually calls,
// read off production on 2026-09-15 — which is how the sixth defect turned up:
// the editor's textarea allowed 4000 characters for all five actions and three
// of the five functions refuse anything over 1000.
import assert from "node:assert/strict";
import test from "node:test";

import {
  SUPPORT_ACTION_TEXT_BOUNDS,
  supportActionBlocker,
  supportActionFieldHint,
  supportActionFieldLabel,
  supportActorLabel,
  supportAssigneeLabel,
  supportReplyNotice,
  supportSettingsBlocker,
  type SupportEditorAction,
} from "../../artifacts/kub/src/lib/support/operatorRules.ts";

const ACTIONS: SupportEditorAction[] = ["transfer", "return", "escalate", "resolve", "close"];

// --- A-65: the inline editor ----------------------------------------------

test("each action carries the bound of the function it calls", () => {
  // support_ticket_transfer        3..1000  (p_comment)
  // support_ticket_return_to_pool  3..1000  (p_reason)
  // support_ticket_escalate        3..1000  (p_reason)
  // support_ticket_resolve         3..4000  (p_summary)
  // support_ticket_close           3..4000  (p_summary)
  assert.deepEqual(SUPPORT_ACTION_TEXT_BOUNDS.transfer, { min: 3, max: 1000 });
  assert.deepEqual(SUPPORT_ACTION_TEXT_BOUNDS.return, { min: 3, max: 1000 });
  assert.deepEqual(SUPPORT_ACTION_TEXT_BOUNDS.escalate, { min: 3, max: 1000 });
  assert.deepEqual(SUPPORT_ACTION_TEXT_BOUNDS.resolve, { min: 3, max: 4000 });
  assert.deepEqual(SUPPORT_ACTION_TEXT_BOUNDS.close, { min: 3, max: 4000 });
});

test("a reason the server refuses is refused here first", () => {
  // The defect the measurement found: 1500 characters could be typed in full
  // for a transfer and came back as `invalid_support_transfer`.
  const long = "я".repeat(1500);
  assert.equal(
    supportActionBlocker({ action: "transfer", comment: long, operatorId: "op-2" }),
    "Слишком длинно: не больше 1000 символов.",
  );
  assert.equal(supportActionBlocker({ action: "escalate", comment: long }), "Слишком длинно: не больше 1000 символов.");
  assert.equal(supportActionBlocker({ action: "return", comment: long }), "Слишком длинно: не больше 1000 символов.");
  // The same text is fine for the two that accept 4000.
  assert.equal(supportActionBlocker({ action: "resolve", comment: long }), null);
  assert.equal(supportActionBlocker({ action: "close", comment: long }), null);
});

test("the minimum is named rather than left to be guessed", () => {
  for (const action of ACTIONS) {
    const blocker = supportActionBlocker({
      action,
      comment: "ок",
      operatorId: action === "transfer" ? "op-2" : undefined,
    });
    assert.ok(blocker, `${action} must refuse two characters`);
    assert.match(blocker!, /не меньше 3 символов/);
  }
});

test("the minimum counts trimmed text, as `btrim` does on the server", () => {
  assert.ok(supportActionBlocker({ action: "resolve", comment: "   а   " }));
  assert.equal(supportActionBlocker({ action: "resolve", comment: "  готово  " }), null);
});

test("a transfer asks for the colleague before it asks for the text", () => {
  // The select is above the textarea, so this is also the order of the form.
  assert.equal(
    supportActionBlocker({ action: "transfer", comment: "", operatorId: "" }),
    "Выберите коллегу, которому передаёте обращение.",
  );
  assert.equal(
    supportActionBlocker({ action: "transfer", comment: "", operatorId: "   " }),
    "Выберите коллегу, которому передаёте обращение.",
  );
  assert.match(
    supportActionBlocker({ action: "transfer", comment: "", operatorId: "op-2" })!,
    /не меньше 3 символов/,
  );
  // Only transfer has an operator; the other four never ask for one.
  assert.equal(supportActionBlocker({ action: "escalate", comment: "потому что" }), null);
});

test("the hint is on screen before anything is typed, and names both bounds", () => {
  assert.equal(supportActionFieldHint("transfer"), "От 3 до 1000 символов. Текст попадёт в историю обращения.");
  assert.equal(supportActionFieldHint("close"), "От 3 до 4000 символов. Текст попадёт в историю обращения.");
});

test("the field is «Итог» for the two that end a ticket and «Причина» otherwise", () => {
  assert.equal(supportActionFieldLabel("resolve"), "Итог");
  assert.equal(supportActionFieldLabel("close"), "Итог");
  assert.equal(supportActionFieldLabel("transfer"), "Причина");
  assert.equal(supportActionFieldLabel("return"), "Причина");
  assert.equal(supportActionFieldLabel("escalate"), "Причина");
  // And the refusal uses that word, lower-cased, rather than a third name.
  assert.match(supportActionBlocker({ action: "close", comment: "" })!, /Опишите итог/);
  assert.match(supportActionBlocker({ action: "return", comment: "" })!, /Опишите причину/);
});

// --- A-69: «Настройки поддержки» -------------------------------------------

const SETTINGS = {
  closedMessage: "Приём обращений временно закрыт.",
  ticketLimit15m: 3,
  ticketLimitDay: 10,
  messageLimit5m: 20,
  messageLimitDay: 200,
};

test("the shipped defaults save", () => {
  assert.equal(supportSettingsBlocker(SETTINGS), null);
});

test("every bound of support_settings_update_v2 is named when it is missed", () => {
  const cases: [Partial<typeof SETTINGS>, RegExp][] = [
    [{ closedMessage: "ок" }, /не меньше 3 символов/],
    [{ closedMessage: "я".repeat(501) }, /не больше 500 символов/],
    [{ ticketLimit15m: 0 }, /за 15 минут — от 1 до 50/],
    [{ ticketLimit15m: 51, ticketLimitDay: 500 }, /за 15 минут — от 1 до 50/],
    [{ ticketLimitDay: 501 }, /за сутки — от 1 до 500/],
    [{ ticketLimit15m: 20, ticketLimitDay: 10 }, /Суточный лимит обращений/],
    [{ messageLimit5m: 0 }, /за 5 минут — от 1 до 200/],
    [{ messageLimit5m: 201, messageLimitDay: 5000 }, /за 5 минут — от 1 до 200/],
    [{ messageLimitDay: 5001 }, /за сутки — от 1 до 5000/],
    [{ messageLimit5m: 100, messageLimitDay: 20 }, /Суточный лимит сообщений/],
  ];
  for (const [patch, expected] of cases) {
    const blocker = supportSettingsBlocker({ ...SETTINGS, ...patch });
    assert.ok(blocker, `expected a refusal for ${JSON.stringify(patch)}`);
    assert.match(blocker!, expected);
  }
});

test("a number field emptied to NaN is refused rather than sent", () => {
  // `Number(event.target.value)` on an empty `<input type="number">` is NaN,
  // and `NaN < 1` is false — so a bare comparison would have let it through to
  // `invalid_support_settings`.
  assert.ok(supportSettingsBlocker({ ...SETTINGS, ticketLimit15m: Number("") }));
  assert.ok(supportSettingsBlocker({ ...SETTINGS, messageLimitDay: Number.NaN }));
  assert.ok(supportSettingsBlocker({ ...SETTINGS, ticketLimitDay: 10.5 }));
});

// --- A-63: the composer's notice -------------------------------------------

const REPLY_LABEL = "Отвечать в обращениях";
const notice = (over: Partial<Parameters<typeof supportReplyNotice>[0]>) =>
  supportReplyNotice({
    canReply: true,
    canControl: true,
    status: "in_progress",
    replyPermissionLabel: REPLY_LABEL,
    ...over,
  });

test("a ticket in hand and open has no notice at all — the composer is there", () => {
  for (const status of ["new", "in_progress", "waiting_user", "waiting_support", "escalated", "resolved"] as const) {
    assert.equal(notice({ status }), null, status);
  }
});

test("a closed ticket says it is closed, not that it must be accepted", () => {
  // This is the defect: the operator who closed it, holding every permission,
  // was told «Сначала примите обращение…».
  const closed = notice({ status: "closed" });
  assert.equal(closed?.text, "Обращение закрыто. Откройте его заново, чтобы ответить.");
  assert.doesNotMatch(closed!.text, /примите обращение/);
});

test("spam is its own answer", () => {
  assert.equal(notice({ status: "spam" })?.text, "Обращение помечено как спам. Отвечать в нём нельзя.");
});

test("the permission is named as the catalogue names it", () => {
  const refused = notice({ canReply: false });
  assert.equal(refused?.text, `Чтобы отвечать в обращениях, нужно право «${REPLY_LABEL}».`);
  // «Ответы поддержки» was the old sentence and exists nowhere in the product.
  assert.doesNotMatch(refused!.text, /Ответы поддержки/);
});

test("missing permission outranks the ticket's state", () => {
  // Somebody with no right to reply should be told that, not told to reopen.
  assert.match(notice({ canReply: false, status: "closed" })!.text, /нужно право/);
});

test("an unassigned open ticket still asks to be accepted", () => {
  const unassigned = notice({ canControl: false });
  assert.equal(unassigned?.text, "Сначала примите обращение или откройте назначенное вам обращение.");
  assert.equal(unassigned?.tone, "warn");
});

// --- A-60 and A-67: who --------------------------------------------------

const OPERATORS = [
  { id: "op-1", fullName: "Мария Соколова", username: "maria" },
  { id: "op-2", fullName: "", username: "pavel" },
  { id: "op-3", fullName: "  ", username: null },
];

test("a queue row names the operator when the directory is readable", () => {
  assert.equal(
    supportAssigneeLabel({ assignedOperatorId: "op-1", currentUserId: "me", operators: OPERATORS }),
    "Назначено: Мария Соколова",
  );
  // No name stored: the никнейм, which is at least a handle somebody can search.
  assert.equal(
    supportAssigneeLabel({ assignedOperatorId: "op-2", currentUserId: "me", operators: OPERATORS }),
    "Назначено: @pavel",
  );
});

test("a row assigned to the reader says so", () => {
  assert.equal(
    supportAssigneeLabel({ assignedOperatorId: "me", currentUserId: "me", operators: OPERATORS }),
    "Назначено вам",
  );
});

test("an unresolvable operator keeps the old words rather than inventing a name", () => {
  // `support_operator_directory` refuses anybody without `support.transfer` or
  // `support.manage`, and `SupportTab` turns that refusal into an empty list —
  // so this is the ordinary case for a plain operator, not an edge.
  assert.equal(
    supportAssigneeLabel({ assignedOperatorId: "op-9", currentUserId: "me", operators: OPERATORS }),
    "Назначено оператору",
  );
  assert.equal(
    supportAssigneeLabel({ assignedOperatorId: "op-1", currentUserId: "me", operators: [] }),
    "Назначено оператору",
  );
  // Neither a name nor a никнейм: still not a bare id on the screen.
  assert.equal(
    supportAssigneeLabel({ assignedOperatorId: "op-3", currentUserId: "me", operators: OPERATORS }),
    "Назначено: Оператор",
  );
});

test("an unassigned row is the общий пул", () => {
  assert.equal(supportAssigneeLabel({ assignedOperatorId: null, currentUserId: "me", operators: OPERATORS }), "Общий пул");
  assert.equal(supportAssigneeLabel({ assignedOperatorId: "  ", currentUserId: "me", operators: OPERATORS }), "Общий пул");
});

test("a history row says who acted, and tells the client from a colleague", () => {
  const actor = (id: string | null) =>
    supportActorLabel({
      actorUserId: id,
      currentUserId: "me",
      operators: OPERATORS,
      requesterUserId: "client-1",
    });
  assert.equal(actor("me"), "Вы");
  assert.equal(actor("client-1"), "Клиент");
  assert.equal(actor("op-1"), "Мария Соколова");
  assert.equal(actor("op-9"), "Оператор");
});

test("a system event has no actor, and gets no name invented for it", () => {
  // `ticket_created` from the guest form carries `actor_user_id = null`.
  assert.equal(
    supportActorLabel({ actorUserId: null, currentUserId: "me", operators: OPERATORS }),
    null,
  );
  assert.equal(
    supportActorLabel({ actorUserId: "   ", currentUserId: "me", operators: OPERATORS }),
    null,
  );
});

test("«Вы» wins over the directory, and over being the requester", () => {
  // An operator who opened their own ticket is still «Вы» on their own events.
  assert.equal(
    supportActorLabel({
      actorUserId: "op-1",
      currentUserId: "op-1",
      operators: OPERATORS,
      requesterUserId: "op-1",
    }),
    "Вы",
  );
});
