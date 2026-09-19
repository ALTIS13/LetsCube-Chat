import { randomUUID } from "node:crypto";

import { button, keyboard, type AppContext } from "#pf/app/context";
import type { CallbackContext, CommandContext, Feature, MessageContext } from "#pf/app/router";
import type { Classification } from "#pf/lib/classify";
import { clampMessage, untrusted } from "#pf/lib/render";
import {
  describeWhenFailure,
  formatWhen,
  parseWhen,
  type WhenFailure,
} from "#pf/lib/whenParser";
import type { SchedulerJob } from "#pf/scheduler/index";
import { readCandidate } from "#pf/store/candidates";
import {
  abandonReminder,
  cancelReminder,
  claimDue,
  clearPendingPrompt,
  completeReminder,
  createReminder,
  listPending,
  markFired,
  PROMPT_TTL_MINUTES,
  prunePendingPrompts,
  readPendingPrompt,
  readReminder,
  releaseClaim,
  setPendingPrompt,
  snoozeReminder,
  type Reminder,
} from "#pf/store/reminders";
import {
  TransportError,
  type CallbackQueryId,
  type ChatId,
  type MessageId,
} from "#pf/transport/types";

/**
 * Reminders (§4): the command, the buttons, and the firing.
 *
 * **callback_data is a lookup, never a permission.** Every handler below
 * re-reads its subject from the database through a function that takes the
 * presser's id, so a forged `rem.done:<somebody-else's-uuid>` reads nothing and
 * changes nothing. That is checked by a test that forges exactly that. The
 * second gate is in the SQL — every mutation carries `owner_id = $2` — and the
 * two are independent on purpose: this file could be rewritten badly and the
 * store would still refuse.
 *
 * **Firing edits in place.** §2 asks for `editMessageText` rather than a new
 * message, and «Выполнено» and «+10 минут» both rewrite the message the button
 * is on. Read off the platform's own SQL rather than assumed: `editMessageText`
 * assigns `bot_reply_markup = v_reply_markup`, and `v_reply_markup` is null
 * when `reply_markup` is absent from the payload — so an edit with no keyboard
 * removes the buttons, which is what makes a completed reminder stop offering
 * to be completed.
 *
 * **Delivery is at-least-once, and that is a choice.** The reminder is sent
 * first and marked `fired` after, so a crash between the two re-sends it on the
 * next tick. The other order loses it silently. For a reminder, a duplicate is
 * an annoyance and a loss is the whole failure, so the duplicate wins.
 */

const DONE = "rem.done";
const SNOOZE = "rem.snooze";
const CANCEL = "rem.cancel";
const LIST = "rem.list";
const QUICK = "rem.quick";
const PICK_DATE = "rem.date";

/** Offered by the inbox beside anything worth being reminded about. */
const REMIND_FROM = "remind.from";

export const REMINDER_ACTIONS = { DONE, SNOOZE, CANCEL, LIST, QUICK, PICK_DATE, REMIND_FROM };

/** Waiting for «пришлите дату». */
const PROMPT_KIND = "reminder_date";
/** Waiting for one of the quick buttons to be pressed. */
const DRAFT_KIND = "reminder_when";

const LIST_LIMIT = 20;
const LIST_CANCEL_BUTTONS = 5;

/** How often the loop looks for work. Half a minute is under any human's notice. */
export const REMINDER_TICK_MS = 30_000;
/** Taken per tick. Bounded so one backlog cannot hold the loop for minutes. */
export const REMINDER_BATCH = 50;

type DraftContext = {
  /** Distinguishes this draft from the keyboard of a draft already replaced. */
  nonce: string;
  body?: string;
  candidateId?: string;
};

type QuickOption = {
  key: string;
  label: string;
  /** Either a fixed delay, or an expression run through the very same parser. */
  minutes?: number;
  expression?: string;
};

/**
 * The quick choices, and why two of them are strings.
 *
 * «Сегодня вечером» and «Завтра» are resolved by `parseWhen` on the same
 * expression a person could have typed, rather than by a second piece of date
 * arithmetic here. If the two disagreed, the button and the command would mean
 * different times and only one of them would have a test.
 */
const QUICK_OPTIONS: readonly QuickOption[] = [
  { key: "10m", label: "10 минут", minutes: 10 },
  { key: "1h", label: "1 час", minutes: 60 },
  { key: "eve", label: "Сегодня вечером", expression: "сегодня вечером" },
  { key: "tom", label: "Завтра", expression: "завтра" },
];

