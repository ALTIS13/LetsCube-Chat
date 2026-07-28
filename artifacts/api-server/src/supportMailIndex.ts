import express from "express";
import { createServer } from "node:http";
import { logger } from "./lib/logger";
import { startSupportMailBridge } from "./workers/supportMailBridge";

const port = Number(
  process.env.SUPPORT_MAIL_PORT ?? process.env.PORT ?? "8097",
);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("support_mail_port_invalid");
}

const bridge = startSupportMailBridge();
const app = express();

app.disable("x-powered-by");
app.get("/healthz", (_request, response) => {
  const state = bridge.state();
  response.status(state.running || !state.enabled ? 200 : 503).json({
    ok: state.running || !state.enabled,
    enabled: state.enabled,
  });
});
app.get("/readyz", (_request, response) => {
  const state = bridge.state();
  response.status(state.ready ? 200 : 503).json({
    ready: state.ready,
    enabled: state.enabled,
  });
});

const server = createServer(app);
server.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "supportMailBridge health server listening");
});
server.on("error", (error) => {
  logger.error(
    { errorCode: error instanceof Error ? error.name : "unknown" },
    "supportMailBridge health server failed",
  );
  process.exitCode = 1;
});

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "supportMailBridge stopping");
  server.close();
  await bridge.stop();
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void stop(signal).finally(() => process.exit(process.exitCode ?? 0));
  });
}
