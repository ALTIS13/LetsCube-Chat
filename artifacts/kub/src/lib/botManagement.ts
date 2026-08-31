import { z } from "zod";

import { createClient } from "@/lib/supabase/client";
import { resolveBotManagementOrigin } from "@/lib/botManagementOrigin";

const env = import.meta.env as Record<string, string | undefined>;
const botStateSchema = z.enum(["active", "paused", "suspended", "pending_delete", "deleted"]);
const roleSchema = z.enum(["owner", "developer"]);
const timestampSchema = z.string().datetime({ offset: true });
const tokenPrefixSchema = z.string().regex(/^lc_bot_[0-9a-f]{10}$/);
const rawTokenSchema = z.string().regex(/^lc_bot_[0-9a-f]{10}\.[A-Za-z0-9_-]{43}$/);
const tokenMetadataSchema = z.object({
  prefix: tokenPrefixSchema,
  created_at: timestampSchema,
  last_used_at: timestampSchema.nullable(),
}).strict();

export const botSummarySchema = z.object({
  id: z.string().uuid(),
  username: z.string().regex(/^[a-z][a-z0-9_]{4,31}$/),
  display_name: z.string().min(2).max(64),
  description: z.string().max(512),
  avatar_url: z.string().url().max(2_048).nullable(),
  state: botStateSchema,
  delete_after: timestampSchema.nullable(),
  role: roleSchema,
  token: tokenMetadataSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).strict();

const eligibilitySchema = z.object({
  email_verified: z.boolean(),
  phone_verified: z.boolean(),
  account_age_met: z.boolean(),
  not_banned: z.boolean(),
  under_limit: z.boolean(),
  active_bot_count: z.number().int().min(0).max(3),
  max_bots: z.literal(3),
  can_create: z.boolean(),
}).strict();

const commandSchema = z.object({
  command: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  description: z.string().min(1).max(256),
}).strict();
const developerSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string().min(1).max(128),
  username: z.string().min(1).max(64).nullable(),
  created_at: timestampSchema,
}).strict();
const privacySchema = z.object({
  chat_id: z.string().uuid(),
  chat_name: z.string().min(1).max(256),
  privacy_mode: z.enum(["restricted", "full"]),
  full_visibility_requested_at: timestampSchema.nullable(),
  full_visibility_approved: z.boolean(),
}).strict();
const diagnosticsSchema = z.object({
  delivery_mode: z.enum(["polling", "webhook"]).nullable(),
  pending_update_count: z.number().int().min(0).max(1_000_000),
  failure_count: z.number().int().min(0).max(20),
  last_error_code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).nullable(),
  refreshed_at: timestampSchema,
}).strict();
const listSchema = z.object({
  bots: z.array(botSummarySchema).max(100),
  eligibility: eligibilitySchema,
}).strict();
const detailSchema = z.object({
  bot: botSummarySchema,
  commands: z.array(commandSchema).max(100),
  developers: z.array(developerSchema).max(100),
  privacy: z.array(privacySchema).max(1_000),
  webhook: z.object({ configured: z.boolean(), url: z.string().url().max(2_048).nullable() }).strict(),
  diagnostics: diagnosticsSchema,
}).strict();
const successSchema = z.object({ success: z.literal(true) }).strict();
const createSchema = z.object({
  bot: z.object({
    id: z.string().uuid(),
    username: z.string(),
    display_name: z.string(),
    description: z.string(),
    state: botStateSchema,
    created_at: timestampSchema,
  }).strict(),
  token: rawTokenSchema,
}).strict();
const rotateSchema = z.object({
  token: rawTokenSchema,
  token_prefix: tokenPrefixSchema,
  created_at: timestampSchema,
}).strict();

export type BotSummary = z.infer<typeof botSummarySchema>;
export type BotEligibility = z.infer<typeof eligibilitySchema>;
export type BotDetail = z.infer<typeof detailSchema>;
export type BotCommand = z.infer<typeof commandSchema>;

type SafeErrorCode =
  | "session_expired"
  | "forbidden"
  | "bot_creation_not_allowed"
  | "conflict"
  | "validation_failed"
  | "not_found"
  | "rate_limited"
  | "network_error"
  | "uncertain_result";

const ERROR_MESSAGES: Record<SafeErrorCode, string> = {
  session_expired: "Сессия истекла. Войдите снова.",
  forbidden: "Недостаточно прав для этого действия.",
  bot_creation_not_allowed: "Сейчас создать бота нельзя. Проверьте требования к аккаунту.",
  conflict: "Состояние бота изменилось. Обновите данные и повторите действие.",
  validation_failed: "Проверьте заполненные поля.",
  not_found: "Бот не найден или больше недоступен.",
  rate_limited: "Слишком много запросов. Повторите позже.",
  network_error: "Не удалось связаться с сервером. Попробуйте снова.",
  uncertain_result: "Результат запроса неизвестен. Обновите данные перед следующим действием.",
};

