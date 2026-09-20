// What the bot settings panel says.
//
// D-145: nine actions changed the server and said nothing, every failure landed
// in one banner above the tabs — on the «Основное» tab that banner belonged to
// a section the reader could not see — and the signing secret had to be retyped
// before anything else in «Webhook» would save, with nothing on the screen
// saying why.
//
// D-133, rows B-08, B-12 and B-15: three actions ran on the press.
//
// The words are data rather than markup so this file can read them without a
// browser. That the panel really prints them is proved on the screen, in
// `tests/e2e/bot-management.spec.ts`.

import assert from "node:assert/strict";
import test from "node:test";

import {
  BOT_WEBHOOK_SECRET_HINT,
  botActionFeedback,
  botActionSection,
  BOT_SETTINGS_ACTIONS,
  botAvatarRemoveConfirm,
  botDeveloperRemoveConfirm,
  botWebhookDeleteConfirm,
  type BotSettingsAction,
} from "../../artifacts/kub/src/lib/botSettingsCopy.ts";

const ACTIONS: BotSettingsAction[] = [
  "profile",
  "avatarUpload",
  "avatarRemove",
  "pause",
  "resume",
  "requestDeletion",
  "cancelDeletion",
  "commands",
  "webhookSave",
  "webhookDelete",
  "rotateToken",
  "revokeToken",
  "addDeveloper",
  "removeDeveloper",
];

/**
 * The list above is the panel's own, and this is what keeps it honest: every
 * key of `COPY` has to appear in it, and nothing else may. Without this the
 * suite walks a list that can silently fall behind the table — measured on
 * 2026-09-20, when a re-added `privacyRequest` entry left every test green.
 */
test("the hand-written list is exactly what the table holds", () => {
  assert.deepEqual([...BOT_SETTINGS_ACTIONS].sort(), [...ACTIONS].sort());
});

test("nothing the panel can set off asks for something nobody can grant", () => {
  // D-257: «Запросить полный доступ» had no answer anywhere — no approver in
  // the client, the server or the database — so the request was a permanent
  // state that read as a pending one. D-276 removed it; this is what stops it
  // coming back through the copy table.
  for (const action of BOT_SETTINGS_ACTIONS) {
    assert.ok(
      !action.toLowerCase().includes("privacy"),
      `«${action}» is a privacy action again, and nothing in this product answers one`,
    );
    const done = botActionFeedback(action);
    if (!done) continue;
    for (const word of ["запрос", "одобр", "рассмотр"]) {
      assert.ok(
        !`${done.title} ${done.detail ?? ""}`.toLocaleLowerCase("ru-RU").includes(word),
        `«${done.title}» promises «${word}», which nothing can deliver`,
      );
    }
  }
});

test("every action says something when it works, except the one whose result is already on screen", () => {
  for (const action of ACTIONS) {
    const done = botActionFeedback(action);
    if (action === "rotateToken") {
      // Rotation ends by putting the new token in a dialog that is shown once
      // and dismissed deliberately. A toast over the top of it would cover the
      // only copy of the thing a person came for.
      assert.equal(done, null, "a rotation announces itself with the token dialog");
      continue;
    }
    assert.ok(done, `«${action}» succeeds in silence`);
    assert.equal(done.kind, "success");
    assert.ok(done.title.length > 0 && done.title.length <= 24, `«${done.title}» is not one short line`);
    // Keyed by the action, so pressing one button twice replaces its own
    // confirmation instead of stacking a second copy beside the first.
    assert.equal(done.key, `bot-settings:${action}`);
  }
});

test("a save says «Сохранено» and names what was saved; anything else says what it did", () => {
  // The register asked for «Сохранено». There are three save buttons across two
  // tabs, so the word alone cannot tell them apart — hence the second line.
  for (const action of ["profile", "commands", "webhookSave"] as const) {
    const done = botActionFeedback(action)!;
    assert.equal(done.title, "Сохранено");
    assert.ok(done.detail && done.detail.length > 0, `«${action}» says «Сохранено» about nothing`);
  }
  // And «Сохранено» after «Убрать» would confirm the wrong thing.
  for (const action of ["avatarRemove", "webhookDelete", "removeDeveloper", "pause"] as const) {
    assert.notEqual(botActionFeedback(action)!.title, "Сохранено");
  }
});

