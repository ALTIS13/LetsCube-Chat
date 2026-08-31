import { json, Router, type RequestHandler } from "express";
import { z } from "zod";

import { BotApiError, botSuccess, toBotApiErrorResponse } from "#bot/errors";
import {
  authenticateManagementUser,
  type BotManagementAuthClient,
} from "#bot/managementAuth";
import { exactAuthorizationHeader } from "#bot/methodRouter";
import type { BotRpcClient } from "#bot/repository";
import { createBotToken, hashBotToken } from "#bot/tokenAuth";
import {
  encryptWebhookSecret,
  validateWebhookTarget,
  type ValidatedWebhookTarget,
} from "#bot/webhookSecurity";

export interface BotManagementClient
  extends BotManagementAuthClient,
    BotRpcClient {}

export interface BotManagementRateLimiter {
  consume(actorId: string, operation: string): number | null;
}

export type BotCreationAdmission = (actorId: string) => boolean;

export type BotManagementDependencies = {
  client: BotManagementClient;
  tokenPepper: string;
  allowedOrigins: readonly string[];
  randomBytes?: (size: number) => Buffer;
  webhookEncryptionKey: Buffer;
  validateWebhookTarget?: (rawUrl: string) => Promise<ValidatedWebhookTarget>;
  rateLimiter?: BotManagementRateLimiter;
  canCreateBot: BotCreationAdmission;
};

const CORS_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const CORS_HEADERS = "Authorization,Content-Type";
const ALLOWED_METHODS = new Set(CORS_METHODS.split(","));
const ALLOWED_HEADERS = new Set(["authorization", "content-type"]);
const uuidSchema = z.string().uuid();
const MAX_BOT_CREATION_CANARY_USERS = 25;
const timestampSchema = z.string().datetime({ offset: true });
const botStateSchema = z.enum([
  "active",
  "paused",
  "suspended",
  "pending_delete",
  "deleted",
]);
const tokenPrefixSchema = z.string().regex(/^lc_bot_[0-9a-f]{10}$/);

