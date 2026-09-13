/**
 * What the bot settings panel says (D-145, and the bot half of D-133).
 *
 * Three things brought this module into being, and all three are words rather
 * than markup, which is why they live away from the component that prints them.
 *
 * **Nothing said a save had worked.** Every one of the panel's nine actions
 * ended in silence, so the only way to find out whether a press had done
 * anything was to press it again. The panel now hands `showActionFeedback` one
 * of the lines below.
 *
 * **Every failure landed in one banner above the tabs.** A person who pressed
 * «Сохранить webhook» read, if they scrolled up far enough, a sentence at the
 * top of the screen with nothing tying it to the section that failed — and on
 * the «Основное» tab that banner belonged to a section they could not even see.
 * Each action now names the section its error belongs beside.
 *
 * **Three actions ran on the tap** (D-133 rows B-08, B-12, B-15). They ask
 * first, in Telegram's shape: the title is the question, one line says what
 * stops working or who it reaches, the confirming button names the action, and
 * «Отмена» stands beside it.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 * `tone` and `icon` are literal types rather than imports from the dialog and
 * icon modules — dragging components into a module of sentences would defeat
 * the point — and they are still checked against `requestAppConfirm` at each
 * call site.
 */

/**
 * Where an error belongs. One per `Section` the panel draws, so a failure can
 * be printed inside the box whose button produced it.
 */
export type BotSettingsSection =
  | "profile"
  | "state"
  | "deletion"
  | "commands"
  | "webhook"
  | "privacy"
  | "token"
  | "developers";

/** Everything the panel can set off. Not every one of them is a save. */
export type BotSettingsAction =
  | "profile"
  | "avatarUpload"
  | "avatarRemove"
  | "pause"
  | "resume"
  | "requestDeletion"
  | "cancelDeletion"
  | "commands"
  | "webhookSave"
  | "webhookDelete"
  | "privacyRequest"
  | "privacyCancel"
  | "rotateToken"
  | "revokeToken"
  | "addDeveloper"
  | "removeDeveloper";

export interface BotActionCopy {
  /** Which `Section` prints this action's error. */
  section: BotSettingsSection;
  /**
   * What the confirmation says, or null where the result already speaks.
   *
   * Only `rotateToken` is null: it ends by putting the new token on the screen
   * in a dialog that has to be dismissed deliberately. A toast saying the same
   * thing over the top of it would be noise covering the one thing that is
   * shown exactly once.
   */
  done: { title: string; detail?: string } | null;
}

/**
 * The register asked for «Сохранено», and a save says exactly that; what was
 * saved goes on the second line, because the panel has three save buttons on
 * two tabs and «Сохранено» alone cannot tell them apart. An action that is not
 * a save says what it did instead — «Сохранено» after «Убрать» would be a
 * confirmation of the wrong thing.
 */
const COPY: Record<BotSettingsAction, BotActionCopy> = {
  profile: { section: "profile", done: { title: "Сохранено", detail: "Профиль бота обновлён." } },
  avatarUpload: { section: "profile", done: { title: "Картинка загружена" } },
  avatarRemove: { section: "profile", done: { title: "Картинка убрана" } },
  pause: { section: "state", done: { title: "Бот на паузе" } },
  resume: { section: "state", done: { title: "Бот возобновлён" } },
  requestDeletion: { section: "deletion", done: { title: "Удаление запланировано" } },
  cancelDeletion: { section: "state", done: { title: "Удаление отменено" } },
  commands: { section: "commands", done: { title: "Сохранено", detail: "Команды бота обновлены." } },
  webhookSave: { section: "webhook", done: { title: "Сохранено", detail: "Webhook обновлён." } },
  webhookDelete: { section: "webhook", done: { title: "Webhook удалён" } },
  privacyRequest: { section: "privacy", done: { title: "Запрос отправлен" } },
  privacyCancel: { section: "privacy", done: { title: "Запрос отменён" } },
  rotateToken: { section: "token", done: null },
  revokeToken: { section: "token", done: { title: "Токен отозван" } },
  addDeveloper: { section: "developers", done: { title: "Разработчик добавлен" } },
  removeDeveloper: { section: "developers", done: { title: "Разработчик убран" } },
};

/** Which section prints this action's error. */
export function botActionSection(action: BotSettingsAction): BotSettingsSection {
  return COPY[action].section;
}

