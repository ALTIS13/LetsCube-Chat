import { button, keyboard, type AppContext } from "#pf/app/context";
import type { CallbackContext, Feature } from "#pf/app/router";
import { clampMessage, untrusted } from "#pf/lib/render";
import type { ChatId, InlineButton, MessageId } from "#pf/transport/types";

/**
 * `/poll` and `/task` — the group's two useful things (§9, §10).
 *
 * The platform has no `sendPoll` and no checklist (gap **G-3**), and the brief
 * says so in advance: fall back to a message plus inline buttons. That is what
 * this is, and it is not a consolation prize — it is what a poll looks like
 * everywhere, with the counting done here instead of by the platform.
 *
 * **A poll and a checklist are the same object.** A checklist is a poll whose
 * options are things to do, whose «vote» means done, and which shows who ticked
 * each one. Splitting them would have duplicated the whole vote path to gain a
 * boolean.
 *
 * The tally is kept honest by two rules:
 *
 *   - a vote is `(poll, option, voter)` in Postgres, so the same person
 *     pressing twice changes nothing, and a redelivered callback cannot
 *     inflate a count;
 *   - the message is **edited**, never re-sent — a poll that posts a new copy
 *     on every vote is the version of this feature people mute.
 */

const VOTE = "poll.vote";
const CLOSE = "poll.close";

const MAX_OPTIONS = 8;
const MAX_OPTION_LENGTH = 64;

export type PollKind = "poll" | "task";

