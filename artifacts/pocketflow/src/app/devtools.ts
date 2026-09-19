import { button, keyboard, type AppContext } from "#pf/app/context";
import type { CallbackContext, Feature } from "#pf/app/router";
import { asCode, clampMessage } from "#pf/lib/render";
import { runSelftest, type CheckStatus } from "#pf/app/selftest";
import { LETSCUBE_GAPS } from "#pf/transport/letscube";
import type { ChatId, MessageId, TransportCapability } from "#pf/transport/types";

/**
 * `/streamdemo` and the `/test_*` family (§12, §14).
 *
 * Two different things share this file because they answer the same question
 * from opposite ends: what does this platform actually do when you use it.
 *
 * **`/streamdemo` is for everybody, not for developers.** §12 asks for a small
 * progressive report and notes it needs no AI. This platform has no streaming
 * API (gap G-6), so the honest version is a single message edited in place as
 * the work proceeds, then one persistent message at the end — which is exactly
 * what a streaming reply looks like to a reader, and is what a bot on any
 * platform without a draft API would do.
 *
 * **The `/test_*` family does not re-implement `/selftest`.** Each command runs
 * the same checks and reports the same statuses, filtered to one area. A second
 * set of probes beside the first would be two lists that drift, and the whole
 * value of the report is that it is the one place the bot says what works.
 */

const STREAM_AGAIN = "dev.stream";

const STEPS = [
  "Анализирую…",
  "Проверяю данные…",
  "Собираю результат…",
];

/** Long enough to read, short enough not to look stuck. */
const STEP_DELAY_MS = 900;

export type StreamOptions = {
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Runs the demonstration into one message.
 *
 * Returned rather than sent from inside, so a test can assert the sequence of
 * edits without a clock: pass `sleep` and it never waits.
 */
export async function runStreamDemo(
  ctx: AppContext,
  chatId: string,
  options?: StreamOptions,
): Promise<{ draftMessageId: string; finalMessageId: string }> {
  const sleep =
    options?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const delay = options?.delayMs ?? STEP_DELAY_MS;

  // `typing` first, because the first step has to be written and sent before
  // anything appears, and a second of nothing is what makes a bot feel dead.
  await ctx.bot.sendChatAction(chatId as ChatId, "typing");
  const draft = await ctx.bot.sendText({ chatId: chatId as ChatId, text: STEPS[0] ?? "…" });

  for (const step of STEPS.slice(1)) {
    await sleep(delay);
    await ctx.bot.editText({
      chatId: chatId as ChatId,
      messageId: draft.id,
      text: step,
    });
  }

  await sleep(delay);
  // The draft becomes the record of what happened, and the result arrives as
  // its own message — §12 asks for a «normal persistent final message», and a
  // result that only ever existed as an edit is one a reader scrolls past.
  await ctx.bot.editText({
    chatId: chatId as ChatId,
    messageId: draft.id,
    text: "Готово.",
  });

  const final = await ctx.bot.sendText({
    chatId: chatId as ChatId,
    text: clampMessage(
      [
        "Отчёт",
        "",
        asCode(
          [
            "шагов        3",
            "потоковый API нет (G-6)",
            "как сделано  правка одного сообщения",
          ].join("\n"),
        ),
      ].join("\n"),
    ),
    keyboard: keyboard([button("Ещё раз", STREAM_AGAIN)]),
  });

  return { draftMessageId: draft.id, finalMessageId: final.id };
}

/**
 * The areas `/test_*` can ask about, and the selftest sections they read.
 *
 * A capability listed in `requires` is reported straight from the transport's
 * gap map without running anything — the same rule `/selftest` follows, and
 * the reason UNSUPPORTED can never be mistaken for FAIL.
 */
const AREAS: Record<
  string,
  { title: string; sections?: string[]; requires?: TransportCapability }
> = {
  test_message: { title: "Сообщения", sections: ["Messages"] },
  test_buttons: { title: "Кнопки", sections: ["Buttons"] },
  test_file: { title: "Файлы", sections: ["Media"] },
  test_media: { title: "Медиа", sections: ["Media"] },
  test_inline: { title: "Inline-режим", requires: "inlineMode" },
  test_poll: { title: "Опросы", requires: "poll" },
  test_rich: { title: "Rich Messages", requires: "richMessages" },
  test_stream: { title: "Streaming", requires: "streaming" },
  test_ephemeral: { title: "Ephemeral", requires: "ephemeral" },
  test_topics: { title: "Темы", requires: "topics" },
};

const ICON: Record<CheckStatus, string> = {
  PASS: "✅",
  FAIL: "❌",
  UNSUPPORTED: "⛔",
  USER_ACTION_REQUIRED: "⏳",
  SKIPPED: "◻️",
};

function developerAllowed(ctx: AppContext, userId: string, developerMode: boolean): boolean {
  return ctx.config.developerIds.has(userId) && developerMode;
}

export function createDevToolsFeature(): Feature {
  const commands: NonNullable<Feature["commands"]> = {
    async streamdemo(input) {
      await runStreamDemo(input.ctx, input.message.chat.id);
    },
  };

  for (const [name, area] of Object.entries(AREAS)) {
    commands[name] = async (input) => {
      if (!developerAllowed(input.ctx, input.user.userId, input.user.developerMode)) {
        await input.ctx.bot.sendText({
          chatId: input.message.chat.id,
          text: "Не знаю такой команды. /help покажет, что я умею.",
        });
        return;
      }

      if (area.requires) {
        const supported = input.ctx.bot.supports(area.requires);
        await input.ctx.bot.sendText({
          chatId: input.message.chat.id,
          text: supported
            ? `${ICON.SKIPPED} ${area.title} — поддерживается; проверяется в /selftest`
            : `${ICON.UNSUPPORTED} ${area.title} — UNSUPPORTED\n${LETSCUBE_GAPS.get(area.requires) ?? "не реализовано платформой"}`,
        });
        return;
      }

      const { report } = await runSelftest(input.ctx, {
        requestedBy: input.user.userId,
        chatId: input.message.chat.id,
      });
      const checks = report.checks.filter((check) =>
        (area.sections ?? []).includes(check.section),
      );
      const lines = [`${area.title}`, ""];
      for (const check of checks) {
        lines.push(`${ICON[check.status]} ${check.title} — ${check.status}`);
        if (check.detail) lines.push(`    ${check.detail}`);
      }
      await input.ctx.bot.sendText({
        chatId: input.message.chat.id,
        text: clampMessage(lines.join("\n")),
      });
    };
  }

  return {
    name: "devtools",
    // Only `/streamdemo` is listed. The `/test_*` family answers «не знаю такой
    // команды» to everyone outside DEVELOPER_IDS, and a menu full of commands
    // most readers cannot use is an invitation to keep trying them.
    commandList: [{ command: "streamdemo", description: "Демонстрация пошагового отчёта" }],
    commands,
    callbacks: {
      async [STREAM_AGAIN](input: CallbackContext) {
        await input.ctx.bot.answerCallbackQuery(input.query.id);
        // The previous report's button is spent: leaving it live would let one
        // message start any number of runs.
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId as ChatId,
          messageId: input.query.message.id as MessageId,
          text: "Отчёт",
        });
        await runStreamDemo(input.ctx, input.query.message.chatId);
      },
    },
  };
}
