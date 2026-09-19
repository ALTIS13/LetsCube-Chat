import { button, keyboard, type AppContext } from "#pf/app/context";
import type { CallbackContext, Feature, MessageContext } from "#pf/app/router";
import type { Classification } from "#pf/lib/classify";
import { asCode, clampMessage } from "#pf/lib/render";
import { LETSCUBE_GAPS } from "#pf/transport/letscube";
import { clearPendingPrompt, readPendingPrompt, setPendingPrompt } from "#pf/store/prompts";
import { setDeveloperMode, setTimeZone } from "#pf/store/users";
import type { Update } from "#pf/transport/types";

/**
 * Settings, the status card, and Developer Mode (§11, §14).
 *
 * Three small things that share a home because they share a shape: each is a
 * single screen the person reads and occasionally changes, and none of them
 * belongs in the inbox.
 *
 * **Developer Mode is gated twice, and the two gates are not the same.** The
 * allowlist in `DEVELOPER_IDS` is the *authorization*; the per-person toggle
 * only decides whether a developer's own ordinary use of the bot is cluttered
 * with test commands. A toggle alone would be self-service privilege
 * escalation, which is the shape this kind of feature usually ships with.
 */

const TZ = "set.tz";
const TZ_MANUAL = "set.tzmanual";
const DEV_TOGGLE = "set.dev";
const OPEN = "settings.open";

/** The kind this feature writes into `pf_pending_prompts`, shared with every other. */
const PROMPT_TIMEZONE = "settings.timezone";

/**
 * The offered zones.
 *
 * Russia's, because that is who uses this, plus UTC — and «указать вручную»
 * for everyone else, because a list that tried to be complete would be a
 * scrolling wall and still miss somebody.
 */
const COMMON_ZONES: { label: string; zone: string }[] = [
  { label: "Калининград", zone: "Europe/Kaliningrad" },
  { label: "Москва", zone: "Europe/Moscow" },
  { label: "Самара", zone: "Europe/Samara" },
  { label: "Екатеринбург", zone: "Asia/Yekaterinburg" },
  { label: "Омск", zone: "Asia/Omsk" },
  { label: "Красноярск", zone: "Asia/Krasnoyarsk" },
  { label: "Иркутск", zone: "Asia/Irkutsk" },
  { label: "Якутск", zone: "Asia/Yakutsk" },
  { label: "Владивосток", zone: "Asia/Vladivostok" },
  { label: "UTC", zone: "UTC" },
];

/**
 * The last update each developer saw, for `/debug`.
 *
 * In memory on purpose. An update carries somebody's message text, and §20
 * forbids logging personal payloads — writing them to a table so a developer
 * can look at them later would be the same mistake with a longer retention.
 * This is one entry per developer, dropped on restart.
 */
const lastUpdate = new Map<string, Update>();

export function recordUpdateForDebug(userId: string | null, update: Update): void {
  if (!userId) return;
  lastUpdate.set(userId, update);
  // Bounded so a busy instance cannot grow this without limit.
  if (lastUpdate.size > 32) {
    const oldest = lastUpdate.keys().next().value;
    if (oldest !== undefined) lastUpdate.delete(oldest);
  }
}

/**
 * An update with everything identifying or private removed.
 *
 * §14 is explicit about what must never appear: tokens, webhook secrets,
 * database credentials, internal authorization headers, private environment
 * variables. None of those are in an update — but message text is, and it is
 * somebody's private message, so it is replaced by its shape rather than shown.
 */
export function sanitizeUpdate(update: Update): Record<string, unknown> {
  const base = { update_id: update.updateId, kind: update.kind };
  switch (update.kind) {
    case "message":
    case "edited_message":
      return {
        ...base,
        message: {
          id: update.message.id,
          chat: { id: update.message.chat.id, kind: update.message.chat.kind },
          from: { id: update.message.from.id, is_bot: update.message.from.isBot },
          date: update.message.date.toISOString(),
          text_length: update.message.text?.length ?? 0,
          has_reply: update.message.replyToMessageId !== null,
          topic_id: update.message.topicId,
          attachment: update.message.attachment
            ? {
                kind: update.message.attachment.kind,
                mime_type: update.message.attachment.mimeType,
                byte_size: update.message.attachment.byteSize,
              }
            : null,
        },
      };
    case "callback_query":
      return {
        ...base,
        callback_query: {
          id: update.callbackQuery.id,
          from: { id: update.callbackQuery.from.id },
          // The action word only. The arguments are object ids, which are not
          // secret, but a developer debugging dispatch needs the action.
          action: update.callbackQuery.data.split(":")[0] ?? "",
          message: update.callbackQuery.message,
        },
      };
    case "membership":
      return { ...base, membership: update.membership };
    case "unsupported":
      return { ...base, raw_type: update.rawType };
  }
}

