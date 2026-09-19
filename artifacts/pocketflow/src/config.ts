/**
 * PocketFlow's configuration, read once from the environment.
 *
 * §18 of the brief names the variables; this validates them and fails closed,
 * because a bot that starts with a missing `PUBLIC_BASE_URL` and only discovers
 * it when somebody presses «Webhooks» has moved a startup error into a user's
 * conversation.
 *
 * Nothing here is ever logged. `BOT_TOKEN` and `WEBHOOK_SECRET` are read into
 * the object and the object is never serialised — `toJSON` below makes that
 * true even if somebody passes the config to a structured logger, which is the
 * realistic way a token escapes.
 */

export type Transport = "polling" | "webhook";

export type PocketFlowConfig = {
  botToken: string;
  botApiBaseUrl: string;
  publicBaseUrl: string | null;
  transport: Transport;
  databaseUrl: string;
  developerIds: ReadonlySet<string>;
  webhookSecret: string | null;
  port: number;
  /** The IANA zone used for a person who has not said otherwise. */
  defaultTimeZone: string;
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`${name} is required`);
  }
  return value.trim();
}

function httpsOrLocalUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${name} must be an absolute URL`);
  }
  // http is allowed only against a loopback host, which is how the bot is run
  // locally against a development gateway. Anything else must be https.
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new ConfigError(`${name} must use https (http is allowed only on loopback)`);
  }
  if (url.username || url.password) {
    throw new ConfigError(`${name} must not carry credentials`);
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

function parseTimeZone(value: string | undefined): string {
  const zone = value?.trim();
  if (!zone) return "Europe/Moscow";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
  } catch {
    throw new ConfigError(`DEFAULT_TIME_ZONE is not a known IANA zone: ${zone}`);
  }
  return zone;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PocketFlowConfig {
  const transportRaw = (env.TRANSPORT ?? "polling").trim();
  if (transportRaw !== "polling" && transportRaw !== "webhook") {
    throw new ConfigError('TRANSPORT must be "polling" or "webhook"');
  }

  const publicBaseUrl = env.PUBLIC_BASE_URL?.trim()
    ? httpsOrLocalUrl(env.PUBLIC_BASE_URL, "PUBLIC_BASE_URL")
    : null;

  // Both of PocketFlow's own HTTP surfaces — the update webhook and the
  // external `/hook/<id>` inbox — need a public address. Webhook transport
  // cannot be configured without one, and refusing at startup is better than a
  // setWebhook call that fails against the gateway's own URL validation.
  if (transportRaw === "webhook" && !publicBaseUrl) {
    throw new ConfigError("PUBLIC_BASE_URL is required when TRANSPORT=webhook");
  }

  const webhookSecret = env.WEBHOOK_SECRET?.trim() || null;
  if (webhookSecret !== null && !/^[A-Za-z0-9_-]{16,256}$/.test(webhookSecret)) {
    throw new ConfigError("WEBHOOK_SECRET must be 16-256 characters of [A-Za-z0-9_-]");
  }
  if (transportRaw === "webhook" && webhookSecret === null) {
    throw new ConfigError("WEBHOOK_SECRET is required when TRANSPORT=webhook");
  }

  const portRaw = env.PORT?.trim();
  const port = portRaw ? Number(portRaw) : 8099;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError("PORT must be a TCP port number");
  }

  const developerIds = new Set(
    (env.DEVELOPER_IDS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

  const config: PocketFlowConfig = {
    botToken: required(env, "BOT_TOKEN"),
    botApiBaseUrl: httpsOrLocalUrl(required(env, "BOT_API_BASE_URL"), "BOT_API_BASE_URL"),
    publicBaseUrl,
    transport: transportRaw,
    databaseUrl: required(env, "DATABASE_URL"),
    developerIds,
    webhookSecret,
    port,
    defaultTimeZone: parseTimeZone(env.DEFAULT_TIME_ZONE),
  };

  // The one line that keeps a token out of a log. A structured logger calls
  // JSON.stringify on whatever it is handed; this makes that harmless.
  Object.defineProperty(config, "toJSON", {
    enumerable: false,
    value: () => ({
      botApiBaseUrl: config.botApiBaseUrl,
      publicBaseUrl: config.publicBaseUrl,
      transport: config.transport,
      port: config.port,
      defaultTimeZone: config.defaultTimeZone,
      developerCount: config.developerIds.size,
      botToken: "[redacted]",
      databaseUrl: "[redacted]",
      webhookSecret: config.webhookSecret === null ? null : "[redacted]",
    }),
  });

  return config;
}

export function isDeveloper(config: PocketFlowConfig, userId: string | null): boolean {
  return userId !== null && config.developerIds.has(userId);
}
