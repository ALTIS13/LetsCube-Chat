import { createBotGatewayApp } from "./bot/app";
import {
  combineBotMethodHandlers,
  createBotRequestFingerprint,
  createTask3MethodHandlers,
  type BotMethodFingerprint,
} from "./bot/methodRouter";
import {
  createBotChatActionPublisher,
  createBotMethodRepository,
  createBotServiceClient,
  createBotTokenRepository,
} from "./bot/repository";
import { resolveBotAuthConfig } from "./bot/tokenAuth";
import {
  createBotDeliveryRepository,
  createUpdateDeliveryHandlers,
} from "./bot/updateDelivery";
import {
  resolveWebhookEncryptionKey,
  validateWebhookTarget,
} from "./bot/webhookSecurity";
import {
  createWebhookWorkerRepository,
  createWebhookWorkerRuntime,
} from "./bot/webhookWorker";
import { logger } from "./lib/logger";

export function resolveBotGatewayPort(environment: NodeJS.ProcessEnv): number {
  const rawPort = environment.PORT;
  if (!rawPort || !/^[1-9]\d{0,4}$/.test(rawPort)) {
    throw new Error("bot_gateway_config_invalid");
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new Error("bot_gateway_config_invalid");
  }
  return port;
}

export function startBotGateway(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const port = resolveBotGatewayPort(environment);
  if (!environment.BOT_TOKEN_PEPPER) {
    throw new Error("bot_gateway_config_invalid");
  }
  const authConfig = resolveBotAuthConfig(environment);
  const webhookEncryptionKey = resolveWebhookEncryptionKey(environment);
  const client = createBotServiceClient(environment);
  const repository = createBotMethodRepository(client);
  const fingerprint: BotMethodFingerprint = (method, methodInput) =>
    createBotRequestFingerprint(authConfig.pepper, method, methodInput);
  const handlers = combineBotMethodHandlers(
    createTask3MethodHandlers({
      repository,
      fingerprint,
      publishChatAction: createBotChatActionPublisher(client),
    }),
    createUpdateDeliveryHandlers({
      repository: createBotDeliveryRepository(client),
      fingerprint,
      encryptionKey: webhookEncryptionKey,
      validateTarget: validateWebhookTarget,
    }),
  );
  const webhookWorker = createWebhookWorkerRuntime({
    repository: createWebhookWorkerRepository(client),
    encryptionKey: webhookEncryptionKey,
  });
  const app = createBotGatewayApp({
    logger,
    handlers,
    tokenRepository: createBotTokenRepository(environment, client),
  });
  const server = app.listen(port, "0.0.0.0");
  server.once("listening", () => {
    webhookWorker.start();
    logger.info({ port }, "Bot Gateway listening");
  });
  server.once("close", () => webhookWorker.stop());
  server.once("error", () => {
    logger.error("Bot Gateway listen failed");
    process.exitCode = 1;
  });
}

try {
  startBotGateway();
} catch {
  logger.error("Bot Gateway startup failed");
  process.exitCode = 1;
}