export function resolveBotCreationAdmission(
  environment: NodeJS.ProcessEnv,
): BotCreationAdmission {
  const enabled = environment.BOT_CREATION_ENABLED;
  if (enabled === undefined || enabled === "" || enabled === "false") {
    return () => false;
  }
  if (enabled !== "true") throw new Error("bot_gateway_config_invalid");

  const entries = (environment.BOT_CREATION_CANARY_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase());
  if (
    entries.length === 0 ||
    entries.length > MAX_BOT_CREATION_CANARY_USERS ||
    entries.some((value) => !uuidSchema.safeParse(value).success) ||
    new Set(entries).size !== entries.length
  ) {
    throw new Error("bot_gateway_config_invalid");
  }

  const cohort = new Set(entries);
  return (actorId) => cohort.has(actorId.toLowerCase());
}
const botSummaryRowSchema = z
  .object({
    bot_id: uuidSchema,
    username: z.string().regex(/^[a-z][a-z0-9_]{4,31}$/),
    display_name: z.string().min(2).max(64),
    description: z.string().max(512),
    avatar_url: z.string().max(2_048).nullable(),
    state: botStateSchema,
    delete_after: timestampSchema.nullable(),
    owner_role: z.enum(["owner", "developer"]),
    active_token_prefix: tokenPrefixSchema.nullable(),
    token_created_at: timestampSchema.nullable(),
    token_last_used_at: timestampSchema.nullable(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strict();
const eligibilityRowSchema = z
  .object({
    email_verified: z.boolean(),
    phone_verified: z.boolean(),
    account_age_met: z.boolean(),
    not_banned: z.boolean(),
    under_limit: z.boolean(),
    active_bot_count: z.number().int().min(0).max(3),
    max_bots: z.literal(3),
    can_create: z.boolean(),
  })
  .strict();
const createInputSchema = z
  .object({
    username: z.string().regex(/^[a-z][a-z0-9_]{4,31}$/),
    display_name: z.string().trim().min(2).max(64),
    description: z.string().max(512).default(""),
  })
  .strict();
const createRowSchema = z
  .object({
    bot_id: uuidSchema,
    username: z.string().regex(/^[a-z][a-z0-9_]{4,31}$/),
    display_name: z.string().min(2).max(64),
    description: z.string().max(512),
    state: botStateSchema,
    token_id: uuidSchema,
    token_prefix: tokenPrefixSchema,
    created_at: timestampSchema,
  })
  .strict();
const rotateInputSchema = z
  .object({ expected_token_prefix: tokenPrefixSchema.nullable() })
  .strict();
const rotateRowSchema = z
  .object({
    token_id: uuidSchema,
    token_prefix: tokenPrefixSchema,
    created_at: timestampSchema,
  })
  .strict();
const profileInputSchema = z
  .object({
    display_name: z.string().trim().min(2).max(64),
    description: z.string().max(512),
  })
  .strict();
const commandsInputSchema = z
  .object({
    commands: z
      .array(
        z
          .object({
            command: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
            description: z.string().trim().min(1).max(256),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
const developerInputSchema = z
  .object({ username: z.string().regex(/^[A-Za-z0-9_.-]{2,64}$/) })
  .strict();
const privacyInputSchema = z
  .object({ request_full_visibility: z.boolean() })
  .strict();
const commandSchema = z
  .object({
    command: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
    description: z.string().min(1).max(256),
  })
  .strict();
const developerSchema = z
  .object({
    user_id: uuidSchema,
    display_name: z.string().min(1).max(128),
    username: z.string().min(1).max(64).nullable(),
    created_at: timestampSchema,
  })
  .strict();
const privacySchema = z
  .object({
    chat_id: uuidSchema,
    chat_name: z.string().min(1).max(256),
    privacy_mode: z.enum(["restricted", "full"]),
    full_visibility_requested_at: timestampSchema.nullable(),
    full_visibility_approved: z.boolean(),
  })
  .strict();
const diagnosticsFields = {
  delivery_mode: z.enum(["polling", "webhook"]).nullable(),
  pending_update_count: z.number().int().min(0).max(1_000_000),
  failure_count: z.number().int().min(0).max(20),
  last_error_code: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/)
    .nullable(),
  diagnostics_refreshed_at: timestampSchema,
} as const;
const detailRowSchema = botSummaryRowSchema
  .extend({
    commands: z.array(commandSchema).max(100),
    developers: z.array(developerSchema).max(100),
    privacy: z.array(privacySchema).max(1_000),
    webhook_configured: z.boolean(),
    webhook_url: z.string().url().max(2_048).nullable(),
    ...diagnosticsFields,
  })
  .strict();
const diagnosticsRowSchema = z
  .object({
    webhook_configured: z.boolean(),
    ...diagnosticsFields,
  })
  .strict();
const webhookInputSchema = z
  .object({
    url: z.string().url().max(2_048),
    secret: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/),
    drop_pending_updates: z.boolean().default(false),
  })
  .strict();
const webhookDeleteInputSchema = z
  .object({ drop_pending_updates: z.boolean().default(false) })
  .strict();
const adminBotRowSchema = z
  .object({
    bot_id: uuidSchema,
    username: z.string().regex(/^[a-z][a-z0-9_]{4,31}$/),
    display_name: z.string().min(2).max(64),
    state: botStateSchema,
    owner_count: z.number().int().min(1).max(1),
    developer_count: z.number().int().min(0).max(100),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strict();

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const MAX_RATE_LIMIT_BUCKETS = 10_000;
const defaultRateLimiters = new WeakMap<
  BotManagementDependencies,
  BotManagementRateLimiter
>();

function operationLimit(operation: string): {
  limit: number;
  windowMs: number;
} {
  if (operation === "POST /bots") return { limit: 5, windowMs: 60_000 };
  if (
    operation === "POST /bots/:botId/token/rotate" ||
    operation === "POST /bots/:botId/developers" ||
    operation === "DELETE /bots/:botId/developers/:developerId" ||
    operation === "POST /bots/:botId/deletion/request" ||
    operation === "POST /bots/:botId/deletion/cancel"
  ) {
    return { limit: 10, windowMs: 60_000 };
  }
  if (operation.startsWith("GET ")) return { limit: 120, windowMs: 60_000 };
  return { limit: 30, windowMs: 60_000 };
}

export function createBotManagementRateLimiter(
  now: () => number = Date.now,
): BotManagementRateLimiter {
  const buckets = new Map<string, RateLimitBucket>();
  let requestsSincePrune = 0;

  return {
    consume(actorId, operation) {
      const currentTime = now();
      requestsSincePrune += 1;
      if (requestsSincePrune >= 256) {
        requestsSincePrune = 0;
        for (const [key, bucket] of buckets) {
          if (bucket.resetAt <= currentTime) buckets.delete(key);
        }
      }

      const key = `${actorId}\u0000${operation}`;
      const existing = buckets.get(key);
      const { limit, windowMs } = operationLimit(operation);
      if (!existing || existing.resetAt <= currentTime) {
        if (!existing && buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
          const oldestKey = buckets.keys().next().value;
          if (typeof oldestKey === "string") buckets.delete(oldestKey);
        }
        buckets.set(key, { count: 1, resetAt: currentTime + windowMs });
        return null;
      }
      if (existing.count >= limit) {
        return Math.max(1, Math.ceil((existing.resetAt - currentTime) / 1_000));
      }
      existing.count += 1;
      return null;
    },
  };
}

function rateLimiterFor(
  input: BotManagementDependencies,
): BotManagementRateLimiter {
  if (input.rateLimiter) return input.rateLimiter;
  const existing = defaultRateLimiters.get(input);
  if (existing) return existing;
  const created = createBotManagementRateLimiter();
  defaultRateLimiters.set(input, created);
  return created;
}

function managementHeaders(): RequestHandler {
  return (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store, private");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Referrer-Policy", "no-referrer");
    next();
  };
}

function managementCors(allowedOrigins: readonly string[]): RequestHandler {
  const trusted = new Set(allowedOrigins);
  return (request, response, next) => {
    const origin = request.headers.origin;
    if (origin !== undefined) response.vary("Origin");
    if (origin !== undefined && !trusted.has(origin)) {
      const requestId =
        typeof request.id === "string" && request.id.length <= 128
          ? request.id
          : "unknown";
      const failure = toBotApiErrorResponse(
        new BotApiError("forbidden"),
        requestId,
      );
      response.status(failure.status).json(failure.body);
      return;
    }

    if (origin !== undefined) {
      response.setHeader("Access-Control-Allow-Origin", origin);
    }
    if (request.method !== "OPTIONS") {
      next();
      return;
    }

    const requestedMethod = request.headers["access-control-request-method"];
    const requestedHeaders = request.headers["access-control-request-headers"];
    const headerNames =
      typeof requestedHeaders === "string"
        ? requestedHeaders
            .split(",")
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean)
        : [];
    if (
      origin === undefined ||
      typeof requestedMethod !== "string" ||
      !ALLOWED_METHODS.has(requestedMethod) ||
      headerNames.some((header) => !ALLOWED_HEADERS.has(header))
    ) {
      response.sendStatus(403);
      return;
    }
    response.setHeader("Access-Control-Allow-Methods", CORS_METHODS);
    response.setHeader("Access-Control-Allow-Headers", CORS_HEADERS);
    response.status(204).end();
  };
}

function databaseError(
  error: unknown,
  options: { creation?: boolean; actorScoped?: boolean },
): BotApiError {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (options.creation && code === "42501") {
    return new BotApiError("bot_creation_not_allowed");
  }
  if (options.actorScoped && (code === "42501" || code === "P0002")) {
    return new BotApiError("not_found");
  }
  switch (code) {
    case "22023":
    case "22P02":
      return new BotApiError("validation_failed");
    case "42501":
      return new BotApiError("forbidden");
    case "23505":
    case "55000":
      return new BotApiError("conflict");
    case "P0002":
      return new BotApiError("not_found");
    default:
      return new BotApiError("internal_error");
  }
}

async function callRpc(
  client: BotManagementClient,
  name: string,
  args: Record<string, unknown>,
  options: { creation?: boolean; actorScoped?: boolean } = {},
): Promise<unknown> {
  let result: Awaited<ReturnType<BotRpcClient["rpc"]>>;
  try {
    result = await client.rpc(name, args);
  } catch {
    throw new BotApiError("internal_error");
  }
  if (result.error) throw databaseError(result.error, options);
  return result.data;
}

function oneRow<T>(value: unknown, schema: z.ZodType<T>): T {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new BotApiError("internal_error");
  }
  const parsed = schema.safeParse(value[0]);
  if (!parsed.success) throw new BotApiError("internal_error");
  return parsed.data;
}

function botSummary(row: z.infer<typeof botSummaryRowSchema>) {
  const token =
    row.active_token_prefix && row.token_created_at
      ? {
          prefix: row.active_token_prefix,
          created_at: row.token_created_at,
          last_used_at: row.token_last_used_at,
        }
      : null;
  return {
    id: row.bot_id,
    username: row.username,
    display_name: row.display_name,
    description: row.description,
    avatar_url: row.avatar_url,
    state: row.state,
    delete_after: row.delete_after,
    role: row.owner_role,
    token,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function diagnostics(row: z.infer<typeof diagnosticsRowSchema>) {
  return {
    delivery_mode: row.delivery_mode,
    webhook_configured: row.webhook_configured,
    pending_update_count: row.pending_update_count,
    failure_count: row.failure_count,
    last_error_code: row.last_error_code,
    refreshed_at: row.diagnostics_refreshed_at,
  };
}

type ManagementContext = {
  actorId: string;
  requestId: string;
};

function managementRoute(
  input: BotManagementDependencies,
  handler: (
    request: Parameters<RequestHandler>[0],
    response: Parameters<RequestHandler>[1],
    context: ManagementContext,
  ) => Promise<void>,
): RequestHandler {
  return async (request, response) => {
    const requestId =
      typeof request.id === "string" && request.id.length <= 128
        ? request.id
        : "unknown";
    try {
      const actorId = await authenticateManagementUser(
        exactAuthorizationHeader(request),
        input.client,
      );
      const routePath =
        typeof request.route?.path === "string" ? request.route.path : "unknown";
      const retryAfter = rateLimiterFor(input).consume(
        actorId,
        `${request.method} ${routePath}`,
      );
      if (retryAfter !== null) throw new BotApiError("rate_limited", retryAfter);
      await handler(request, response, { actorId, requestId });
    } catch (error) {
      const failure = toBotApiErrorResponse(error, requestId);
      if (failure.body.error.retry_after !== undefined) {
        response.setHeader(
          "Retry-After",
          failure.body.error.retry_after.toString(),
        );
      }
      response.status(failure.status).json(failure.body);
    }
  };
}

function botParams(request: Parameters<RequestHandler>[0]): { botId: string } {
  const parsed = uuidSchema.safeParse(request.params.botId);
  if (!parsed.success) throw new BotApiError("validation_failed");
  return { botId: parsed.data };
}

function mutationRoute(
  input: BotManagementDependencies,
  rpcName: string,
  args: (
    request: Parameters<RequestHandler>[0],
    context: ManagementContext,
  ) => Record<string, unknown>,
  options: { actorScoped?: boolean } = { actorScoped: true },
): RequestHandler {
  return managementRoute(input, async (request, response, context) => {
    const { botId } = botParams(request);
    await callRpc(
      input.client,
      rpcName,
      {
        p_actor_id: context.actorId,
        p_bot_id: botId,
        ...args(request, context),
        p_request_id: context.requestId,
      },
      options,
    );
    response.json(botSuccess({ success: true }));
  });
}

export function createBotManagementRouter(
  input: BotManagementDependencies,
): Router {
  const router = Router();
  router.use(managementHeaders());
  router.use(managementCors(input.allowedOrigins));
  router.use(json({ limit: "256kb", strict: true }));

  router.get(
    "/bots",
    managementRoute(input, async (_request, response, context) => {
      const [botRows, eligibilityRows] = await Promise.all([
        callRpc(input.client, "bot_list_owned_internal", {
          p_actor_id: context.actorId,
        }),
        callRpc(input.client, "bot_creation_eligibility_internal", {
          p_actor_id: context.actorId,
        }),
      ]);
      const parsedBots = z.array(botSummaryRowSchema).max(100).safeParse(botRows);
      if (!parsedBots.success) throw new BotApiError("internal_error");
      const eligibility = oneRow(eligibilityRows, eligibilityRowSchema);
      response.json(
        botSuccess({
          bots: parsedBots.data.map(botSummary),
          eligibility: {
            ...eligibility,
            can_create:
              eligibility.can_create && input.canCreateBot(context.actorId),
          },
        }),
      );
    }),
  );

  router.post(
    "/bots",
    managementRoute(input, async (request, response, context) => {
      if (!input.canCreateBot(context.actorId)) {
        throw new BotApiError("bot_creation_not_allowed");
      }
      const body = createInputSchema.parse(request.body);
      const token = createBotToken(input.randomBytes);
      const row = oneRow(
        await callRpc(
          input.client,
          "bot_create_internal",
          {
            p_actor_id: context.actorId,
            p_username: body.username,
            p_display_name: body.display_name,
            p_description: body.description,
            p_token_prefix: token.prefix,
            p_token_hash: hashBotToken(token.raw, input.tokenPepper),
            p_request_id: context.requestId,
          },
          { creation: true },
        ),
        createRowSchema,
      );
      response.status(201).json(
        botSuccess({
          bot: {
            id: row.bot_id,
            username: row.username,
            display_name: row.display_name,
            description: row.description,
            state: row.state,
            created_at: row.created_at,
          },
          token: token.raw,
        }),
      );
    }),
  );

  router.post(
    "/bots/:botId/token/rotate",
    managementRoute(input, async (request, response, context) => {
      const { botId } = botParams(request);
      const body = rotateInputSchema.parse(request.body);
      const token = createBotToken(input.randomBytes);
      const row = oneRow(
        await callRpc(
          input.client,
          "bot_rotate_token_internal",
          {
            p_actor_id: context.actorId,
            p_bot_id: botId,
            p_expected_token_prefix: body.expected_token_prefix,
            p_token_prefix: token.prefix,
            p_token_hash: hashBotToken(token.raw, input.tokenPepper),
            p_request_id: context.requestId,
          },
          { actorScoped: true },
        ),
        rotateRowSchema,
      );
      response.json(
        botSuccess({
          token: token.raw,
          token_prefix: row.token_prefix,
          created_at: row.created_at,
        }),
      );
    }),
  );

  router.patch(
    "/bots/:botId/profile",
    mutationRoute(input, "bot_update_profile_internal", (request) => {
      const body = profileInputSchema.parse(request.body);
      return {
        p_display_name: body.display_name,
        p_description: body.description,
      };
    }),
  );
  router.put(
    "/bots/:botId/commands",
    mutationRoute(
      input,
      "bot_management_commands_replace_internal",
      (request) => ({
        p_commands: commandsInputSchema.parse(request.body).commands,
      }),
    ),
  );
  router.post(
    "/bots/:botId/pause",
    mutationRoute(input, "bot_pause_internal", () => ({})),
  );
  router.post(
    "/bots/:botId/resume",
    mutationRoute(input, "bot_resume_internal", () => ({})),
  );
  router.post(
    "/bots/:botId/developers",
    mutationRoute(input, "bot_developer_add_internal", (request) => ({
      p_username: developerInputSchema.parse(request.body).username,
    })),
  );
  router.delete(
    "/bots/:botId/developers/:developerId",
    mutationRoute(input, "bot_developer_remove_internal", (request) => {
      const developerId = uuidSchema.parse(request.params.developerId);
      return { p_developer_id: developerId };
    }),
  );
  router.post(
    "/bots/:botId/token/revoke",
    mutationRoute(input, "bot_revoke_token_internal", () => ({})),
  );
  router.post(
    "/bots/:botId/deletion/request",
    mutationRoute(input, "bot_request_deletion_internal", () => ({})),
  );
  router.post(
    "/bots/:botId/deletion/cancel",
    mutationRoute(input, "bot_cancel_deletion_internal", () => ({})),
  );
  router.patch(
    "/bots/:botId/privacy/:chatId",
    mutationRoute(input, "bot_privacy_request_internal", (request) => {
      const chatId = uuidSchema.parse(request.params.chatId);
      const body = privacyInputSchema.parse(request.body);
      return {
        p_chat_id: chatId,
        p_request_full_visibility: body.request_full_visibility,
      };
    }),
  );

  router.get(
    "/bots/:botId",
    managementRoute(input, async (request, response, context) => {
      const { botId } = botParams(request);
      const row = oneRow(
        await callRpc(
          input.client,
          "bot_management_detail_internal",
          {
            p_actor_id: context.actorId,
            p_bot_id: botId,
          },
          { actorScoped: true },
        ),
        detailRowSchema,
      );
      response.json(
        botSuccess({
          bot: botSummary(row),
          commands: row.commands,
          developers: row.developers,
          privacy: row.privacy,
          webhook: {
            configured: row.webhook_configured,
            url: row.webhook_url,
          },
          diagnostics: {
            delivery_mode: row.delivery_mode,
            pending_update_count: row.pending_update_count,
            failure_count: row.failure_count,
            last_error_code: row.last_error_code,
            refreshed_at: row.diagnostics_refreshed_at,
          },
        }),
      );
    }),
  );

  router.get(
    "/bots/:botId/diagnostics",
    managementRoute(input, async (request, response, context) => {
      const { botId } = botParams(request);
      const row = oneRow(
        await callRpc(
          input.client,
          "bot_management_diagnostics_internal",
          {
            p_actor_id: context.actorId,
            p_bot_id: botId,
          },
          { actorScoped: true },
        ),
        diagnosticsRowSchema,
      );
      response.json(botSuccess(diagnostics(row)));
    }),
  );

  router.put(
    "/bots/:botId/webhook",
    managementRoute(input, async (request, response, context) => {
      const { botId } = botParams(request);
      const body = webhookInputSchema.parse(request.body);
      let target: ValidatedWebhookTarget;
      try {
        target = await (input.validateWebhookTarget ?? validateWebhookTarget)(
          body.url,
        );
      } catch {
        throw new BotApiError("validation_failed");
      }
      const sealed = encryptWebhookSecret(
        body.secret,
        input.webhookEncryptionKey,
      );
      await callRpc(
        input.client,
        "bot_management_webhook_set_internal",
        {
          p_actor_id: context.actorId,
          p_bot_id: botId,
          p_url: target.url.href,
          p_secret_ciphertext: sealed.ciphertext,
          p_secret_fingerprint: sealed.fingerprint,
          p_drop_pending_updates: body.drop_pending_updates,
          p_request_id: context.requestId,
        },
        { actorScoped: true },
      );
      response.json(botSuccess({ success: true }));
    }),
  );

  router.delete(
    "/bots/:botId/webhook",
    mutationRoute(
      input,
      "bot_management_webhook_delete_internal",
      (request) => ({
        p_drop_pending_updates: webhookDeleteInputSchema.parse(request.body)
          .drop_pending_updates,
      }),
    ),
  );

  router.get(
    "/admin/bots",
    managementRoute(input, async (_request, response, context) => {
      const value = await callRpc(input.client, "bot_admin_list_internal", {
        p_actor_id: context.actorId,
      });
      const parsed = z.array(adminBotRowSchema).max(200).safeParse(value);
      if (!parsed.success) throw new BotApiError("internal_error");
      response.json(
        botSuccess({
          bots: parsed.data.map((row) => ({
            id: row.bot_id,
            username: row.username,
            display_name: row.display_name,
            state: row.state,
            owner_count: row.owner_count,
            developer_count: row.developer_count,
            created_at: row.created_at,
            updated_at: row.updated_at,
          })),
        }),
      );
    }),
  );

  for (const [path, suspend] of [
    ["/admin/bots/:botId/suspend", true],
    ["/admin/bots/:botId/unsuspend", false],
  ] as const) {
    router.post(
      path,
      mutationRoute(input, "bot_suspend_internal", () => ({
        p_suspend: suspend,
      }), { actorScoped: false }),
    );
  }

  return router;
}
