import app from "./app";
import { logger } from "./lib/logger";
import { startPushDispatcher } from "./workers/pushDispatcher";

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
  // Boot the in-process push dispatcher (Task #32). It self-disables
  // when SUPABASE_SERVICE_ROLE_KEY / VAPID_* are not configured, so
  // dev runs without secrets just log a warning and continue.
  startPushDispatcher();
});