async function countRows(ctx: AppContext, sql: string, ownerId: string): Promise<number> {
  const result = await ctx.db.query<{ count: string }>(sql, [ownerId]);
  return Number(result.rows[0]?.count ?? "0");
}

async function statusCard(ctx: AppContext, ownerId: string): Promise<string> {
  const [saved, reminders, webhooks, watchers] = await Promise.all([
    countRows(ctx, "select count(*)::text as count from pf_saved_items where owner_id = $1", ownerId),
    countRows(
      ctx,
      "select count(*)::text as count from pf_reminders where owner_id = $1 and state = 'pending'",
      ownerId,
    ),
    countRows(ctx, "select count(*)::text as count from pf_webhooks where owner_id = $1", ownerId),
    countRows(
      ctx,
      "select count(*)::text as count from pf_watchers where owner_id = $1 and enabled",
      ownerId,
    ),
  ]);
  // §11 asks for a table. There are no rich messages on this platform (G-6), so
  // it is an aligned plain-text one inside a code span — which is also the only
  // way to keep the column alignment from being eaten by the client's own
  // formatter (G-5).
  const rows: [string, number][] = [
    ["Напоминания", reminders],
    ["Webhooks", webhooks],
    ["Наблюдатели", watchers],
    ["Сохранено", saved],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  const table = rows
    .map(([label, value]) => `${label.padEnd(width, " ")}  ${String(value).padStart(3, " ")}`)
    .join("\n");
  return clampMessage(`PocketFlow\n\n${asCode(table)}`);
}

function zoneNow(zone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(at);
  } catch {
    return "—";
  }
}

function settingsText(ctx: AppContext, timeZone: string, developer: boolean, dev: boolean): string {
  const lines = [
    "Настройки",
    "",
    `Часовой пояс: ${timeZone} (сейчас ${zoneNow(timeZone, ctx.now())})`,
  ];
  if (developer) lines.push(`Developer Mode: ${dev ? "включён" : "выключен"}`);
  return lines.join("\n");
}

function settingsKeyboard(developer: boolean, dev: boolean) {
  const zoneRows: ReturnType<typeof button>[][] = [];
  for (let index = 0; index < COMMON_ZONES.length; index += 2) {
    const row = COMMON_ZONES.slice(index, index + 2).map((entry) =>
      button(entry.label, TZ, entry.zone),
    );
    zoneRows.push(row);
  }
  const tail: ReturnType<typeof button>[] = [button("Указать вручную", TZ_MANUAL)];
  if (developer) {
    tail.push(button(dev ? "Выключить Developer Mode" : "Developer Mode", DEV_TOGGLE));
  }
  // Eight rows is the platform's ceiling for a keyboard, so the five zone rows
  // plus one tail row fits with room to spare.
  return keyboard(...zoneRows.slice(0, 5), tail);
}

