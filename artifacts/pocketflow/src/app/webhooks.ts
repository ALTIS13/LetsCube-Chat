import { button, keyboard, type AppContext } from "#pf/app/context";
import type { CallbackContext, CommandContext, Feature, MessageContext } from "#pf/app/router";
import { hookUrl } from "#pf/http/hookRoute";
import { buildEventCard } from "#pf/lib/eventCard";
import { asCode, untrusted } from "#pf/lib/render";
import {
  clearPendingPromptOfKind,
  takePendingPrompt,
  setPendingPrompt,
  PROMPT_TTL_MINUTES,
} from "#pf/store/prompts";
import {
  asWebhookId,
  createWebhook,
  deleteWebhook,
  getWebhook,
  listWebhooks,
  normalizeDisplayName,
  renameWebhook,
  rotateWebhookSecret,
  setWebhookEnabled,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_WEBHOOKS_PER_OWNER,
  type Webhook,
} from "#pf/store/webhooks";

/**
 * Managing the webhook inbox from inside a chat (§5).
 *
 * **The rule this file exists to obey.** `callback_data` arrives from a
 * client. It is a string the presser's device sent, and a device can send any
 * string — so the webhook id inside it is a *lookup key and never a
 * permission*. Every handler here therefore re-reads the row from the database
 * and compares `webhook.ownerId` against the id the platform says pressed the
 * button, before it does anything at all. `ownedWebhook()` below is that
 * check, it is the first line of every callback, and there is no path around
 * it.
 *
 * The store's mutations repeat the owner in their WHERE clause as well. That
 * is not redundancy for its own sake: the two checks fail differently — one
 * refuses and says so, the other silently changes nothing — and the one here
 * is the one that also stops a stranger *learning* the name and the delivery
 * count of somebody else's webhook from the reply.
 *
 * **The secret is shown twice in its life**: in the reply to «Создать» and in
 * the reply to «Новый секрет». `pf_webhooks` stores a KDF output and nothing
 * else, so «покажите ещё раз» is not a feature that was left out, it is a
 * question the schema cannot answer.
 */

const PROMPT_KINDS: readonly string[] = ["webhook_create", "webhook_rename"];
type PromptKind = "webhook_create" | "webhook_rename";

type PromptRow = { kind: string; context: Record<string, unknown> };

/**
 * «What is this chat in the middle of» goes through `store/prompts.ts`.
 *
 * That module owns the table, reminders and settings already use it, and a
 * second copy of a shared table's access rules is how two features end up
 * disagreeing about whose prompt is whose. The three wrappers below add the
 * only thing this feature needs on top: a `kind` check, so that «пришлите
 * дату» belonging to reminders is neither read as a webhook name nor deleted
 * by `/webhooks`.
 */
async function setPrompt(
  ctx: AppContext,
  input: { chatId: string; userId: string; kind: PromptKind; context: Record<string, unknown> },
): Promise<void> {
  await setPendingPrompt(ctx.db, {
    chatId: input.chatId,
    userId: input.userId,
    kind: input.kind,
    context: input.context,
    expiresAt: new Date(ctx.now().getTime() + PROMPT_TTL_MINUTES * 60_000),
  });
}

/** This feature's pending prompt, consumed, or null if the answer is not ours. */
async function takePrompt(
  ctx: AppContext,
  chatId: string,
  userId: string,
): Promise<PromptRow | null> {
  // One statement, and filtered by kind. Read-then-clear let two messages
  // arriving together both be read as the answer, and an unfiltered clear
  // would cancel a reminder's half-finished question — the row is one per
  // (chat, user).
  const prompt = await takePendingPrompt(ctx.db, chatId, userId, PROMPT_KINDS, ctx.now());
  if (prompt === null) return null;
  return { kind: prompt.kind, context: prompt.context };
}

async function clearPrompt(ctx: AppContext, chatId: string, userId: string): Promise<void> {
  await clearPendingPromptOfKind(ctx.db, chatId, userId, PROMPT_KINDS);
}

