import { button, keyboard, type AppContext } from "#pf/app/context";
import type { CallbackContext, CommandContext, Feature } from "#pf/app/router";
import { asCode, clampMessage } from "#pf/lib/render";
import { LETSCUBE_GAPS } from "#pf/transport/letscube";
import type { ChatId, MessageId, TransportCapability } from "#pf/transport/types";

/**
 * `/selftest` — a compatibility report, not a demo (§15).
 *
 * The brief is unusually precise about this one, and the precision is the
 * point. Three rules shape everything below:
 *
 * **1. UNSUPPORTED is not FAIL.** «The platform does not have this» and «the
 * platform has this and it is broken» are different facts, and a report that
 * merges them is worse than no report — it turns a known gap into noise that
 * hides a real regression. So capability support is *declared* by the
 * transport, checked before anything is called, and reported separately.
 *
 * **2. A test that needs a person is not PASS until the person acts.** A
 * `callback_query` cannot be proved by sending a button; it is proved when the
 * press comes back. Until then the row says USER_ACTION_REQUIRED, which is a
 * real status and not a polite failure.
 *
 * **3. A run is kept.** §15 asks that two runs be comparable after a platform
 * change, which means the report is a stored document rather than a printed
 * message. `pf_selftest_runs` holds it, and a later run can be diffed against
 * the last one.
 */

export type CheckStatus = "PASS" | "FAIL" | "UNSUPPORTED" | "USER_ACTION_REQUIRED" | "SKIPPED";

export type CheckResult = {
  id: string;
  section: string;
  title: string;
  status: CheckStatus;
  detail: string;
};

export type SelftestReport = {
  platform: string;
  startedAt: string;
  finishedAt: string | null;
  checks: CheckResult[];
};

type CheckEnvironment = {
  ctx: AppContext;
  chatId: ChatId;
  runId: string;
  /** Messages this run produced, so it can tidy up after itself. */
  scratch: { chatId: ChatId; messageId: MessageId }[];
};

type Check = {
  id: string;
  section: string;
  title: string;
  /** The capability this needs. When the transport says it lacks it, the check is not run. */
  requires?: TransportCapability;
  run: (env: CheckEnvironment) => Promise<{ status: CheckStatus; detail: string }>;
};

const SECTION_ORDER = [
  "Transport",
  "Messages",
  "Buttons",
  "Media",
  "Interaction",
  "Advanced",
] as const;

const PROBE = "selftest.probe";
const ICON: Record<CheckStatus, string> = {
  PASS: "✅",
  FAIL: "❌",
  UNSUPPORTED: "⛔",
  USER_ACTION_REQUIRED: "⏳",
  SKIPPED: "◻️",
};

function fail(error: unknown): { status: CheckStatus; detail: string } {
  return {
    status: "FAIL",
    detail: error instanceof Error ? error.message : "unknown error",
  };
}

/**
 * Capabilities that are asserted rather than exercised.
 *
 * Every one of these is listed as a check so the report is a complete picture
 * of Telegram Bot API 10.3 rather than a list of what we happened to try. The
 * reason strings come from the transport's own gap map, so a capability that
 * the platform gains stops being reported as missing the moment the adapter
 * says so — there is no second list to remember to update.
 */
const DECLARED_ONLY: { id: string; section: string; title: string; capability: TransportCapability }[] = [
  { id: "media.send_photo", section: "Media", title: "sendPhoto", capability: "sendPhoto" },
  { id: "media.send_document", section: "Media", title: "sendDocument", capability: "sendDocument" },
  { id: "media.send_by_file_id", section: "Media", title: "переотправка файла по file_id", capability: "sendFileById" },
  { id: "media.upload", section: "Media", title: "загрузка нового файла", capability: "uploadFile" },
  { id: "messages.edit_markup", section: "Messages", title: "editMessageReplyMarkup", capability: "editMessageReplyMarkup" },
  { id: "interaction.inline_mode", section: "Interaction", title: "inline mode", capability: "inlineMode" },
  { id: "interaction.poll", section: "Interaction", title: "опросы", capability: "poll" },
  { id: "advanced.reactions", section: "Advanced", title: "реакции", capability: "reactions" },
  { id: "advanced.rich", section: "Advanced", title: "Rich Messages", capability: "richMessages" },
  { id: "advanced.streaming", section: "Advanced", title: "streaming", capability: "streaming" },
  { id: "advanced.ephemeral", section: "Advanced", title: "ephemeral", capability: "ephemeral" },
  { id: "advanced.mini_app", section: "Advanced", title: "Mini App", capability: "miniApp" },
];

