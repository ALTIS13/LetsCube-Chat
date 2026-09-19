import { createHash } from "node:crypto";

import { button, keyboard, type AppContext } from "#pf/app/context";
import type { CallbackContext, Feature, MessageContext } from "#pf/app/router";
import { prettyJson, type Classification } from "#pf/lib/classify";
import { asCode, clampMessage, untrusted } from "#pf/lib/render";
import { SafeFetchError, safeFetch } from "#pf/lib/safeFetch";
import { SsrfError } from "#pf/lib/ssrf";
import { rememberCandidate, readCandidate } from "#pf/store/candidates";
import {
  countItems,
  deleteItem,
  listItems,
  saveItem,
  searchItems,
  type SavedKind,
} from "#pf/store/saved";
import type { ChatId, MessageId } from "#pf/transport/types";

/**
 * The smart inbox (§3) — the thing a person actually uses PocketFlow for.
 *
 * Send it anything and it works out what the thing is and offers what can be
 * done with it. The decision is `classify()`, a pure function with its own
 * test, so «what did it decide this was» is answerable without a database or a
 * network.
 *
 * **Every button here does something.** The ones that would need the bot to
 * send a file back — QR (§3), format conversion and «Send back» (§7) — are
 * absent rather than present-and-apologetic, because gap **G-1** means the
 * platform gives a bot no way to put bytes into a message. `/selftest` reports
 * them as UNSUPPORTED with the reason. A control that cannot change its own
 * outcome is the defect this project's register spends most of its pages on.
 *
 * **How a button knows what it refers to.** The callback update carries the id
 * of the bot's own message, not of the one the person sent, and there is no
 * `getMessage` to read the original back. So the offer stashes the content as
 * an *inbox candidate* and the button carries that row's id. The handler
 * re-reads it scoped to the presser, which is also §19's rule that callback
 * data proves nothing.
 */

const SAVE = "inbox.save";
const PRETTY = "inbox.pretty";
const SHA = "inbox.sha";
const FORGET = "inbox.forget";
const PAGE = "inbox.page";
const STATUS = "inbox.status";

/** Owned by the reminders feature; the inbox only offers it. */
const REMIND_FROM = "remind.from";
/** Owned by the watcher feature; the inbox only offers it. */
const WATCH_FROM = "watch.from";

/**
 * The list screens `/start` links to, each owned by another feature.
 *
 * Named here as constants rather than written inline, because a typo in one is
 * a button that silently answers «Эта кнопка больше не действует» — which is
 * exactly what happened with `hook.list`, caught by `tests/pocketflow/wiring`
 * rather than by anybody pressing it.
 */
const REMINDERS_LIST = "rem.list";
const WEBHOOKS_LIST = "whlist";
const WATCH_LIST = "watch.list";

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Hashes a file the bot was sent, without ever holding all of it.
 *
 * The bound matters: `getFile` will hand back a signed URL for a 100 MB video,
 * and a bot that buffers it is a bot that dies on somebody else's upload. The
 * stream is abandoned the moment the budget is spent, and the timeout covers
 * the case where the bytes simply stop arriving.
 */
