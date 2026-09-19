/**
 * Structured logs with correlation ids (§19), and nothing else.
 *
 * One line of JSON per event on stdout. No dependency, because the only thing
 * a logging library would add here is a way for a token to reach a log through
 * a transport nobody reviewed.
 *
 * **The redaction is not decoration.** §20 forbids logging tokens,
 * authorization headers and personal payloads. A bot's fields are exactly the
 * dangerous ones — a message's text is a person's private message — so the
 * rule here is the inverse of the usual one: a field is logged only if it was
 * named, and `text`, `token`, `secret`, `authorization` and `password` are
 * dropped even when named, wherever they appear in the tree.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const FORBIDDEN_KEYS = new Set([
  "text",
  "body",
  "content",
  "caption",
  "token",
  "bot_token",
  "botToken",
  "secret",
  "webhook_secret",
  "webhookSecret",
  "authorization",
  "password",
  "email",
  "phone",
]);

const MAX_DEPTH = 4;

function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[deep]";
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => redact(entry, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = FORBIDDEN_KEYS.has(key) ? "[redacted]" : redact(entry, depth + 1);
  }
  return out;
}

export type Logger = {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  /** A child that stamps every line with the same correlation id. */
  with(fields: Record<string, unknown>): Logger;
};

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(options?: {
  minLevel?: LogLevel;
  base?: Record<string, unknown>;
  write?: (line: string) => void;
}): Logger {
  const minLevel = LEVEL_ORDER[options?.minLevel ?? "info"];
  const base = options?.base ?? {};
  const write = options?.write ?? ((line: string) => process.stdout.write(`${line}\n`));

  const emit = (level: LogLevel, event: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < minLevel) return;
    write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        event,
        ...(redact(base) as Record<string, unknown>),
        ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
      }),
    );
  };

  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    with: (fields) =>
      createLogger({
        minLevel: options?.minLevel ?? "info",
        base: { ...base, ...fields },
        write,
      }),
  };
}