export function createSettingsFeature(): Feature {
  return {
    name: "settings",
    // `dev`, `debug` and `capabilities` are deliberately absent from the menu.
    // They answer «не знаю такой команды» to everybody outside DEVELOPER_IDS,
    // and listing a command that most readers cannot use is an invitation to
    // keep trying it.
    commandList: [
      { command: "status", description: "Что сейчас есть" },
      { command: "settings", description: "Часовой пояс и режимы" },
    ],

    commands: {
      async status(input: CommandContextLike) {
        await input.ctx.bot.sendText({
          chatId: input.message.chat.id,
          text: await statusCard(input.ctx, input.user.userId),
        });
      },

      async settings(input: CommandContextLike) {
        const developer = input.ctx.config.developerIds.has(input.user.userId);
        await input.ctx.bot.sendText({
          chatId: input.message.chat.id,
          text: settingsText(input.ctx, input.user.timeZone, developer, input.user.developerMode),
          keyboard: settingsKeyboard(developer, input.user.developerMode),
        });
      },

      async dev(input: CommandContextLike) {
        if (!input.ctx.config.developerIds.has(input.user.userId)) {
          // The same answer an unknown command gets. Telling somebody that a
          // command exists but is not for them is an invitation to keep trying.
          await input.ctx.bot.sendText({
            chatId: input.message.chat.id,
            text: "Не знаю такой команды. /help покажет, что я умею.",
          });
          return;
        }
        const next = !input.user.developerMode;
        await setDeveloperMode(input.ctx.db, input.user.userId, next);
        await input.ctx.bot.sendText({
          chatId: input.message.chat.id,
          text: next
            ? "Developer Mode включён. Доступны /debug и /capabilities."
            : "Developer Mode выключен.",
        });
      },

      async debug(input: CommandContextLike) {
        if (!allowedDeveloper(input)) {
          await unknownCommand(input);
          return;
        }
        const update = lastUpdate.get(input.user.userId);
        await input.ctx.bot.sendText({
          chatId: input.message.chat.id,
          text: update
            ? clampMessage(asCode(JSON.stringify(sanitizeUpdate(update), null, 2)))
            : "Пока нечего показать — пришлите что-нибудь и повторите.",
        });
      },

      async capabilities(input: CommandContextLike) {
        if (!allowedDeveloper(input)) {
          await unknownCommand(input);
          return;
        }
        const lines = ["Возможности платформы", ""];
        for (const [capability, reason] of LETSCUBE_GAPS) {
          lines.push(`⛔ ${capability} — ${reason}`);
        }
        lines.push("", "Остальное из списка транспорта поддерживается. /selftest проверит.");
        await input.ctx.bot.sendText({
          chatId: input.message.chat.id,
          text: clampMessage(lines.join("\n")),
        });
      },
    },

    callbacks: {
      async [OPEN](input: CallbackContext) {
        const developer = input.ctx.config.developerIds.has(input.user.userId);
        await input.ctx.bot.answerCallbackQuery(input.query.id);
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId,
          messageId: input.query.message.id,
          text: settingsText(input.ctx, input.user.timeZone, developer, input.user.developerMode),
          keyboard: settingsKeyboard(developer, input.user.developerMode),
        });
      },

      async [TZ](input: CallbackContext) {
        const zone = input.args[0] ?? "";
        try {
          await setTimeZone(input.ctx.db, input.user.userId, zone);
        } catch {
          await input.ctx.bot.answerCallbackQuery(input.query.id, {
            text: "Не знаю такого часового пояса",
          });
          return;
        }
        const developer = input.ctx.config.developerIds.has(input.user.userId);
        await input.ctx.bot.answerCallbackQuery(input.query.id, {
          text: `Теперь ${zone}`,
        });
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId,
          messageId: input.query.message.id,
          text: settingsText(input.ctx, zone, developer, input.user.developerMode),
          keyboard: settingsKeyboard(developer, input.user.developerMode),
        });
      },

      async [TZ_MANUAL](input: CallbackContext) {
        await input.ctx.bot.answerCallbackQuery(input.query.id);
        await input.ctx.bot.sendText({
          chatId: input.query.message.chatId,
          text: "Пришлите название зоны IANA, например Asia/Tbilisi.",
        });
        await setPendingPrompt(input.ctx.db, {
          chatId: input.query.message.chatId,
          userId: input.user.userId,
          kind: PROMPT_TIMEZONE,
          context: {},
          expiresAt: new Date(input.ctx.now().getTime() + 10 * 60_000),
        });
      },

      async [DEV_TOGGLE](input: CallbackContext) {
        if (!input.ctx.config.developerIds.has(input.user.userId)) {
          // A press is not authorization either (§19). The button is only ever
          // drawn for a developer, but the data arrives from a client.
          await input.ctx.bot.answerCallbackQuery(input.query.id, {
            text: "Эта кнопка больше не действует",
          });
          return;
        }
        const next = !input.user.developerMode;
        await setDeveloperMode(input.ctx.db, input.user.userId, next);
        await input.ctx.bot.answerCallbackQuery(input.query.id, {
          text: next ? "Developer Mode включён" : "Developer Mode выключен",
        });
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId,
          messageId: input.query.message.id,
          text: settingsText(input.ctx, input.user.timeZone, true, next),
          keyboard: settingsKeyboard(true, next),
        });
      },
    },

    async onMessage(input: MessageContext, classification: Classification): Promise<boolean> {
      if (classification.kind !== "text") return false;
      // Read, then clear only if it is ours. A blind delete would swallow
      // another feature's prompt — the row is one per (chat, user), so
      // whoever deletes first wins and the other flow is left waiting for an
      // answer that already went somewhere else.
      const pending = await readPendingPrompt(
        input.ctx.db,
        input.message.chat.id,
        input.user.userId,
        input.ctx.now(),
      );
      if (pending?.kind !== PROMPT_TIMEZONE) return false;
      await clearPendingPrompt(input.ctx.db, input.message.chat.id, input.user.userId);
      try {
        await setTimeZone(input.ctx.db, input.user.userId, classification.text.trim());
      } catch {
        await input.ctx.bot.sendText({
          chatId: input.message.chat.id,
          text: "Не знаю такой зоны. Нужно название IANA, например Europe/Belgrade.",
        });
        return true;
      }
      await input.ctx.bot.sendText({
        chatId: input.message.chat.id,
        text: `Часовой пояс: ${classification.text.trim()}`,
      });
      return true;
    },
  };
}

type CommandContextLike = Parameters<NonNullable<Feature["commands"]>[string]>[0];

function allowedDeveloper(input: CommandContextLike): boolean {
  return (
    input.ctx.config.developerIds.has(input.user.userId) && input.user.developerMode === true
  );
}

async function unknownCommand(input: CommandContextLike): Promise<void> {
  await input.ctx.bot.sendText({
    chatId: input.message.chat.id,
    text: "Не знаю такой команды. /help покажет, что я умею.",
  });
}