export class BotManagementError extends Error {
  constructor(readonly code: SafeErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "BotManagementError";
  }
}

function managementBaseUrl() {
  const value = env.VITE_BOT_MANAGEMENT_URL ?? "https://api.letscube.ru";
  try {
    return resolveBotManagementOrigin(value);
  } catch {
    throw new BotManagementError("network_error");
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
  options: { uncertainOnAmbiguousFailure?: boolean } = {},
): Promise<T> {
  const { data, error } = await createClient().auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) throw new BotManagementError("session_expired");

  let response: Response;
  try {
    response = await fetch(`${managementBaseUrl()}/bot/manage/v1${path}`, {
      ...init,
      cache: "no-store",
      credentials: "omit",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  } catch {
    throw new BotManagementError(options.uncertainOnAmbiguousFailure ? "uncertain_result" : "network_error");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new BotManagementError(
      options.uncertainOnAmbiguousFailure && (response.ok || response.status >= 500)
        ? "uncertain_result"
        : "network_error",
    );
  }
  if (!response.ok) {
    const parsed = z.object({
      ok: z.literal(false),
      error: z.object({ code: z.string().max(64) }).passthrough(),
    }).safeParse(body);
    const code = parsed.success ? parsed.data.error.code : "network_error";
    if (
      options.uncertainOnAmbiguousFailure &&
      (response.status >= 500 || code === "internal_error")
    ) {
      throw new BotManagementError("uncertain_result");
    }
    if (code === "unauthorized") throw new BotManagementError("session_expired");
    if (code in ERROR_MESSAGES) throw new BotManagementError(code as SafeErrorCode);
    throw new BotManagementError("network_error");
  }
  const envelope = z.object({ ok: z.literal(true), result: z.unknown() }).strict().safeParse(body);
  if (!envelope.success) {
    throw new BotManagementError(options.uncertainOnAmbiguousFailure ? "uncertain_result" : "network_error");
  }
  const parsed = schema.safeParse(envelope.data.result);
  if (!parsed.success) {
    throw new BotManagementError(options.uncertainOnAmbiguousFailure ? "uncertain_result" : "network_error");
  }
  return parsed.data;
}

function json(method: string, body?: unknown): RequestInit {
  return { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}

export const botManagement = {
  list: () => request("/bots", listSchema),
  detail: (botId: string) => request(`/bots/${botId}`, detailSchema),
  diagnostics: (botId: string) => request(`/bots/${botId}/diagnostics`, diagnosticsSchema),
  createOnce: (input: { username: string; display_name: string; description: string }) =>
    request("/bots", createSchema, json("POST", input), { uncertainOnAmbiguousFailure: true }),
  rotateOnce: (botId: string, expectedTokenPrefix: string | null) =>
    request(`/bots/${botId}/token/rotate`, rotateSchema, json("POST", { expected_token_prefix: expectedTokenPrefix }), { uncertainOnAmbiguousFailure: true }),
  updateProfile: (botId: string, input: { display_name: string; description: string }) =>
    request(`/bots/${botId}/profile`, successSchema, json("PATCH", input)),
  updateCommands: (botId: string, commands: BotCommand[]) =>
    request(`/bots/${botId}/commands`, successSchema, json("PUT", { commands })),
  pause: (botId: string) => request(`/bots/${botId}/pause`, successSchema, json("POST")),
  resume: (botId: string) => request(`/bots/${botId}/resume`, successSchema, json("POST")),
  addDeveloper: (botId: string, username: string) =>
    request(`/bots/${botId}/developers`, successSchema, json("POST", { username })),
  removeDeveloper: (botId: string, developerId: string) =>
    request(`/bots/${botId}/developers/${developerId}`, successSchema, json("DELETE")),
  revokeToken: (botId: string) => request(`/bots/${botId}/token/revoke`, successSchema, json("POST")),
  requestDeletion: (botId: string) => request(`/bots/${botId}/deletion/request`, successSchema, json("POST")),
  cancelDeletion: (botId: string) => request(`/bots/${botId}/deletion/cancel`, successSchema, json("POST")),
  setPrivacyRequest: (botId: string, chatId: string, requestFullVisibility: boolean) =>
    request(`/bots/${botId}/privacy/${chatId}`, successSchema, json("PATCH", { request_full_visibility: requestFullVisibility })),
  setWebhook: (botId: string, input: { url: string; secret: string; drop_pending_updates: boolean }) =>
    request(`/bots/${botId}/webhook`, successSchema, json("PUT", input)),
  deleteWebhook: (botId: string, dropPendingUpdates: boolean) =>
    request(`/bots/${botId}/webhook`, successSchema, json("DELETE", { drop_pending_updates: dropPendingUpdates })),
};
