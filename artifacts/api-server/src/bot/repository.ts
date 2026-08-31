import { createClient } from "@supabase/supabase-js";

import { BotApiError } from "#bot/errors";
import {
  extractBotTokenPrefix,
  parseBotAuthorization,
  resolveBotAuthConfig,
  verifyBotTokenHash,
} from "#bot/tokenAuth";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_HASH_RE = /^[0-9a-f]{64}$/;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type BotRpcResult = {
  data: unknown;
  error: unknown;
};

export interface BotRpcClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<BotRpcResult>;
}

export type AuthenticatedBot = {
  botId: string;
  tokenId: string;
};

export interface BotTokenRepository {
  authenticateBotToken(
    header: string | readonly string[] | undefined,
  ): Promise<AuthenticatedBot>;
}

type TokenLookupRow = {
  tokenId: string;
  botId: string;
  tokenHash: string;
  tokenCreatedAt: number;
  tokenLastUsedAt: number | null;
  botState: string;
};

function unauthorized(): BotApiError {
  return new BotApiError("unauthorized");
}

function internalError(): BotApiError {
  return new BotApiError("internal_error");
}

function parseTimestamp(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "string") throw internalError();
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw internalError();
  return timestamp;
}

function projectTokenLookup(value: unknown): TokenLookupRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw internalError();
  }
  const row = value as Record<string, unknown>;
  const tokenId = row.token_id;
  const botId = row.bot_id;
  const tokenHash = row.token_hash;
  const botState = row.bot_state;
  if (
    typeof tokenId !== "string" ||
    !UUID_RE.test(tokenId) ||
    typeof botId !== "string" ||
    !UUID_RE.test(botId) ||
    typeof tokenHash !== "string" ||
    !TOKEN_HASH_RE.test(tokenHash) ||
    typeof botState !== "string" ||
    botState.length < 1 ||
    botState.length > 32
  ) {
    throw internalError();
  }
  const tokenCreatedAt = parseTimestamp(row.token_created_at);
  if (tokenCreatedAt === null) throw internalError();
  return {
    tokenId,
    botId,
    tokenHash,
    tokenCreatedAt,
    tokenLastUsedAt: parseTimestamp(row.token_last_used_at),
    botState,
  };
}

function createServiceRoleClient(environment: NodeJS.ProcessEnv): BotRpcClient {
  const { url, serviceRoleKey } = resolveBotAuthConfig(environment);
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as unknown as BotRpcClient;
}

export function createBotTokenRepository(
  environment: NodeJS.ProcessEnv = process.env,
  client: BotRpcClient = createServiceRoleClient(environment),
  now: () => Date = () => new Date(),
): BotTokenRepository {
  const { pepper } = resolveBotAuthConfig(environment);

  return {
    async authenticateBotToken(header) {
      const raw = parseBotAuthorization(header);
      if (!raw) throw unauthorized();
      const prefix = extractBotTokenPrefix(raw);
      if (!prefix) throw unauthorized();

      let lookup: BotRpcResult;
      try {
        lookup = await client.rpc("bot_token_lookup_internal", {
          p_token_prefix: prefix,
        });
      } catch {
        throw internalError();
      }
      if (lookup.error || !Array.isArray(lookup.data)) throw internalError();
      if (lookup.data.length === 0) throw unauthorized();
      if (lookup.data.length !== 1) throw internalError();

      const row = projectTokenLookup(lookup.data[0]);
      if (
        row.botState !== "active" ||
        !verifyBotTokenHash(raw, pepper, row.tokenHash)
      ) {
        throw unauthorized();
      }

      const usedAt = now();
      const usedAtMs = usedAt.getTime();
      if (!Number.isFinite(usedAtMs)) throw internalError();
      if (
        row.tokenLastUsedAt === null ||
        usedAtMs - row.tokenLastUsedAt >= TOUCH_INTERVAL_MS
      ) {
        try {
          await client.rpc("bot_token_touch_internal", {
            p_token_id: row.tokenId,
            p_used_at: usedAt.toISOString(),
          });
        } catch {
          // Usage telemetry is best effort and must not expose backend details.
        }
      }

      return { botId: row.botId, tokenId: row.tokenId };
    },
  };
}

export async function authenticateBotToken(
  header: string | readonly string[] | undefined,
  repository: BotTokenRepository = createBotTokenRepository(),
): Promise<AuthenticatedBot> {
  return repository.authenticateBotToken(header);
}