test("an action's error belongs to the section whose button produced it", () => {
  assert.equal(botActionSection("profile"), "profile");
  // The avatar controls sit inside «Профиль», so their failures do too.
  assert.equal(botActionSection("avatarUpload"), "profile");
  assert.equal(botActionSection("avatarRemove"), "profile");
  assert.equal(botActionSection("webhookSave"), "webhook");
  assert.equal(botActionSection("webhookDelete"), "webhook");
  assert.equal(botActionSection("commands"), "commands");
  assert.equal(botActionSection("rotateToken"), "token");
  assert.equal(botActionSection("revokeToken"), "token");
  assert.equal(botActionSection("addDeveloper"), "developers");
  assert.equal(botActionSection("removeDeveloper"), "developers");
  // «Запросить удаление» has a section of its own, below «Состояние». Sending
  // its failure to the state box would put it under the wrong heading.
  assert.equal(botActionSection("requestDeletion"), "deletion");
  assert.equal(botActionSection("pause"), "state");
  assert.equal(botActionSection("resume"), "state");
  // Cancelling a deletion is pressed in «Состояние» — the «Удаление» box is not
  // drawn at all once the bot is pending_delete — so that is where it reports.
  assert.equal(botActionSection("cancelDeletion"), "state");
});

test("the secret hint says why the field is empty and that an address-only change still needs it", () => {
  // The decision recorded in D-145: the stored secret cannot be kept. The
  // gateway's PUT takes a required `secret` on a strict schema,
  // `bot_management_webhook_set_internal` raises on a null ciphertext, and the
  // browser has never held the value to resend. So the field explains itself
  // rather than looking broken.
  assert.match(BOT_WEBHOOK_SECRET_HINT, /не возвращает/);
  assert.match(BOT_WEBHOOK_SECRET_HINT, /заново/);
  // The half that was actually surprising: the secret is demanded even when
  // only the URL is being changed.
  assert.match(BOT_WEBHOOK_SECRET_HINT, /только адрес/);
});

test("each confirmation is a question, with a red button that names the action", () => {
  const requests = [
    botAvatarRemoveConfirm(),
    botWebhookDeleteConfirm({ dropPending: false }),
    botWebhookDeleteConfirm({ dropPending: true }),
    botDeveloperRemoveConfirm({ displayName: "Анна Смирнова" }),
  ];
  for (const request of requests) {
    assert.ok(request.title.endsWith("?"), `«${request.title}» is not a question`);
    // KubModal truncates its title to one line beside an icon and a ✕; the
    // sign-out question was measured at 390 and settled on this bound.
    assert.ok(request.title.length <= 24, `«${request.title}» is cut off on a phone`);
    assert.equal(request.tone, "danger");
    assert.equal(request.cancelLabel, "Отмена");
    // Never «Подтвердить»: a button has to say what pressing it does.
    assert.notEqual(request.confirmLabel, "Подтвердить");
    assert.match(request.confirmLabel, /^(Убрать|Удалить webhook)$/);
    // One line about consequences, not a paragraph, and not a scolding.
    assert.ok(request.description.length <= 200, "the line under the question is a paragraph");
    assert.equal(request.description.includes("!"), false);
  }
});

test("removing the picture says where the bot changes, and that it is reversible", () => {
  const request = botAvatarRemoveConfirm();
  assert.match(request.description, /значком робота/);
  assert.match(request.description, /заново/);
  assert.equal(request.icon, "image");
});

test("deleting the webhook says what stops, and follows the pending-updates box", () => {
  const kept = botWebhookDeleteConfirm({ dropPending: false });
  const dropped = botWebhookDeleteConfirm({ dropPending: true });
  for (const request of [kept, dropped]) {
    assert.match(request.description, /перестанет получать обновления/);
    assert.equal(request.icon, "webhook");
  }
  // The two outcomes differ in the thing a person would mind. Read off
  // `bot_management_webhook_delete_internal`: unacknowledged `bot_updates` are
  // deleted only when `p_drop_pending_updates` is true.
  assert.match(kept.description, /останутся в очереди/);
  assert.match(dropped.description, /удалены без доставки/);
  assert.notEqual(kept.description, dropped.description);
});

test("removing a developer names the person it reaches and what they lose", () => {
  const request = botDeveloperRemoveConfirm({ displayName: "Анна Смирнова" });
  assert.match(request.description, /^Анна Смирнова потеряет доступ/);
  assert.match(request.description, /командам, webhook и диагностике/);
  assert.equal(request.icon, "userRemove");
  // A developer the server named with nothing printable is still a person, so
  // the sentence stands with a word in their place rather than with a gap.
  for (const displayName of ["", "   ", null, undefined]) {
    const anonymous = botDeveloperRemoveConfirm({ displayName });
    assert.match(anonymous.description, /^Разработчик потеряет доступ/);
  }
  assert.match(botDeveloperRemoveConfirm({ displayName: "  Анна  " }).description, /^Анна потеряет доступ/);
});
