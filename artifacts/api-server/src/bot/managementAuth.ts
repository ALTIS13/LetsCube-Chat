import { BotApiError } from "#bot/errors";

const BEARER_RE = /^Bearer ([A-Za-z0-9._~+\/-]+={0,2})$/;
const MAX_BEARER_LENGTH = 4_096;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCTION_MANAGEMENT_ORIGIN = "https://app.letscube.ru";

export interface BotManagementAuthClient {
  auth: {
    getUser(accessToken: string): PromiseLike<{
      data: { user: { id?: unknown } | null } | null;
      error: unknown;
    }>;
  };
}

export function parseManagementAuthorization(
  header: string | undefined,
): string | null {
  if (!header || header.length > MAX_BEARER_LENGTH + 7) return null;
  const match = BEARER_RE.exec(header);
  const token = match?.[1];
  return token && token.length <= MAX_BEARER_LENGTH ? token : null;
}

export async function authenticateManagementUser(
  header: string | undefined,
  client: BotManagementAuthClient,
): Promise<string> {
  const accessToken = parseManagementAuthorization(header);
  if (!accessToken) throw new BotApiError("unauthorized");

  let result: Awaited<ReturnType<BotManagementAuthClient["auth"]["getUser"]>>;
  try {
    result = await client.auth.getUser(accessToken);
  } catch {
    throw new BotApiError("unauthorized");
  }
  const userId = result.data?.user?.id;
  if (result.error || typeof userId !== "string" || !UUID_RE.test(userId)) {
    throw new BotApiError("unauthorized");
  }
  return userId;
}

export function resolveBotManagementOrigins(
  environment: NodeJS.ProcessEnv,
): readonly string[] {
  const configured = environment.BOT_MANAGEMENT_ALLOWED_ORIGINS?.split(",") ?? [];
  const origins = new Set([PRODUCTION_MANAGEMENT_ORIGIN]);

  for (const candidate of configured) {
    const origin = candidate.trim();
    if (!origin) continue;
    if (origin.length > 2_048 || origin === "*" || origin === "null") {
      throw new Error("bot_gateway_config_invalid");
    }
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("bot_gateway_config_invalid");
    }
    const isLocalHttp =
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if (
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      (parsed.protocol !== "https:" && !isLocalHttp)
    ) {
      throw new Error("bot_gateway_config_invalid");
    }
    origins.add(origin);
  }

  if (origins.size > 16) throw new Error("bot_gateway_config_invalid");
  return [...origins];
}