function formatWhen(date: Date | null, timeZone: string): string {
  if (date === null) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    // A time zone that stopped being valid between the row being written and
    // read is not a reason to fail a list.
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

function listText(webhooks: Webhook[]): string {
  if (webhooks.length === 0) {
    return [
      "Webhooks — входящие события",
      "",
      "Создайте адрес, и всё, что умеет отправлять HTTP-запрос — CI, мониторинг, ваш скрипт — сможет написать сюда.",
    ].join("\n");
  }
  const lines = ["Webhooks — входящие события", ""];
  for (const webhook of webhooks) {
    const state = webhook.enabled ? `${webhook.eventCount} событий` : "выключен";
    lines.push(`• ${untrusted(webhook.displayName)} — ${state}`);
  }
  lines.push("");
  lines.push(`Занято ${webhooks.length} из ${MAX_WEBHOOKS_PER_OWNER}.`);
  return lines.join("\n");
}

function listKeyboard(webhooks: Webhook[]) {
  const rows = webhooks.map((webhook) => [
    button(webhook.displayName.slice(0, 48), "whshow", webhook.id),
  ]);
  if (webhooks.length < MAX_WEBHOOKS_PER_OWNER) rows.push([button("Создать", "whnew")]);
  return keyboard(...rows);
}

function detailText(ctx: AppContext, webhook: Webhook, timeZone: string): string {
  const lines = [untrusted(webhook.displayName), ""];
  const base = ctx.config.publicBaseUrl;
  if (base === null) {
    lines.push("PUBLIC_BASE_URL не настроен, поэтому адрес показать нечем.");
    lines.push(`Идентификатор: ${webhook.id}`);
  } else {
    lines.push("Адрес:");
    lines.push(asCode(hookUrl(base, webhook.id)));
  }
  lines.push("");
  lines.push(`Состояние: ${webhook.enabled ? "включён" : "выключен"}`);
  lines.push(`Событий: ${webhook.eventCount}`);
  lines.push(`Последнее: ${formatWhen(webhook.lastUsedAt, timeZone)}`);
  return lines.join("\n");
}

function detailKeyboard(webhook: Webhook) {
  return keyboard(
    [button("Тест", "whtest", webhook.id), button("Переименовать", "whname", webhook.id)],
    [
      button("Новый секрет", "whrot", webhook.id),
      button(webhook.enabled ? "Выключить" : "Включить", "whtoggle", webhook.id),
    ],
    [button("Удалить", "whdel", webhook.id), button("К списку", "whlist")],
  );
}

/**
 * The one message in this feature that contains a secret.
 *
 * Written as a ready-to-paste `curl` because the alternative is a person
 * assembling the header themselves, getting it wrong, and concluding the
 * webhook is broken. Inside a code span so the client renders it character for
 * character — a secret with an asterisk in it would otherwise arrive missing
 * the asterisk, which is the worst possible way for this to fail.
 */
function secretText(ctx: AppContext, webhook: Webhook, secret: string, headline: string): string {
  const lines = [headline, ""];
  lines.push(
    "Секрет показывается один раз. Сохраните его сейчас — прочитать его снова нельзя, только перевыпустить.",
  );
  lines.push("");
  const base = ctx.config.publicBaseUrl;
  const url =
    base === null ? `https://<PUBLIC_BASE_URL>/hook/${webhook.id}` : hookUrl(base, webhook.id);
  lines.push(
    asCode(
      [
        `curl -X POST ${url} \\`,
        `  -H "Authorization: Bearer ${secret}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '{"title":"Сборка упала","status":"failed"}'`,
      ].join("\n"),
    ),
  );
  if (base === null) {
    lines.push("");
    lines.push("PUBLIC_BASE_URL не настроен — подставьте адрес, на котором доступен PocketFlow.");
  }
  return lines.join("\n");
}

async function showList(ctx: AppContext, chatId: string, ownerId: string): Promise<void> {
  const webhooks = await listWebhooks(ctx.db, ownerId);
  await ctx.bot.sendText({
    chatId,
    text: listText(webhooks),
    keyboard: listKeyboard(webhooks),
  });
}

/**
 * Re-reads the row and checks the presser owns it. The whole point of the file.
 *
 * Returns null when the answer is no, having already answered the callback so
 * the button stops spinning. The caller must treat null as «stop».
 */
async function ownedWebhook(input: CallbackContext): Promise<Webhook | null> {
  const { ctx, query, user } = input;
  const id = asWebhookId(String(input.args[0] ?? ""));
  if (id === null) {
    await ctx.bot.answerCallbackQuery(query.id, { text: "Кнопка устарела" });
    return null;
  }
  const webhook = await getWebhook(ctx.db, id);
  if (webhook === null) {
    await ctx.bot.answerCallbackQuery(query.id, { text: "Этот webhook уже удалён" });
    return null;
  }
  if (webhook.ownerId !== user.userId) {
    // Worth a line in the log: a press on somebody else's webhook is not
    // something an unmodified client can produce by accident.
    ctx.log.warn("webhooks.foreign_press", { webhook_id: webhook.id });
    await ctx.bot.answerCallbackQuery(query.id, { text: "Это не ваш webhook" });
    return null;
  }
  return webhook;
}

async function createFromName(
  ctx: AppContext,
  input: { chatId: string; ownerId: string; rawName: string },
): Promise<void> {
  const displayName = normalizeDisplayName(input.rawName);
  if (displayName === null) {
    await ctx.bot.sendText({
      chatId: input.chatId,
      text: `Название не может быть пустым. Отправьте /webhooks и нажмите «Создать» ещё раз (до ${MAX_DISPLAY_NAME_LENGTH} символов).`,
    });
    return;
  }
  const created = await createWebhook(ctx.db, {
    ownerId: input.ownerId,
    chatId: input.chatId,
    displayName,
  });
  if (created === null) {
    await ctx.bot.sendText({
      chatId: input.chatId,
      text: `Больше ${MAX_WEBHOOKS_PER_OWNER} webhooks на одного человека я не держу. Удалите ненужный и попробуйте снова.`,
    });
    return;
  }
  ctx.log.info("webhooks.created", { webhook_id: created.webhook.id });
  await ctx.bot.sendText({
    chatId: input.chatId,
    text: secretText(
      ctx,
      created.webhook,
      created.secret,
      `«${created.webhook.displayName}» создан.`,
    ),
    keyboard: keyboard([button("К webhook", "whshow", created.webhook.id)]),
  });
}

/**
 * The list screen, reached by either spelling of the command.
 *
 * Typing it is also how a person gets out of a half-finished «пришлите
 * название»: the command clears this feature's prompt first, so an abandoned
 * flow cannot quietly eat their next message.
 */
async function openWebhooks(input: CommandContext): Promise<void> {
  await clearPrompt(input.ctx, input.message.chat.id, input.user.userId);
  await showList(input.ctx, input.message.chat.id, input.user.userId);
}

export function webhooksFeature(): Feature {
  return {
    name: "webhooks",
    // `/hook` is deliberately absent from the menu: one name belongs in the
    // client's command list, and `/webhooks` is the one that says what it
    // opens. The alias below exists because the owner's brief spells it
    // «/hook», and a command somebody was told to type answering «не знаю
    // такой команды» is a worse first impression than a duplicate entry.
    commandList: [
      { command: "webhooks", description: "Входящие webhooks: события из CI, мониторинга, скриптов" },
    ],

    commands: {
      webhooks: openWebhooks,
      hook: openWebhooks,
    },

    callbacks: {
      async whlist(input: CallbackContext): Promise<void> {
        await input.ctx.bot.answerCallbackQuery(input.query.id);
        await showList(input.ctx, input.query.message.chatId, input.user.userId);
      },

      async whnew(input: CallbackContext): Promise<void> {
        await input.ctx.bot.answerCallbackQuery(input.query.id);
        await setPrompt(input.ctx, {
          chatId: input.query.message.chatId,
          userId: input.user.userId,
          kind: "webhook_create",
          context: {},
        });
        await input.ctx.bot.sendText({
          chatId: input.query.message.chatId,
          text: "Как назвать? Например «Grafana» или «Сборка». Название видите только вы — оно стоит в заголовке каждого события.",
        });
      },

      async whshow(input: CallbackContext): Promise<void> {
        const webhook = await ownedWebhook(input);
        if (webhook === null) return;
        await input.ctx.bot.answerCallbackQuery(input.query.id);
        await input.ctx.bot.sendText({
          chatId: input.query.message.chatId,
          text: detailText(input.ctx, webhook, input.user.timeZone),
          keyboard: detailKeyboard(webhook),
        });
      },

      async whtest(input: CallbackContext): Promise<void> {
        const webhook = await ownedWebhook(input);
        if (webhook === null) return;
        await input.ctx.bot.answerCallbackQuery(input.query.id, {
          text: "Отправил тестовое событие",
        });
        // Built by the same function the real deliveries use, so what a person
        // sees here is what they will see at three in the morning.
        const card = buildEventCard({
          sourceName: webhook.displayName,
          body: {
            title: "Тестовое событие",
            status: "ok",
            message: "Если вы это видите, webhook доставляет события в этот чат.",
          },
        });
        await input.ctx.bot.sendText({ chatId: webhook.chatId, text: card });
      },

      async whname(input: CallbackContext): Promise<void> {
        const webhook = await ownedWebhook(input);
        if (webhook === null) return;
        await input.ctx.bot.answerCallbackQuery(input.query.id);
        await setPrompt(input.ctx, {
          chatId: input.query.message.chatId,
          userId: input.user.userId,
          kind: "webhook_rename",
          // The id is kept server-side rather than carried through the
          // conversation, and it is checked again when the answer arrives.
          context: { webhookId: webhook.id },
        });
        await input.ctx.bot.sendText({
          chatId: input.query.message.chatId,
          text: `Новое название для «${untrusted(webhook.displayName)}»?`,
        });
      },

      async whrot(input: CallbackContext): Promise<void> {
        const webhook = await ownedWebhook(input);
        if (webhook === null) return;
        const rotated = await rotateWebhookSecret(input.ctx.db, {
          id: webhook.id,
          ownerId: input.user.userId,
        });
        if (rotated === null) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, { text: "Не получилось" });
          return;
        }
        input.ctx.log.info("webhooks.secret_rotated", { webhook_id: webhook.id });
        await input.ctx.bot.answerCallbackQuery(input.query.id, { text: "Секрет перевыпущен" });
        await input.ctx.bot.sendText({
          chatId: input.query.message.chatId,
          text: secretText(
            input.ctx,
            rotated.webhook,
            rotated.secret,
            `Новый секрет для «${rotated.webhook.displayName}». Старый больше не принимается.`,
          ),
          keyboard: keyboard([button("К webhook", "whshow", webhook.id)]),
        });
      },

      async whtoggle(input: CallbackContext): Promise<void> {
        const webhook = await ownedWebhook(input);
        if (webhook === null) return;
        const updated = await setWebhookEnabled(input.ctx.db, {
          id: webhook.id,
          ownerId: input.user.userId,
          enabled: !webhook.enabled,
        });
        if (updated === null) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, { text: "Не получилось" });
          return;
        }
        await input.ctx.bot.answerCallbackQuery(input.query.id, {
          text: updated.enabled ? "Включён" : "Выключен",
        });
        await input.ctx.bot.sendText({
          chatId: input.query.message.chatId,
          text: detailText(input.ctx, updated, input.user.timeZone),
          keyboard: detailKeyboard(updated),
        });
      },

      async whdel(input: CallbackContext): Promise<void> {
        const webhook = await ownedWebhook(input);
        if (webhook === null) return;
        await input.ctx.bot.answerCallbackQuery(input.query.id);
        await input.ctx.bot.sendText({
          chatId: input.query.message.chatId,
          text: `Удалить «${untrusted(webhook.displayName)}»? Адрес перестанет принимать события, и вернуть его нельзя.`,
          keyboard: keyboard(
            [button("Да, удалить", "whdelok", webhook.id)],
            [button("Отмена", "whshow", webhook.id)],
          ),
        });
      },

      async whdelok(input: CallbackContext): Promise<void> {
        const webhook = await ownedWebhook(input);
        if (webhook === null) return;
        const deleted = await deleteWebhook(input.ctx.db, {
          id: webhook.id,
          ownerId: input.user.userId,
        });
        input.ctx.log.info("webhooks.deleted", { webhook_id: webhook.id, deleted });
        await input.ctx.bot.answerCallbackQuery(input.query.id, {
          text: deleted ? "Удалён" : "Уже удалён",
        });
        await showList(input.ctx, input.query.message.chatId, input.user.userId);
      },
    },

    async onMessage(input: MessageContext): Promise<boolean> {
      const text = input.message.text;
      if (text === null || text.trim().length === 0) return false;
      const prompt = await takePrompt(input.ctx, input.message.chat.id, input.user.userId);
      if (prompt === null) return false;

      if (prompt.kind === "webhook_create") {
        await createFromName(input.ctx, {
          chatId: input.message.chat.id,
          ownerId: input.user.userId,
          rawName: text,
        });
        return true;
      }

      if (prompt.kind === "webhook_rename") {
        const id = asWebhookId(String(prompt.context.webhookId ?? ""));
        const displayName = normalizeDisplayName(text);
        if (id === null || displayName === null) {
          await input.ctx.bot.sendText({
            chatId: input.message.chat.id,
            text: "Не понял название. Откройте /webhooks и попробуйте ещё раз.",
          });
          return true;
        }
        // Checked again even though the id came from our own prompt row: the
        // row is keyed by chat and user, and a second person in a group chat
        // must not be able to answer somebody else's question. The owner
        // filter in the statement is what decides it.
        const renamed = await renameWebhook(input.ctx.db, {
          id,
          ownerId: input.user.userId,
          displayName,
        });
        await input.ctx.bot.sendText({
          chatId: input.message.chat.id,
          text:
            renamed === null
              ? "Этот webhook больше не ваш или уже удалён."
              : `Теперь это «${untrusted(renamed.displayName)}».`,
          keyboard:
            renamed === null ? undefined : keyboard([button("К webhook", "whshow", renamed.id)]),
        });
        return true;
      }

      return false;
    },
  };
}