const SNOOZE_OPTIONS: readonly { label: string; minutes: number }[] = [
  { label: "+10 минут", minutes: 10 },
  { label: "+1 час", minutes: 60 },
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function firedText(reminder: Reminder): string {
  return clampMessage(`⏰ ${untrusted(reminder.body)}`);
}

function firedKeyboard(reminderId: string) {
  return keyboard([
    button("Выполнено", DONE, reminderId),
    ...SNOOZE_OPTIONS.map((option) => button(option.label, SNOOZE, reminderId, String(option.minutes))),
  ]);
}

function quickKeyboard(nonce: string) {
  return keyboard(
    QUICK_OPTIONS.slice(0, 2).map((option) => button(option.label, QUICK, option.key, nonce)),
    QUICK_OPTIONS.slice(2).map((option) => button(option.label, QUICK, option.key, nonce)),
    [button("Указать дату", PICK_DATE, nonce)],
  );
}

function listView(
  reminders: readonly Reminder[],
  now: Date,
  timeZone: string,
): { text: string; markup: ReturnType<typeof keyboard> } {
  if (reminders.length === 0) {
    return {
      text: "Пока нет напоминаний.\n\nНапример: /remind 20м Проверить сервер",
      markup: keyboard(),
    };
  }
  const lines = reminders.map(
    (reminder, index) =>
      `${index + 1}. ${formatWhen(reminder.dueAt, now, timeZone)} — ${untrusted(reminder.body)}`,
  );
  return {
    text: clampMessage(`Напоминания (${reminders.length})\n\n${lines.join("\n")}`),
    // Five, not twenty: a keyboard is capped at eight rows of eight, and a wall
    // of ✕ stops being a list anybody can read long before it stops fitting.
    markup: keyboard(
      reminders
        .slice(0, LIST_CANCEL_BUTTONS)
        .map((reminder, index) => button(`✕ ${index + 1}`, CANCEL, reminder.id)),
    ),
  };
}

async function renderList(
  ctx: AppContext,
  ownerId: string,
  timeZone: string,
): Promise<{ text: string; markup: ReturnType<typeof keyboard> }> {
  const reminders = await listPending(ctx.db, ownerId, LIST_LIMIT);
  return listView(reminders, ctx.now(), timeZone);
}

// ---------------------------------------------------------------------------
// Parsing a button's time with the parser the command uses
// ---------------------------------------------------------------------------

/**
 * The instant an expression names, with no body attached.
 *
 * `parseWhen` refuses a time with nothing to be reminded about, which is right
 * for a typed command and wrong for a button — the body is already known. The
 * refusal carries the instant it had computed, so «missing_body» is this
 * function's success case. Reusing the parser this way is the point: the button
 * cannot drift from the words it is labelled with.
 */
function instantOf(expression: string, now: Date, timeZone: string): Date | WhenFailure {
  const parsed = parseWhen(expression, now, timeZone);
  if (parsed.ok) return parsed.at;
  if (parsed.code === "missing_body") return parsed.at;
  return parsed;
}

// ---------------------------------------------------------------------------
// The draft flow
// ---------------------------------------------------------------------------

async function openDraft(
  ctx: AppContext,
  input: { chatId: string; userId: string; context: Omit<DraftContext, "nonce"> },
): Promise<string> {
  const nonce = randomUUID().slice(0, 8);
  await setPendingPrompt(ctx.db, {
    chatId: input.chatId,
    userId: input.userId,
    kind: DRAFT_KIND,
    context: { ...input.context, nonce },
    expiresAt: new Date(ctx.now().getTime() + PROMPT_TTL_MINUTES * 60_000),
  });
  return nonce;
}

/**
 * The body a draft refers to, re-authorized at the moment of the press.
 *
 * A draft built from an inbox candidate keeps the candidate's id rather than
 * its text, so the owner check runs again now — minutes after the offer was
 * made — instead of trusting a copy taken then.
 */
async function draftBody(
  ctx: AppContext,
  ownerId: string,
  context: DraftContext,
): Promise<string | null> {
  if (typeof context.body === "string" && context.body.trim().length > 0) {
    return context.body;
  }
  if (typeof context.candidateId === "string") {
    const candidate = await readCandidate(ctx.db, ownerId, context.candidateId);
    return candidate ? candidate.content : null;
  }
  return null;
}

async function readDraft(
  ctx: AppContext,
  chatId: string,
  userId: string,
  kind: string,
  nonce: string | null,
): Promise<DraftContext | null> {
  const prompt = await readPendingPrompt<DraftContext>(ctx.db, chatId, userId, ctx.now());
  if (!prompt || prompt.kind !== kind) return null;
  if (nonce !== null && prompt.context.nonce !== nonce) return null;
  return prompt.context;
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

async function confirm(
  ctx: AppContext,
  chatId: string,
  reminder: Reminder,
  timeZone: string,
  replyTo?: MessageId,
): Promise<void> {
  await ctx.bot.sendText({
    chatId: chatId as ChatId,
    text: clampMessage(
      `Напомню ${formatWhen(reminder.dueAt, ctx.now(), timeZone)} — ${untrusted(reminder.body)}`,
    ),
    ...(replyTo ? { replyToMessageId: replyTo } : {}),
    keyboard: keyboard([button("Отменить", CANCEL, reminder.id)]),
  });
}

async function create(
  ctx: AppContext,
  input: { ownerId: string; chatId: string; body: string; dueAt: Date },
): Promise<Reminder> {
  const reminder = await createReminder(ctx.db, input);
  // The body is never logged: it is somebody's private text, and §20 is
  // explicit about it. The id and the due time are enough to follow a defect.
  ctx.log.info("reminder.created", {
    reminder_id: reminder.id,
    owner_id: input.ownerId,
    due_at: reminder.dueAt.toISOString(),
  });
  return reminder;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export type DeliveryOutcome = { claimed: number; fired: number; released: number; abandoned: number };

/**
 * Sends everything that is due, once.
 *
 * The claim is taken in one statement before anything is sent, so a second
 * process ticking at the same moment finds nothing to do. `markFired` is
 * conditional on the same token, so a claim that expired mid-send cannot be
 * completed by the process that has lost it.
 */
export async function deliverDue(
  ctx: AppContext,
  options?: { limit?: number; claimTtlMs?: number; signal?: AbortSignal },
): Promise<DeliveryOutcome> {
  const claimToken = randomUUID();
  const outcome: DeliveryOutcome = { claimed: 0, fired: 0, released: 0, abandoned: 0 };
  const due = await claimDue(ctx.db, {
    now: ctx.now(),
    claimToken,
    limit: options?.limit ?? REMINDER_BATCH,
    ...(options?.claimTtlMs === undefined ? {} : { claimTtlMs: options.claimTtlMs }),
  });
  outcome.claimed = due.length;

  for (const reminder of due) {
    if (options?.signal?.aborted) {
      // Shutting down. Handing the claim back now means the next process picks
      // these up immediately instead of waiting out the claim's TTL.
      await releaseClaim(ctx.db, reminder.id, claimToken);
      outcome.released += 1;
      continue;
    }
    try {
      const sent = await ctx.bot.sendText({
        chatId: reminder.chatId as ChatId,
        text: firedText(reminder),
        keyboard: firedKeyboard(reminder.id),
      });
      const recorded = await markFired(ctx.db, {
        id: reminder.id,
        claimToken,
        firedMessageId: sent.id,
        firedAt: ctx.now(),
      });
      if (recorded) {
        outcome.fired += 1;
      } else {
        // Sent, but the row moved on: the claim expired mid-send, or the person
        // cancelled it in the same second. Worth a line, because a run of these
        // means the claim TTL is shorter than the platform's latency.
        ctx.log.warn("reminder.fired_unrecorded", { reminder_id: reminder.id });
      }
    } catch (error) {
      const permanent = error instanceof TransportError && !error.retryable;
      if (permanent) {
        await abandonReminder(ctx.db, { id: reminder.id, claimToken, now: ctx.now() });
        outcome.abandoned += 1;
        ctx.log.error("reminder.abandoned", {
          reminder_id: reminder.id,
          code: error instanceof TransportError ? error.code : "unknown",
        });
      } else {
        await releaseClaim(ctx.db, reminder.id, claimToken);
        outcome.released += 1;
        ctx.log.warn("reminder.delivery_retry", {
          reminder_id: reminder.id,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  }
  return outcome;
}

/**
 * The reminders half of the background loop.
 *
 * Nothing about the schedule is held here or in the scheduler: what is due
 * lives in `pf_reminders.due_at`, so a restart mid-interval loses nothing and a
 * second process running the same job fires nothing twice.
 */
export function createRemindersJob(ctx: AppContext, options?: { intervalMs?: number }): SchedulerJob {
  return {
    name: "reminders",
    intervalMs: options?.intervalMs ?? REMINDER_TICK_MS,
    async run({ signal }) {
      await deliverDue(ctx, { signal });
      // One indexed delete over a table with a row per open conversation. Kept
      // here rather than in a job of its own because a second job that exists
      // only to run a five-millisecond statement is a second thing to monitor.
      await prunePendingPrompts(ctx.db, ctx.now());
    },
  };
}

// ---------------------------------------------------------------------------
// The feature
// ---------------------------------------------------------------------------

async function refuse(ctx: AppContext, queryId: CallbackQueryId, text: string): Promise<void> {
  await ctx.bot.answerCallbackQuery(queryId, { text });
}

/**
 * The reminder this press refers to, if it is the presser's.
 *
 * The single choke point through which every callback handler reads. `readReminder`
 * takes the owner, so there is no version of this that forgets the check.
 */
async function ownedReminder(input: CallbackContext): Promise<Reminder | null> {
  const id = input.args[0] ?? "";
  const reminder = await readReminder(input.ctx.db, input.user.userId, id);
  if (!reminder) {
    input.ctx.log.warn("reminder.callback_refused", {
      actor_id: input.user.userId,
      reminder_id: id.slice(0, 36),
    });
  }
  return reminder;
}

export function createRemindersFeature(): Feature {
  return {
    name: "reminders",

    commandList: [
      { command: "remind", description: "Напомнить" },
      { command: "reminders", description: "Мои напоминания" },
    ],

    commands: {
      async remind(input: CommandContext) {
        const ctx = input.ctx;
        const chatId = input.message.chat.id;
        const args = input.args.trim();

        if (args.length === 0) {
          await ctx.bot.sendText({
            chatId,
            text: [
              "Что напомнить? Например:",
              "/remind 20м Проверить сервер",
              "/remind завтра 18:00 Позвонить",
              "/remind 05.10 18:00 Забрать посылку",
            ].join("\n"),
          });
          return;
        }

        const parsed = parseWhen(args, ctx.now(), input.user.timeZone);
        if (parsed.ok) {
          const reminder = await create(ctx, {
            ownerId: input.user.userId,
            chatId,
            body: parsed.body,
            dueAt: parsed.at,
          });
          await confirm(ctx, chatId, reminder, input.user.timeZone, input.message.id);
          return;
        }

        // A time that was written and misread is a different situation from no
        // time at all. Only the second one becomes a draft: offering buttons
        // after «завтра 25:70» would bury the fact that the input was wrong.
        if (parsed.code !== "unrecognized") {
          await ctx.bot.sendText({
            chatId,
            text: describeWhenFailure(parsed, input.user.timeZone),
            replyToMessageId: input.message.id,
          });
          return;
        }

        const nonce = await openDraft(ctx, {
          chatId,
          userId: input.user.userId,
          context: { body: args },
        });
        await ctx.bot.sendText({
          chatId,
          text: clampMessage(`Когда напомнить?\n${untrusted(args)}`),
          replyToMessageId: input.message.id,
          keyboard: quickKeyboard(nonce),
        });
      },

      async reminders(input: CommandContext) {
        const view = await renderList(input.ctx, input.user.userId, input.user.timeZone);
        await input.ctx.bot.sendText({
          chatId: input.message.chat.id,
          text: view.text,
          ...(view.markup.rows.length > 0 ? { keyboard: view.markup } : {}),
        });
      },
    },

    callbacks: {
      /** `/start` draws this. The same list, replacing the message it is on. */
      async [LIST](input: CallbackContext) {
        const view = await renderList(input.ctx, input.user.userId, input.user.timeZone);
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId,
          messageId: input.query.message.id,
          text: view.text,
          ...(view.markup.rows.length > 0 ? { keyboard: view.markup } : {}),
        });
        await input.ctx.bot.answerCallbackQuery(input.query.id);
      },

      async [DONE](input: CallbackContext) {
        const reminder = await ownedReminder(input);
        if (!reminder) {
          await refuse(input.ctx, input.query.id, "Это напоминание больше не действует");
          return;
        }
        const done = await completeReminder(
          input.ctx.db,
          input.user.userId,
          reminder.id,
          input.ctx.now(),
        );
        await input.ctx.bot.answerCallbackQuery(input.query.id, {
          text: done ? "Выполнено" : "Уже закрыто",
        });
        // In place, and without the keyboard: an edit that carries no
        // `reply_markup` clears the platform's stored markup, so a completed
        // reminder stops offering to be completed again.
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId,
          messageId: input.query.message.id,
          text: clampMessage(`✅ ${untrusted(reminder.body)}`),
        });
      },

      async [SNOOZE](input: CallbackContext) {
        const reminder = await ownedReminder(input);
        if (!reminder) {
          await refuse(input.ctx, input.query.id, "Это напоминание больше не действует");
          return;
        }
        const requested = Number(input.args[1] ?? "");
        const allowed = SNOOZE_OPTIONS.some((option) => option.minutes === requested);
        if (!allowed) {
          // The minutes come from the same untrusted string the id does. An
          // arbitrary number here would let a crafted press park a reminder a
          // century away, which is not a security hole but is not this bot's
          // behaviour either.
          await refuse(input.ctx, input.query.id, "Так отложить нельзя");
          return;
        }
        const dueAt = new Date(input.ctx.now().getTime() + requested * 60_000);
        const moved = await snoozeReminder(
          input.ctx.db,
          input.user.userId,
          reminder.id,
          dueAt,
        );
        if (!moved) {
          await refuse(input.ctx, input.query.id, "Уже закрыто");
          return;
        }
        await input.ctx.bot.answerCallbackQuery(input.query.id, { text: "Отложено" });
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId,
          messageId: input.query.message.id,
          text: clampMessage(
            `⏰ ${untrusted(moved.body)}\nОтложено до ${formatWhen(moved.dueAt, input.ctx.now(), input.user.timeZone)}`,
          ),
        });
      },

      async [CANCEL](input: CallbackContext) {
        const reminder = await ownedReminder(input);
        if (!reminder) {
          await refuse(input.ctx, input.query.id, "Это напоминание больше не действует");
          return;
        }
        const cancelled = await cancelReminder(
          input.ctx.db,
          input.user.userId,
          reminder.id,
          input.ctx.now(),
        );
        await input.ctx.bot.answerCallbackQuery(input.query.id, {
          text: cancelled ? "Отменено" : "Уже закрыто",
        });
        const view = await renderList(input.ctx, input.user.userId, input.user.timeZone);
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId,
          messageId: input.query.message.id,
          text: view.text,
          ...(view.markup.rows.length > 0 ? { keyboard: view.markup } : {}),
        });
      },

      /** The inbox's «Напомнить», beside a text or a location it was sent. */
      async [REMIND_FROM](input: CallbackContext) {
        const candidateId = input.args[0] ?? "";
        const candidate = await readCandidate(input.ctx.db, input.user.userId, candidateId);
        if (!candidate) {
          await refuse(input.ctx, input.query.id, "Это предложение больше не действует");
          return;
        }
        const nonce = await openDraft(input.ctx, {
          chatId: input.query.message.chatId,
          userId: input.user.userId,
          context: { candidateId: candidate.id },
        });
        await input.ctx.bot.answerCallbackQuery(input.query.id);
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId,
          messageId: input.query.message.id,
          text: clampMessage(`Когда напомнить?\n${untrusted(candidate.content)}`),
          keyboard: quickKeyboard(nonce),
        });
      },

      async [QUICK](input: CallbackContext) {
        const option = QUICK_OPTIONS.find((candidate) => candidate.key === input.args[0]);
        if (!option) {
          await refuse(input.ctx, input.query.id, "Эта кнопка больше не действует");
          return;
        }
        const draft = await readDraft(
          input.ctx,
          input.query.message.chatId,
          input.user.userId,
          DRAFT_KIND,
          input.args[1] ?? null,
        );
        if (!draft) {
          await refuse(input.ctx, input.query.id, "Это предложение больше не действует");
          return;
        }
        const body = await draftBody(input.ctx, input.user.userId, draft);
        if (body === null) {
          await refuse(input.ctx, input.query.id, "Это предложение больше не действует");
          return;
        }

        const now = input.ctx.now();
        const at =
          option.minutes !== undefined
            ? new Date(now.getTime() + option.minutes * 60_000)
            : instantOf(option.expression ?? "", now, input.user.timeZone);
        if (!(at instanceof Date)) {
          // «Сегодня вечером» pressed at half past eleven. Said plainly rather
          // than silently rolled to tomorrow.
          await refuse(input.ctx, input.query.id, describeWhenFailure(at, input.user.timeZone));
          return;
        }

        await clearPendingPrompt(input.ctx.db, input.query.message.chatId, input.user.userId);
        const reminder = await create(input.ctx, {
          ownerId: input.user.userId,
          chatId: input.query.message.chatId,
          body,
          dueAt: at,
        });
        await input.ctx.bot.answerCallbackQuery(input.query.id, { text: "Готово" });
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId,
          messageId: input.query.message.id,
          text: clampMessage(
            `Напомню ${formatWhen(reminder.dueAt, now, input.user.timeZone)} — ${untrusted(body)}`,
          ),
          keyboard: keyboard([button("Отменить", CANCEL, reminder.id)]),
        });
      },

      async [PICK_DATE](input: CallbackContext) {
        const draft = await readDraft(
          input.ctx,
          input.query.message.chatId,
          input.user.userId,
          DRAFT_KIND,
          input.args[0] ?? null,
        );
        if (!draft) {
          await refuse(input.ctx, input.query.id, "Это предложение больше не действует");
          return;
        }
        await setPendingPrompt(input.ctx.db, {
          chatId: input.query.message.chatId,
          userId: input.user.userId,
          kind: PROMPT_KIND,
          context: draft,
          expiresAt: new Date(input.ctx.now().getTime() + PROMPT_TTL_MINUTES * 60_000),
        });
        await input.ctx.bot.answerCallbackQuery(input.query.id);
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId,
          messageId: input.query.message.id,
          text: [
            "Пришлите дату и время следующим сообщением.",
            "Например: «05.10 18:00», «завтра 09:30», «через 3 дня».",
            `Если передумаете — просто не отвечайте, я забуду через ${PROMPT_TTL_MINUTES} минут.`,
          ].join("\n"),
        });
      },
    },

    /**
     * The answer to «пришлите дату».
     *
     * Returns true only when this chat and this person really were asked for a
     * date, so an ordinary message goes on to the inbox untouched. For that to
     * work the reminders feature must be registered **before** the inbox in the
     * router's feature list — the first `true` wins, and the inbox claims
     * everything.
     */
    async onMessage(input: MessageContext, classification: Classification): Promise<boolean> {
      if (classification.kind === "command" || classification.kind === "empty") return false;
      const text = input.message.text;
      if (!text) return false;

      const draft = await readDraft(
        input.ctx,
        input.message.chat.id,
        input.user.userId,
        PROMPT_KIND,
        null,
      );
      if (!draft) return false;

      const body = await draftBody(input.ctx, input.user.userId, draft);
      if (body === null) {
        await clearPendingPrompt(input.ctx.db, input.message.chat.id, input.user.userId);
        await input.ctx.bot.sendText({
          chatId: input.message.chat.id,
          text: "Это предложение больше не действует.",
        });
        return true;
      }

      const parsed = parseWhen(text.trim(), input.ctx.now(), input.user.timeZone);
      const when = parsed.ok ? parsed.at : parsed.code === "missing_body" ? parsed.at : null;
      if (when === null) {
        // The prompt is deliberately left in place: a person who mistyped a
        // date is answering the same question, and clearing it would make the
        // next attempt land in the inbox as a note.
        await input.ctx.bot.sendText({
          chatId: input.message.chat.id,
          text: describeWhenFailure(parsed as WhenFailure, input.user.timeZone),
          replyToMessageId: input.message.id,
        });
        return true;
      }

      await clearPendingPrompt(input.ctx.db, input.message.chat.id, input.user.userId);
      const reminder = await create(input.ctx, {
        ownerId: input.user.userId,
        chatId: input.message.chat.id,
        // «05.10 18:00 Купить хлеб» in answer to «пришлите дату» is somebody
        // rewriting the text as well as the time. Dropping the words they just
        // typed in favour of the stored draft would be the quiet kind of wrong.
        body: parsed.ok ? parsed.body : body,
        dueAt: when,
      });
      await confirm(input.ctx, input.message.chat.id, reminder, input.user.timeZone, input.message.id);
      return true;
    },
  };
}