export async function sha256OfUrl(
  url: string,
  options?: { maxBytes?: number; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<string | null> {
  const maxBytes = options?.maxBytes ?? MAX_DOWNLOAD_BYTES;
  const doFetch = options?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 30_000);
  try {
    const response = await doFetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) return null;
    const hash = createHash("sha256");
    let seen = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      seen += chunk.byteLength;
      if (seen > maxBytes) return null;
      hash.update(chunk);
    }
    return hash.digest("hex");
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

export function humanBytes(bytes: number | null): string {
  if (bytes === null) return "размер неизвестен";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function firstLine(content: string, limit = 80): string {
  const head = content.split("\n")[0] ?? "";
  return head.length > limit ? `${head.slice(0, limit)}…` : head;
}

async function savedPage(
  ctx: AppContext,
  ownerId: string,
  offset: number,
  query: string | null,
): Promise<{ text: string; markup: ReturnType<typeof keyboard> }> {
  const pageSize = 10;
  const items = query
    ? await searchItems(ctx.db, ownerId, query, pageSize)
    : await listItems(ctx.db, ownerId, { limit: pageSize, offset });
  const total = await countItems(ctx.db, ownerId);

  if (items.length === 0) {
    return {
      text: query
        ? `Ничего не нашёл по запросу «${untrusted(query)}».`
        : "Пока ничего не сохранено. Пришлите мне текст, ссылку или файл.",
      markup: keyboard(),
    };
  }

  const body = items
    .map((item, index) => `${offset + index + 1}. [${item.kind}] ${untrusted(firstLine(item.content))}`)
    .join("\n");
  const header = query ? `Найдено по «${untrusted(query)}»` : `Сохранённое (${total})`;

  const controls = [];
  if (!query && offset > 0) {
    controls.push(button("Назад", PAGE, String(Math.max(0, offset - pageSize))));
  }
  if (!query && offset + pageSize < total) {
    controls.push(button("Дальше", PAGE, String(offset + pageSize)));
  }

  return {
    text: clampMessage(`${header}\n\n${body}`),
    // Five delete buttons rather than ten: a keyboard row is capped at eight
    // buttons and a keyboard at eight rows, and a wall of ✕ is not a list
    // anybody can read.
    markup: keyboard(
      items.slice(0, 5).map((item, index) => button(`✕ ${offset + index + 1}`, FORGET, item.id)),
      controls,
    ),
  };
}

export const HELP = [
  "PocketFlow сохраняет полезное, напоминает о важном, принимает события от",
  "внешних сервисов и помогает работать с файлами прямо в мессенджере.",
  "",
  "Пришлите мне что угодно — текст, ссылку, файл — и я предложу, что с этим сделать.",
  "",
  "/saved — сохранённое",
  "/remind 20m Проверить сервер — напоминание",
  "/reminders — список напоминаний",
  "/webhooks — входящие события от внешних сервисов",
  "/watch — следить за адресом",
  "/poll Вопрос | Да | Нет — опрос в группе",
  "/task Релиз | собрать | выкатить — список дел",
  "/streamdemo — пошаговый отчёт",
  "/status — что сейчас есть",
  "/settings — часовой пояс",
].join("\n");

/** Stashes the offer's subject and returns the token a button can carry. */
async function offer(
  input: MessageContext,
  kind: SavedKind,
  content: string,
  fileId?: string | null,
): Promise<string> {
  return rememberCandidate(input.ctx.db, {
    ownerId: input.user.userId,
    chatId: input.message.chat.id,
    sourceMessageId: input.message.id,
    kind,
    content,
    fileId: fileId ?? null,
  });
}

export function createInboxFeature(): Feature {
  return {
    name: "inbox",
    commandList: [
      { command: "start", description: "Начать" },
      { command: "help", description: "Что я умею" },
      { command: "saved", description: "Сохранённое" },
    ],

    commands: {
      async start(input) {
        await input.ctx.bot.sendText({
          chatId: input.message.chat.id,
          text: HELP,
          keyboard: keyboard(
            [button("Сохранённое", PAGE, "0"), button("Напоминания", REMINDERS_LIST)],
            [button("Webhooks", WEBHOOKS_LIST), button("Watcher", WATCH_LIST)],
          ),
        });
      },

      async help(input) {
        await input.ctx.bot.sendText({ chatId: input.message.chat.id, text: HELP });
      },

      async saved(input) {
        const page = await savedPage(
          input.ctx,
          input.user.userId,
          0,
          input.args.trim() || null,
        );
        await input.ctx.bot.sendText({
          chatId: input.message.chat.id,
          text: page.text,
          keyboard: page.markup.rows.length > 0 ? page.markup : undefined,
        });
      },
    },

    callbacks: {
      async [PAGE](input: CallbackContext) {
        const parsed = Number(input.args[0] ?? "0");
        const offset = Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
        const page = await savedPage(input.ctx, input.user.userId, offset, null);
        // Edited in place rather than sent again (§2): a list that grows a new
        // copy every time somebody turns the page buries the conversation.
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId,
          messageId: input.query.message.id,
          text: page.text,
          keyboard: page.markup.rows.length > 0 ? page.markup : undefined,
        });
        await input.ctx.bot.answerCallbackQuery(input.query.id);
      },

      async [SAVE](input: CallbackContext) {
        const candidate = await readCandidate(input.ctx.db, input.user.userId, input.args[0] ?? "");
        if (!candidate) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, {
            text: "Это предложение больше не действует",
          });
          return;
        }
        await saveItem(input.ctx.db, {
          ownerId: candidate.ownerId,
          chatId: candidate.chatId,
          kind: candidate.kind,
          content: candidate.content,
          sourceMessageId: candidate.sourceMessageId,
          fileId: candidate.fileId,
        });
        await input.ctx.bot.answerCallbackQuery(input.query.id, { text: "Сохранено" });
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId,
          messageId: input.query.message.id,
          text: `Сохранено: ${untrusted(firstLine(candidate.content, 60))}`,
        });
      },

      async [PRETTY](input: CallbackContext) {
        const candidate = await readCandidate(input.ctx.db, input.user.userId, input.args[0] ?? "");
        if (!candidate) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, {
            text: "Это предложение больше не действует",
          });
          return;
        }
        await input.ctx.bot.answerCallbackQuery(input.query.id);
        let parsed: unknown;
        try {
          parsed = JSON.parse(candidate.content);
        } catch {
          await input.ctx.bot.sendText({
            chatId: input.query.message.chatId,
            text: "Это уже не разбирается как JSON.",
          });
          return;
        }
        await input.ctx.bot.sendText({
          chatId: input.query.message.chatId,
          text: clampMessage(asCode(prettyJson(parsed))),
        });
      },

      async [SHA](input: CallbackContext) {
        const candidate = await readCandidate(input.ctx.db, input.user.userId, input.args[0] ?? "");
        if (!candidate) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, {
            text: "Это предложение больше не действует",
          });
          return;
        }
        await input.ctx.bot.answerCallbackQuery(input.query.id);

        if (candidate.fileId === null) {
          const digest = createHash("sha256").update(candidate.content, "utf8").digest("hex");
          await input.ctx.bot.sendText({
            chatId: input.query.message.chatId,
            text: `SHA-256 текста (UTF-8)\n${asCode(digest)}`,
          });
          return;
        }

        // A download and a hash take long enough that silence reads as
        // nothing happening. `sendChatAction` is what the platform has for
        // exactly this, and it costs one call.
        await input.ctx.bot.sendChatAction(
          candidate.chatId as ChatId,
          "upload_document",
        );
        const handle = await input.ctx.bot.getFile(
          candidate.chatId as ChatId,
          candidate.fileId,
        );
        const digest = await sha256OfUrl(handle.url);
        await input.ctx.bot.sendText({
          chatId: input.query.message.chatId,
          text:
            digest === null
              ? "Не удалось прочитать файл целиком — возможно, он слишком большой."
              : `SHA-256 файла\n${asCode(digest)}`,
        });
      },

      async [STATUS](input: CallbackContext) {
        const candidate = await readCandidate(input.ctx.db, input.user.userId, input.args[0] ?? "");
        if (!candidate) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, {
            text: "Это предложение больше не действует",
          });
          return;
        }
        await input.ctx.bot.answerCallbackQuery(input.query.id, { text: "Проверяю…" });
        await input.ctx.bot.sendChatAction(candidate.chatId as ChatId, "typing");

        // The same guarded client the watcher uses, and for the same reason:
        // this fetches an address somebody typed, so it is an SSRF surface
        // whether it runs once or every five minutes. `truncate` rather than
        // the default, because only the status line is wanted here and a large
        // page must not be reported as a failure.
        try {
          const result = await safeFetch(candidate.content, {
            method: "GET",
            maxBytes: 64 * 1024,
            onOversize: "truncate",
            timeoutMs: 10_000,
          });
          const lines = [
            (result.status < 400 ? "🟢 " : "🔴 ") + result.status,
            "За " + Math.round(result.elapsedMs) + " мс",
          ];
          if (result.redirects > 0) {
            lines.push("Переходов: " + result.redirects);
            lines.push("Итог: " + untrusted(result.finalUrl));
          }
          await input.ctx.bot.sendText({
            chatId: input.query.message.chatId,
            text: clampMessage(lines.join(String.fromCharCode(10))),
          });
        } catch (error) {
          // `publicMessage` is the only thing shown. A detailed reason maps the
          // network this bot runs in, and a per-address answer is an oracle;
          // the guard author made that call and it holds here too.
          const message =
            error instanceof SsrfError || error instanceof SafeFetchError
              ? error.publicMessage
              : "Не удалось проверить адрес";
          await input.ctx.bot.sendText({
            chatId: input.query.message.chatId,
            text: "🔴 " + message,
          });
        }
      },
      async [FORGET](input: CallbackContext) {
        // The id in the button is a lookup, never a permission: `deleteItem`
        // is scoped to the owner, so a forged id naming somebody else's item
        // deletes nothing and says so.
        const removed = await deleteItem(input.ctx.db, input.user.userId, input.args[0] ?? "");
        await input.ctx.bot.answerCallbackQuery(input.query.id, {
          text: removed ? "Удалено" : "Не найдено",
        });
        if (!removed) return;
        const page = await savedPage(input.ctx, input.user.userId, 0, null);
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId,
          messageId: input.query.message.id,
          text: page.text,
          keyboard: page.markup.rows.length > 0 ? page.markup : undefined,
        });
      },
    },

    async onMessage(input: MessageContext, classification: Classification): Promise<boolean> {
      const chatId = input.message.chat.id;
      const replyTo = input.message.id as MessageId;

      switch (classification.kind) {
        case "text": {
          const token = await offer(input, "text", classification.text);
          await input.ctx.bot.sendText({
            chatId,
            text: "Что сделать с этим текстом?",
            replyToMessageId: replyTo,
            keyboard: keyboard([
              button("Сохранить", SAVE, token),
              button("Напомнить", REMIND_FROM, token),
              button("SHA256", SHA, token),
            ]),
          });
          return true;
        }

        case "url": {
          const token = await offer(input, "url", classification.url);
          await input.ctx.bot.sendText({
            chatId,
            text: clampMessage(`Ссылка\nХост: ${untrusted(classification.hostname)}`),
            replyToMessageId: replyTo,
            keyboard: keyboard(
              [button("Сохранить", SAVE, token), button("Следить", WATCH_FROM, token)],
              [button("Проверить сейчас", STATUS, token)],
            ),
          });
          return true;
        }

        case "json": {
          const token = await offer(input, "json", classification.text);
          // Formatted at once rather than behind a button: the person already
          // sent the document, and a round trip asking «показать читаемо?» is
          // the sort of service message §2 asks to avoid.
          await input.ctx.bot.sendText({
            chatId,
            text: clampMessage(asCode(prettyJson(classification.parsed))),
            replyToMessageId: replyTo,
            keyboard: keyboard([
              button("Сохранить", SAVE, token),
              button("SHA256", SHA, token),
            ]),
          });
          return true;
        }

        case "photo":
        case "document":
        case "voice":
        case "video": {
          const attachment = input.message.attachment;
          const lines: string[] = [];
          let kind: SavedKind = "document";
          if (classification.kind === "photo") {
            kind = "photo";
            lines.push("Фото");
            if (classification.mimeType) lines.push(`Формат: ${classification.mimeType}`);
          } else if (classification.kind === "voice") {
            kind = "voice";
            lines.push("Голосовое сообщение");
            if (classification.durationSeconds !== null) {
              lines.push(`Длительность: ${Math.round(classification.durationSeconds)} с`);
            }
          } else if (classification.kind === "video") {
            lines.push("Видео");
          } else {
            lines.push("Файл");
            if (classification.fileName) lines.push(`Имя: ${untrusted(classification.fileName)}`);
            if (classification.mimeType) lines.push(`Тип: ${classification.mimeType}`);
          }
          if (attachment) {
            lines.push(`Размер: ${humanBytes(attachment.byteSize)}`);
            if (attachment.width !== null && attachment.height !== null) {
              lines.push(`Размеры: ${attachment.width}×${attachment.height}`);
            }
          }
          // §7 asks for the file identifier, and only in Developer Mode.
          if (input.user.developerMode) lines.push(`file_id: ${asCode(classification.fileId)}`);

          const token = await offer(
            input,
            kind,
            classification.kind === "document" && classification.fileName
              ? classification.fileName
              : `${classification.kind} ${input.message.id}`,
            classification.fileId,
          );
          await input.ctx.bot.sendText({
            chatId,
            text: clampMessage(lines.join("\n")),
            replyToMessageId: replyTo,
            keyboard: keyboard([
              button("SHA256", SHA, token),
              button("Сохранить", SAVE, token),
            ]),
          });
          return true;
        }

        case "location": {
          const content = `${classification.latitude},${classification.longitude}`;
          const token = await offer(input, "location", content);
          await input.ctx.bot.sendText({
            chatId,
            text: `Геопозиция ${classification.latitude.toFixed(5)}, ${classification.longitude.toFixed(5)}`,
            replyToMessageId: replyTo,
            keyboard: keyboard([
              button("Сохранить", SAVE, token),
              button("Напомнить", REMIND_FROM, token),
            ]),
          });
          return true;
        }

        case "command":
        case "empty":
          return false;
      }
    },
  };
}

export const INBOX_ACTIONS = { SAVE, PRETTY, SHA, STATUS, FORGET, PAGE, REMIND_FROM, WATCH_FROM };
export const START_SCREEN_ACTIONS = [PAGE, REMINDERS_LIST, WEBHOOKS_LIST, WATCH_LIST] as const;
