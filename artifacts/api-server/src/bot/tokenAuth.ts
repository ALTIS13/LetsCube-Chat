import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;
const TOKEN_PREFIX_BYTES = 5;
const TOKEN_PREFIX_RE = /^lc_bot_[0-9a-f]{10}$/;
const BOT_TOKEN_RE = /^(lc_bot_[0-9a-f]{10})\.([A-Za-z0-9_-]{43})$/;
const TOKEN_HASH_RE = /^[0-9a-f]{64}$/;
const MIN_PEPPER_BYTES = 32;
const MAX_PEPPER_BYTES = 1024;

export type BotTokenMaterial = {
  raw: string;
  prefix: string;
};

export type BotAuthConfig = {
  url: string;
  serviceRoleKey: string;
  pepper: string;
};

export type RandomBytesSource = (size: number) => Uint8Array;

function invalidConfig(): never {
  throw new Error("bot_auth_config_invalid");
}

function requiredEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  names: readonly string[],
): string {
  for (const name of names) {
    const value = environment[name];
    if (
      value &&
      value === value.trim() &&
      !/[\u0000-\u001f\u007f]/.test(value)
    ) {
      return value;
    }
  }
  return invalidConfig();
}

function assertTrustedSupabaseUrl(value: string): void {
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password ||
      !parsed.hostname
    ) {
      invalidConfig();
    }
  } catch {
    invalidConfig();
  }
}

function assertStrongPepper(value: string): void {
  const byteLength = Buffer.byteLength(value, "utf8");
  const distinctCharacters = new Set(value).size;
  if (
    byteLength < MIN_PEPPER_BYTES ||
    byteLength > MAX_PEPPER_BYTES ||
    distinctCharacters < 8 ||
    /^(change[-_ ]?me|replace[-_ ]?me|example|test)$/i.test(value)
  ) {
    invalidConfig();
  }
}

export function resolveBotAuthConfig(
  environment: NodeJS.ProcessEnv,
): BotAuthConfig {
  const url = requiredEnvironmentValue(environment, [
    "SUPABASE_URL",
    "VITE_SUPABASE_URL",
  ]);
  const serviceRoleKey = requiredEnvironmentValue(environment, [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SELFHOST_SERVICE_ROLE_KEY",
  ]);
  const pepper = requiredEnvironmentValue(environment, ["BOT_TOKEN_PEPPER"]);
  assertTrustedSupabaseUrl(url);
  assertStrongPepper(pepper);
  return { url, serviceRoleKey, pepper };
}

export function createBotToken(
  randomSource: RandomBytesSource = randomBytes,
): BotTokenMaterial {
  const random = Buffer.from(randomSource(TOKEN_BYTES));
  if (random.length !== TOKEN_BYTES) {
    throw new Error("bot_token_generation_failed");
  }
  const prefix = `lc_bot_${random.subarray(0, TOKEN_PREFIX_BYTES).toString("hex")}`;
  const secret = random.toString("base64url");
  return { raw: `${prefix}.${secret}`, prefix };
}

export function parseBotAuthorization(
  header: string | readonly string[] | undefined,
): string | null {
  if (typeof header !== "string" || header.length > 260) return null;
  if (/[\u0000-\u001f\u007f,]/.test(header)) return null;
  if (!header.startsWith("Bot ") || header.indexOf(" ", 4) !== -1) return null;
  const raw = header.slice(4);
  return BOT_TOKEN_RE.test(raw) ? raw : null;
}

export function extractBotTokenPrefix(raw: string): string | null {
  if (raw.length > 256) return null;
  const match = BOT_TOKEN_RE.exec(raw);
  const prefix = match?.[1];
  return prefix && TOKEN_PREFIX_RE.test(prefix) ? prefix : null;
}

export function hashBotToken(raw: string, pepper: string): string {
  if (!BOT_TOKEN_RE.test(raw)) {
    throw new Error("bot_token_invalid");
  }
  assertStrongPepper(pepper);
  return createHmac("sha256", pepper).update(raw, "utf8").digest("hex");
}

export function verifyBotTokenHash(
  raw: string,
  pepper: string,
  storedHash: string,
): boolean {
  if (!BOT_TOKEN_RE.test(raw) || !TOKEN_HASH_RE.test(storedHash)) return false;
  try {
    const actual = Buffer.from(hashBotToken(raw, pepper), "hex");
    const expected = Buffer.from(storedHash, "hex");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}