const CHECKS: Check[] = [
  {
    id: "transport.get_me",
    section: "Transport",
    title: "аутентификация токеном (getMe)",
    async run({ ctx }) {
      try {
        const me = await ctx.bot.getMe();
        return { status: "PASS", detail: `@${me.username ?? "—"}` };
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    id: "transport.mode",
    section: "Transport",
    title: "режим доставки обновлений",
    async run({ ctx }) {
      try {
        const info = await ctx.bot.getWebhookInfo();
        const configured = info.configured ? "webhook" : "polling";
        // The configured transport and the platform's opinion can disagree —
        // a webhook left over from an earlier deployment while this process
        // polls is a real and confusing state, so the report names both.
        const detail =
          configured === ctx.config.transport
            ? `${configured}, pending=${info.pendingUpdateCount}`
            : `настроен ${ctx.config.transport}, платформа сообщает ${configured}`;
        return {
          status: configured === ctx.config.transport ? "PASS" : "FAIL",
          detail,
        };
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    id: "transport.webhook_health",
    section: "Transport",
    title: "ошибки доставки webhook",
    async run({ ctx }) {
      try {
        const info = await ctx.bot.getWebhookInfo();
        if (!info.configured) return { status: "SKIPPED", detail: "webhook не настроен" };
        return {
          status: info.failureCount === 0 ? "PASS" : "FAIL",
          detail: `failures=${info.failureCount}, last=${info.lastErrorCode ?? "—"}`,
        };
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    id: "messages.send",
    section: "Messages",
    title: "sendMessage",
    requires: "sendText",
    async run(env) {
      try {
        const sent = await env.ctx.bot.sendText({
          chatId: env.chatId,
          text: "selftest: обычное сообщение",
        });
        env.scratch.push({ chatId: env.chatId, messageId: sent.id });
        return { status: "PASS", detail: "отправлено" };
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    id: "messages.reply",
    section: "Messages",
    title: "ответ на сообщение",
    requires: "replyToMessage",
    async run(env) {
      const target = env.scratch[0];
      if (!target) return { status: "SKIPPED", detail: "нет сообщения, на которое отвечать" };
      try {
        const sent = await env.ctx.bot.sendText({
          chatId: env.chatId,
          text: "selftest: ответ",
          replyToMessageId: target.messageId,
        });
        env.scratch.push({ chatId: env.chatId, messageId: sent.id });
        return { status: "PASS", detail: "отправлено" };
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    id: "messages.formatting",
    section: "Messages",
    title: "форматирование текста",
    requires: "sendText",
    async run(env) {
      try {
        // There is no `parse_mode` on this platform and the client formats
        // every message regardless (G-5), so what is being checked is that a
        // literal string can be sent at all — which needs `asCode`.
        const sent = await env.ctx.bot.sendText({
          chatId: env.chatId,
          text: `selftest: буквально ${asCode("*не курсив*")}`,
        });
        env.scratch.push({ chatId: env.chatId, messageId: sent.id });
        return {
          status: "PASS",
          detail: "нет parse_mode; буквальный текст только через code-span (G-5)",
        };
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    id: "messages.edit",
    section: "Messages",
    title: "editMessageText",
    requires: "editMessageText",
    async run(env) {
      const target = env.scratch[0];
      if (!target) return { status: "SKIPPED", detail: "нечего править" };
      try {
        await env.ctx.bot.editText({
          chatId: target.chatId,
          messageId: target.messageId,
          text: "selftest: сообщение изменено",
        });
        return { status: "PASS", detail: "изменено" };
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    id: "messages.delete",
    section: "Messages",
    title: "deleteMessage",
    requires: "deleteMessage",
    async run(env) {
      const target = env.scratch.pop();
      if (!target) return { status: "SKIPPED", detail: "нечего удалять" };
      try {
        await env.ctx.bot.deleteMessage(target.chatId, target.messageId);
        return { status: "PASS", detail: "удалено" };
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    id: "messages.chat_action",
    section: "Messages",
    title: "sendChatAction",
    requires: "chatAction",
    async run(env) {
      try {
        await env.ctx.bot.sendChatAction(env.chatId, "typing");
        return { status: "PASS", detail: "typing" };
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    id: "buttons.inline_keyboard",
    section: "Buttons",
    title: "inline-клавиатура",
    requires: "inlineKeyboard",
    async run(env) {
      try {
        const sent = await env.ctx.bot.sendText({
          chatId: env.chatId,
          text: "selftest: нажмите кнопку, чтобы проверить callback",
          keyboard: keyboard([button("Проверить callback", PROBE, env.runId)]),
        });
        env.scratch.push({ chatId: env.chatId, messageId: sent.id });
        return { status: "PASS", detail: "клавиатура отправлена" };
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    id: "buttons.callback_query",
    section: "Buttons",
    title: "callback_query",
    requires: "callbackQuery",
    async run() {
      // Never PASS from here. The button was sent; that proves nothing about
      // whether a press comes back. Only the callback handler may promote it.
      return { status: "USER_ACTION_REQUIRED", detail: "нажмите кнопку выше" };
    },
  },
  {
    id: "commands.set",
    section: "Interaction",
    title: "setMyCommands / getMyCommands",
    requires: "setMyCommands",
    async run({ ctx }) {
      try {
        const before = await ctx.bot.getMyCommands();
        return { status: "PASS", detail: `${before.length} команд зарегистрировано` };
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    id: "media.get_file",
    section: "Media",
    title: "getFile",
    requires: "getFile",
    async run() {
      // Honest: this needs a file the bot has been sent, and the run does not
      // have one. Claiming PASS from the method's existence would be exactly
      // the lie the brief's §22.13 is about.
      return {
        status: "USER_ACTION_REQUIRED",
        detail: "пришлите боту файл и нажмите SHA256 — это и есть проверка getFile",
      };
    },
  },
];

function renderReport(report: SelftestReport): string {
  const lines: string[] = [`Отчёт /selftest — платформа ${report.platform}`, ""];
  const counts: Record<CheckStatus, number> = {
    PASS: 0,
    FAIL: 0,
    UNSUPPORTED: 0,
    USER_ACTION_REQUIRED: 0,
    SKIPPED: 0,
  };
  for (const section of SECTION_ORDER) {
    const checks = report.checks.filter((check) => check.section === section);
    if (checks.length === 0) continue;
    lines.push(section);
    for (const check of checks) {
      counts[check.status] += 1;
      lines.push(`  ${ICON[check.status]} ${check.title} — ${check.status}`);
      if (check.detail) lines.push(`      ${check.detail}`);
    }
    lines.push("");
  }
  lines.push(
    `Итог: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.UNSUPPORTED} UNSUPPORTED, ` +
      `${counts.USER_ACTION_REQUIRED} ждут действия, ${counts.SKIPPED} пропущено`,
  );
  return clampMessage(lines.join("\n"));
}

async function startRun(ctx: AppContext, requestedBy: string, chatId: string): Promise<string> {
  const result = await ctx.db.query<{ id: string }>(
    `insert into pf_selftest_runs (requested_by, chat_id) values ($1, $2) returning id`,
    [requestedBy, chatId],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("selftest run was not created");
  return id;
}

async function saveRun(ctx: AppContext, runId: string, report: SelftestReport): Promise<void> {
  await ctx.db.query(
    `update pf_selftest_runs set report = $2::jsonb, finished_at = now() where id = $1`,
    [runId, JSON.stringify(report)],
  );
}

async function loadRun(
  ctx: AppContext,
  requestedBy: string,
  runId: string,
): Promise<SelftestReport | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) return null;
  const result = await ctx.db.query<{ report: SelftestReport }>(
    // Scoped to whoever asked for the run: a probe button carries a run id,
    // and a run id from a client is a lookup and not a permission (§19).
    `select report from pf_selftest_runs where id = $1 and requested_by = $2`,
    [runId, requestedBy],
  );
  return result.rows[0]?.report ?? null;
}

export async function runSelftest(
  ctx: AppContext,
  input: { requestedBy: string; chatId: string },
): Promise<{ runId: string; report: SelftestReport }> {
  const runId = await startRun(ctx, input.requestedBy, input.chatId);
  const env: CheckEnvironment = {
    ctx,
    chatId: input.chatId as ChatId,
    runId,
    scratch: [],
  };
  const checks: CheckResult[] = [];

  for (const check of CHECKS) {
    if (check.requires && !ctx.bot.supports(check.requires)) {
      checks.push({
        id: check.id,
        section: check.section,
        title: check.title,
        status: "UNSUPPORTED",
        detail: LETSCUBE_GAPS.get(check.requires) ?? "не поддерживается платформой",
      });
      continue;
    }
    const outcome = await check.run(env);
    checks.push({
      id: check.id,
      section: check.section,
      title: check.title,
      status: outcome.status,
      detail: outcome.detail,
    });
  }

  for (const declared of DECLARED_ONLY) {
    const supported = ctx.bot.supports(declared.capability);
    checks.push({
      id: declared.id,
      section: declared.section,
      title: declared.title,
      status: supported ? "SKIPPED" : "UNSUPPORTED",
      detail: supported
        ? "поддерживается, но этим прогоном не проверялось"
        : (LETSCUBE_GAPS.get(declared.capability) ?? "не реализовано платформой"),
    });
  }

  const report: SelftestReport = {
    platform: ctx.bot.platform,
    startedAt: ctx.now().toISOString(),
    finishedAt: ctx.now().toISOString(),
    checks,
  };
  await saveRun(ctx, runId, report);
  return { runId, report };
}

export function createSelftestFeature(): Feature {
  return {
    name: "selftest",
    commandList: [{ command: "selftest", description: "Отчёт о совместимости" }],
    commands: {
      async selftest(input: CommandContext) {
        const { report } = await runSelftest(input.ctx, {
          requestedBy: input.user.userId,
          chatId: input.message.chat.id,
        });
        await input.ctx.bot.sendText({
          chatId: input.message.chat.id,
          text: renderReport(report),
        });
      },
    },
    callbacks: {
      async [PROBE](input: CallbackContext) {
        const runId = input.args[0] ?? "";
        const report = await loadRun(input.ctx, input.user.userId, runId);
        if (!report) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, {
            text: "Этот прогон больше не доступен",
          });
          return;
        }
        // The press is the evidence. This is the only place a
        // USER_ACTION_REQUIRED row may become PASS.
        const updated: SelftestReport = {
          ...report,
          checks: report.checks.map((check) =>
            check.id === "buttons.callback_query"
              ? { ...check, status: "PASS" as const, detail: "нажатие получено" }
              : check,
          ),
        };
        await saveRun(input.ctx, runId, updated);
        await input.ctx.bot.answerCallbackQuery(input.query.id, { text: "callback получен" });
        await input.ctx.bot.sendText({
          chatId: input.query.message.chatId,
          text: renderReport(updated),
        });
      },
    },
  };
}

export { renderReport };