type PollRow = {
  id: string;
  owner_id: string;
  chat_id: string;
  message_id: string | null;
  kind: string;
  question: string;
  options: string[];
  multiple: boolean;
  closed: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Splits `/poll Обедаем? | Да | Нет` into a question and its options.
 *
 * The pipe rather than a newline, because a command's arguments arrive on one
 * line far more often than not — but newlines are accepted too, since somebody
 * who typed a list will expect it to work.
 */
export function parsePollArguments(args: string): {
  question: string;
  options: string[];
} | { error: string } {
  const parts = args
    .split(/[|\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const question = parts.shift();
  if (!question) return { error: "Нужен вопрос: /poll Обедаем? | Да | Нет" };
  if (parts.length < 2) return { error: "Нужно хотя бы два варианта, через |" };
  if (parts.length > MAX_OPTIONS) return { error: `Не больше ${MAX_OPTIONS} вариантов` };
  const tooLong = parts.find((option) => option.length > MAX_OPTION_LENGTH);
  if (tooLong) return { error: `Вариант длиннее ${MAX_OPTION_LENGTH} символов` };
  return { question, options: parts };
}

export function parseTaskArguments(args: string): { title: string; items: string[] } | { error: string } {
  const parts = args
    .split(/[|\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const title = parts.shift();
  if (!title) return { error: "Нужно название: /task Релиз | собрать | выкатить" };
  if (parts.length < 1) return { error: "Нужен хотя бы один пункт, через |" };
  if (parts.length > MAX_OPTIONS) return { error: `Не больше ${MAX_OPTIONS} пунктов` };
  return { title, items: parts };
}

async function loadPoll(ctx: AppContext, id: string): Promise<PollRow | null> {
  if (!UUID.test(id)) return null;
  const result = await ctx.db.query<PollRow>(
    `select id, owner_id, chat_id, message_id, kind, question, options, multiple, closed
     from pf_polls where id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

type Tally = Map<number, { count: number; names: string[] }>;

async function loadTally(ctx: AppContext, pollId: string): Promise<Tally> {
  const result = await ctx.db.query<{ option_index: number; display_name: string | null }>(
    `select option_index, display_name from pf_poll_votes where poll_id = $1 order by voted_at`,
    [pollId],
  );
  const tally: Tally = new Map();
  for (const row of result.rows) {
    const entry = tally.get(row.option_index) ?? { count: 0, names: [] };
    entry.count += 1;
    if (row.display_name && entry.names.length < 5) entry.names.push(row.display_name);
    tally.set(row.option_index, entry);
  }
  return tally;
}

/**
 * Russian plural agreement, which a bare `${n} голосов` gets wrong.
 *
 * «2 голосов» is the kind of mistake that makes a product read as translated.
 * The rule is on the last two digits: 11-14 take the many form whatever their
 * last digit says, and only then does the last digit decide.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** A proportional bar, in the one character width that survives every client. */
function bar(count: number, total: number, width = 10): string {
  if (total === 0) return "░".repeat(width);
  const filled = Math.round((count / total) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function renderPoll(poll: PollRow, tally: Tally): string {
  const total = [...tally.values()].reduce((sum, entry) => sum + entry.count, 0);
  const lines: string[] = [untrusted(poll.question), ""];

  poll.options.forEach((option, index) => {
    const entry = tally.get(index) ?? { count: 0, names: [] };
    if (poll.kind === "task") {
      const mark = entry.count > 0 ? "✅" : "☐";
      const who = entry.names.length > 0 ? ` — ${untrusted(entry.names.join(", "))}` : "";
      lines.push(`${mark} ${untrusted(option)}${who}`);
    } else {
      lines.push(`${untrusted(option)}`);
      lines.push(`   ${bar(entry.count, total)} ${entry.count}`);
    }
  });

  if (poll.kind === "poll") {
    lines.push("", `${total} ${plural(total, "голос", "голоса", "голосов")}`);
  }
  if (poll.closed) lines.push(poll.kind === "task" ? "Список закрыт" : "Опрос закрыт");
  return clampMessage(lines.join("\n"));
}

function pollKeyboard(poll: PollRow) {
  if (poll.closed) return keyboard();
  const rows: InlineButton[][] = [];
  poll.options.forEach((option, index) => {
    const label = option.length > 28 ? `${option.slice(0, 28)}…` : option;
    rows.push([button(poll.kind === "task" ? `☐ ${label}` : label, VOTE, poll.id, String(index))]);
  });
  rows.push([button(poll.kind === "task" ? "Закрыть список" : "Завершить опрос", CLOSE, poll.id)]);
  return keyboard(...rows);
}

async function publish(
  ctx: AppContext,
  poll: PollRow,
  chatId: string,
  replyTo: string | null,
): Promise<void> {
  const tally = await loadTally(ctx, poll.id);
  const sent = await ctx.bot.sendText({
    chatId: chatId as ChatId,
    text: renderPoll(poll, tally),
    ...(replyTo ? { replyToMessageId: replyTo as MessageId } : {}),
    keyboard: pollKeyboard(poll),
  });
  await ctx.db.query(`update pf_polls set message_id = $2 where id = $1`, [poll.id, sent.id]);
}

async function refresh(ctx: AppContext, poll: PollRow): Promise<void> {
  if (!poll.message_id) return;
  const tally = await loadTally(ctx, poll.id);
  await ctx.bot.editText({
    chatId: poll.chat_id as ChatId,
    messageId: poll.message_id as MessageId,
    text: renderPoll(poll, tally),
    keyboard: pollKeyboard(poll),
  });
}

async function create(
  ctx: AppContext,
  input: {
    ownerId: string;
    chatId: string;
    kind: PollKind;
    question: string;
    options: string[];
    multiple: boolean;
  },
): Promise<PollRow> {
  const result = await ctx.db.query<PollRow>(
    `insert into pf_polls (owner_id, chat_id, kind, question, options, multiple)
     values ($1, $2, $3, $4, $5::jsonb, $6)
     returning id, owner_id, chat_id, message_id, kind, question, options, multiple, closed`,
    [
      input.ownerId,
      input.chatId,
      input.kind,
      input.question,
      JSON.stringify(input.options),
      input.multiple,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("poll was not created");
  return row;
}

export function createGroupFeature(): Feature {
  return {
    name: "group",
    commandList: [
      { command: "poll", description: "Опрос: /poll Вопрос | Да | Нет" },
      { command: "task", description: "Список дел: /task Релиз | собрать | выкатить" },
    ],

    commands: {
      async poll(input) {
        const parsed = parsePollArguments(input.args);
        if ("error" in parsed) {
          await input.ctx.bot.sendText({
            chatId: input.message.chat.id,
            text: parsed.error,
            replyToMessageId: input.message.id,
          });
          return;
        }
        const poll = await create(input.ctx, {
          ownerId: input.user.userId,
          chatId: input.message.chat.id,
          kind: "poll",
          question: parsed.question,
          options: parsed.options,
          multiple: false,
        });
        await publish(input.ctx, poll, input.message.chat.id, null);
      },

      async task(input) {
        const parsed = parseTaskArguments(input.args);
        if ("error" in parsed) {
          await input.ctx.bot.sendText({
            chatId: input.message.chat.id,
            text: parsed.error,
            replyToMessageId: input.message.id,
          });
          return;
        }
        const poll = await create(input.ctx, {
          ownerId: input.user.userId,
          chatId: input.message.chat.id,
          kind: "task",
          question: parsed.title,
          options: parsed.items,
          multiple: true,
        });
        await publish(input.ctx, poll, input.message.chat.id, null);
      },
    },

    callbacks: {
      async [VOTE](input: CallbackContext) {
        const poll = await loadPoll(input.ctx, input.args[0] ?? "");
        const index = Number(input.args[1] ?? "-1");
        if (!poll || !Number.isInteger(index) || index < 0 || index >= poll.options.length) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, {
            text: "Этого опроса больше нет",
          });
          return;
        }
        if (poll.closed) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, { text: "Уже завершён" });
          return;
        }
        // The poll is public inside its chat, so anybody who can see it may
        // vote — that is the feature, not a hole. What is checked is that the
        // press names a real option of a real poll, which is what the guards
        // above do; the callback data is a lookup, never a permission (§19).
        await input.ctx.db.transaction(async (tx) => {
          const existing = await tx.query(
            `select 1 from pf_poll_votes
             where poll_id = $1 and option_index = $2 and user_id = $3`,
            [poll.id, index, input.user.userId],
          );
          if ((existing.rowCount ?? 0) > 0) {
            // Pressing the same option again takes the vote back. Telegram's
            // «retract vote», and the only way a checklist item can be
            // un-ticked.
            await tx.query(
              `delete from pf_poll_votes
               where poll_id = $1 and option_index = $2 and user_id = $3`,
              [poll.id, index, input.user.userId],
            );
            return;
          }
          if (!poll.multiple) {
            await tx.query(`delete from pf_poll_votes where poll_id = $1 and user_id = $2`, [
              poll.id,
              input.user.userId,
            ]);
          }
          await tx.query(
            `insert into pf_poll_votes (poll_id, option_index, user_id, display_name)
             values ($1, $2, $3, $4)
             on conflict do nothing`,
            [poll.id, index, input.user.userId, input.user.displayName],
          );
        });
        await input.ctx.bot.answerCallbackQuery(input.query.id);
        await refresh(input.ctx, poll);
      },

      async [CLOSE](input: CallbackContext) {
        const poll = await loadPoll(input.ctx, input.args[0] ?? "");
        if (!poll) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, {
            text: "Этого опроса больше нет",
          });
          return;
        }
        // Closing **is** an owner action, unlike voting, and the owner is read
        // from the row rather than from the press.
        if (poll.owner_id !== input.user.userId) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, {
            text: "Завершить может только тот, кто создал",
          });
          return;
        }
        await input.ctx.db.query(`update pf_polls set closed = true where id = $1`, [poll.id]);
        await input.ctx.bot.answerCallbackQuery(input.query.id, { text: "Завершено" });
        await refresh(input.ctx, { ...poll, closed: true });
      },
    },
  };
}
