import type { AppContext } from "#pf/app/context";
import { createFeatures } from "#pf/app/features";
import { createRemindersJob } from "#pf/app/reminders";
import { createRouter } from "#pf/app/router";
import { recordUpdateForDebug } from "#pf/app/settings";
import { watcherJob } from "#pf/app/watcher";
import { loadConfig, ConfigError } from "#pf/config";
import { botWebhookUrl, startHttpServer } from "#pf/http/server";
import { createLogger } from "#pf/lib/logger";
import { createPollingLoop } from "#pf/polling";
import { createScheduler } from "#pf/scheduler/index";
import { createDb, migrate } from "#pf/store/db";
import { pruneCandidates } from "#pf/store/candidates";
import { pruneProcessedUpdates } from "#pf/store/updates";
import { LetscubeTransport } from "#pf/transport/letscube";
import type { Update } from "#pf/transport/types";

/**
 * PocketFlow's entry point.
 *
 * The order below is the only interesting thing about it, and each step is
 * placed where it is for a reason:
 *
 *   1. configuration, which fails closed — a bot that starts with a missing
 *      `PUBLIC_BASE_URL` and discovers it when somebody presses «Webhooks» has
 *      moved a startup error into a conversation;
 *   2. migrations, before anything can query;
 *   3. `getMe`, because the bot's own `@username` is needed to recognise being
 *      addressed in a group, and because it is the cheapest proof the token
 *      works — better to fail here than on the first person who writes;
 *   4. commands, so the client's menu matches the router rather than a list
 *      somebody maintained by hand;
 *   5. the transport, last, so nothing is accepted before it can be handled.
 *
 * Shutdown runs the same list backwards and is genuinely graceful (§19): the
 * long poll is aborted rather than waited out, in-flight webhook deliveries are
 * drained, and running jobs are given time to finish.
 */

async function main(): Promise<void> {
  const log = createLogger({ minLevel: (process.env.LOG_LEVEL as "info") ?? "info" });

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    // Deliberately not `log.error(..., {error})` with the object: a config
    // error's message names a variable, never its value, and keeping it a
    // string keeps it that way.
    log.error("config.invalid", {
      reason: error instanceof ConfigError ? error.message : "unreadable configuration",
    });
    process.exitCode = 1;
    return;
  }

  const db = createDb(config.databaseUrl);
  const applied = await migrate(db);
  if (applied.length > 0) log.info("migrations.applied", { files: applied });

  const bot = new LetscubeTransport({
    baseUrl: config.botApiBaseUrl,
    token: config.botToken,
  });

  const me = await bot.getMe();
  log.info("bot.identity", { username: me.username, platform: bot.platform });

  const ctx: AppContext = {
    config,
    db,
    bot,
    log,
    now: () => new Date(),
    botUsername: me.username,
  };

  const features = createFeatures();
  const router = createRouter(features);

  const commands = router.commandList();
  try {
    await bot.setMyCommands(commands);
    log.info("commands.registered", { count: commands.length });
  } catch (error) {
    // Not fatal. The bot works without a command menu, and refusing to start
    // over a cosmetic call would be a worse trade than the missing menu.
    log.warn("commands.failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  const scheduler = createScheduler({ log, now: ctx.now });
  scheduler.registerJob(createRemindersJob(ctx));
  scheduler.registerJob(watcherJob(ctx));
  scheduler.registerJob({
    name: "housekeeping",
    intervalMs: 60 * 60 * 1000,
    run: async () => {
      const candidates = await pruneCandidates(db);
      const updates = await pruneProcessedUpdates(db);
      if (candidates > 0 || updates > 0) {
        log.info("housekeeping.pruned", { candidates, updates });
      }
    },
  });
  scheduler.start();

  const handleUpdate = async (update: Update): Promise<void> => {
    try {
      // Kept in memory, for `/debug`, and only for a configured developer —
      // see `sanitizeUpdate`, which never lets a message body out.
      if (update.kind === "message" || update.kind === "edited_message") {
        const author = update.message.from.id;
        if (author && config.developerIds.has(author)) recordUpdateForDebug(author, update);
      } else if (update.kind === "callback_query") {
        const presser = update.callbackQuery.from.id;
        if (presser && config.developerIds.has(presser)) recordUpdateForDebug(presser, update);
      }
      await router.handle(ctx, update);
    } catch (error) {
      log.error("update.unhandled", {
        update_id: update.updateId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  };

  const server = await startHttpServer({
    config,
    db,
    bot,
    log,
    ...(config.transport === "webhook" ? { onUpdate: handleUpdate } : {}),
  });

  const polling =
    config.transport === "polling" ? createPollingLoop(ctx, router) : null;

  if (config.transport === "webhook") {
    if (!config.publicBaseUrl) throw new ConfigError("PUBLIC_BASE_URL is required");
    if (!config.webhookSecret) throw new ConfigError("WEBHOOK_SECRET is required");
    await bot.setWebhook({
      url: botWebhookUrl(config.publicBaseUrl),
      secretToken: config.webhookSecret,
    });
    log.info("webhook.registered");
  } else {
    // A webhook left over from an earlier deployment would swallow every
    // update while this process polls for them — the bot would look dead with
    // nothing in its own logs to say why.
    const info = await bot.getWebhookInfo();
    if (info.configured) {
      await bot.deleteWebhook();
      log.warn("webhook.cleared", { reason: "polling transport" });
    }
    polling?.start();
  }

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log.info("shutdown.start", { signal });
    await polling?.stop();
    await server.close();
    const clean = await scheduler.stop({ timeoutMs: 10_000 });
    await db.close();
    log.info("shutdown.done", { jobs_finished_cleanly: clean });
    process.exit(0);
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  log.info("pocketflow.started", {
    transport: config.transport,
    port: config.port,
    features: features.map((feature) => feature.name),
  });
}

main().catch((error: unknown) => {
  // The last line of defence. Anything that reaches here happened before the
  // logger had a context, so it is printed plainly and the process fails —
  // a bot that stays up without a transport is a bot that silently ignores
  // everybody.
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      event: "pocketflow.start_failed",
      error: error instanceof Error ? error.message : "unknown",
    })}\n`,
  );
  process.exit(1);
});