/**
 * What to hand `showActionFeedback` when the action succeeded, or null where
 * the result is already on the screen.
 *
 * The key is the action, so pressing one button twice replaces its own
 * confirmation rather than stacking a second copy beside the first.
 */
export function botActionFeedback(
  action: BotSettingsAction,
): { kind: "success"; title: string; detail?: string; key: string } | null {
  const done = COPY[action].done;
  if (!done) return null;
  return { kind: "success", title: done.title, detail: done.detail, key: `bot-settings:${action}` };
}

/**
 * Why the signing secret has to be typed again, said under the field.
 *
 * The entry (D-145) asked for a decision rather than a change: can a stored
 * secret be kept when only the address moves? It cannot, and not by an
 * oversight in this panel. The gateway's `PUT /bots/:id/webhook` takes a
 * required `secret` on a `.strict()` schema, and
 * `bot_management_webhook_set_internal` raises `bot_webhook_input_invalid` on a
 * null ciphertext before it reaches its upsert — which then writes
 * `secret_ciphertext = excluded.secret_ciphertext` unconditionally. Nothing
 * client-side could keep it either: the secret is sealed with a key only the
 * gateway process holds, and the detail route returns `{ configured, url }`
 * with no ciphertext in it, so the browser has never had the value to resend.
 *
 * So the interface stops pretending. It says why the field is empty and that
 * an address-only change still needs it — which is the part that was surprising
 * enough to look like a bug.
 */
export const BOT_WEBHOOK_SECRET_HINT =
  "Сервер не возвращает сохранённый секрет, поэтому вводите его заново при каждом сохранении — даже если меняется только адрес.";

export interface BotConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: "danger";
  icon: "image" | "webhook" | "userRemove";
}

/**
 * B-08. «Убрать» sat beside «Заменить картинку» and cleared the picture on the
 * press. Reversible — another upload puts one back — but the picture is the
 * bot's face everywhere it appears, and a mis-tap next to «Заменить» is exactly
 * how it went.
 */
export function botAvatarRemoveConfirm(): BotConfirmRequest {
  return {
    title: "Убрать картинку бота?",
    description:
      "Бот снова будет показан значком робота — в чатах, в списке ботов и в его настройках. Картинку можно загрузить заново.",
    confirmLabel: "Убрать",
    cancelLabel: "Отмена",
    tone: "danger",
    icon: "image",
  };
}

/**
 * B-12. «Удалить webhook» is the one action on the panel that stops delivery,
 * and it ran on the press beside «Сохранить webhook».
 *
 * The second sentence follows the checkbox above the button, because the two
 * outcomes differ in the thing a person would mind: without it the queued
 * updates wait, and with it they are thrown away undelivered. Read off
 * `bot_management_webhook_delete_internal`, which disables the webhook and
 * drops the delivery lease either way, and deletes unacknowledged
 * `bot_updates` only when `p_drop_pending_updates` is true.
 */
export function botWebhookDeleteConfirm(options: { dropPending: boolean }): BotConfirmRequest {
  return {
    title: "Удалить webhook?",
    description: options.dropPending
      ? "Бот перестанет получать обновления на этот адрес, а обновления в очереди будут удалены без доставки."
      : "Бот перестанет получать обновления на этот адрес. Обновления останутся в очереди до следующего webhook или getUpdates.",
    confirmLabel: "Удалить webhook",
    cancelLabel: "Отмена",
    tone: "danger",
    icon: "webhook",
  };
}

/**
 * B-15. The only action on this panel that reaches somebody else, and the only
 * one drawn as a bare icon in a row — so the question names the person out
 * loud, and the sentence says what they lose rather than what the owner does.
 *
 * A developer with no name to print is still a person, so the sentence stands
 * with «Разработчик» in their place rather than with a gap.
 */
export function botDeveloperRemoveConfirm(developer: { displayName?: string | null }): BotConfirmRequest {
  const name = (developer.displayName ?? "").trim();
  return {
    title: "Убрать разработчика?",
    description: `${name || "Разработчик"} потеряет доступ к командам, webhook и диагностике бота. Вернуть доступ можно, добавив разработчика снова по имени пользователя.`,
    confirmLabel: "Убрать",
    cancelLabel: "Отмена",
    tone: "danger",
    icon: "userRemove",
  };
}
