import app from "./app";
import { logger } from "./lib/logger";
import { startMediaVariantsWorker } from "./workers/mediaVariantsWorker";
import { startPushDispatcher } from "./workers/pushDispatcher";
import { shouldStartLegacyPushDispatcher } from "./workers/pushDispatcherConfig";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Supabase Cron + send-push-notifications is the production owner of both
  // Web Push and native delivery. Keep the legacy loop opt-in so two consumers
  // cannot race the same outbox and exhaust attempts before the cron tick.
  if (shouldStartLegacyPushDispatcher(process.env["PUSH_DISPATCHER_ENABLED"])) {
    startPushDispatcher();
  }
  startMediaVariantsWorker();
});
