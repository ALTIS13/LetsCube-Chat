import { randomUUID } from "node:crypto";

import { BotApiError } from "#bot/errors";
import type {
  BotMethodFingerprint,
  BotMethodHandlers,
} from "#bot/methodRouter";
import type {
  BotOperationResult,
  BotRpcClient,
  BotRpcResult,
} from "#bot/repository";
import {
  encryptWebhookSecret,
  type ValidatedWebhookTarget,
} from "#bot/webhookSecurity";

const UPDATE_TYPES = [
  "message",
  "edited_message",
  "callback_query",
  "membership",
] as const;

type UpdateType = (typeof UPDATE_TYPES)[number];

export type PolledBotUpdate = {
  update_id: number;
  payload: Record<string, unknown>;
};

export type BotWebhookInfo = {
  configured: boolean;
  pending_update_count: number;
  failure_count: number;
  last_error_code: string | null;
};

export interface BotDeliveryRepository {
  pollUpdates(input: {
    botId: string;
    offset: number;
    limit: number;
    allowedUpdates: readonly UpdateType[];
    leaseToken: string;
  }): Promise<PolledBotUpdate[]>;
  releasePollingLease(input: {
    botId: string;
    leaseToken: string;
  }): Promise<void>;
  setWebhook(input: {
    botId: string;
    url: string;
    secretCiphertext: string;
    secretFingerprint: string;
    dropPendingUpdates: boolean;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<BotOperationResult<boolean>>;
  deleteWebhook(input: {
    botId: string;
    dropPendingUpdates: boolean;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<BotOperationResult<boolean>>;
  getWebhookInfo(botId: string): Promise<BotWebhookInfo>;
}

function internalError(): BotApiError {
  return new BotApiError("internal_error");
}

function rpcError(error: unknown): BotApiError {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  if (code === "22023" || code === "22P02") {
    return new BotApiError("validation_failed");
  }
  if (code === "42501") return new BotApiError("forbidden");
  if (code === "P0002") return new BotApiError("not_found");
  if (code === "23505" || code === "55000") {
    return new BotApiError("conflict");
  }
  return internalError();
}

async function callRpc(
  client: BotRpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  let response: BotRpcResult;
  try {
    response = await client.rpc(name, args);
  } catch {
    throw internalError();
  }
  if (response.error) throw rpcError(response.error);
  return response.data;
}

function safeUpdateId(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d{1,16}$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw internalError();
  return parsed;
}

function projectUpdates(value: unknown): PolledBotUpdate[] {
  if (!Array.isArray(value) || value.length > 100) throw internalError();
  let prior = 0;
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw internalError();
    }
    const row = entry as Record<string, unknown>;
    const updateId = safeUpdateId(row.update_id);
    const payload = row.payload;
    if (
      updateId <= prior ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Buffer.byteLength(JSON.stringify(payload), "utf8") > 65_536
    ) {
      throw internalError();
    }
    prior = updateId;
    return { update_id: updateId, payload: payload as Record<string, unknown> };
  });
}

function operationBoolean(value: unknown): BotOperationResult<boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw internalError();
  }
  const row = value as Record<string, unknown>;
  if (typeof row.result !== "boolean" || typeof row.duplicate !== "boolean") {
    throw internalError();
  }
  return { result: row.result, duplicate: row.duplicate };
}

function webhookInfo(value: unknown): BotWebhookInfo {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw internalError();
  }
  const row = value as Record<string, unknown>;
  const pending = row.pending_update_count;
  const failures = row.failure_count;
  const lastError = row.last_error_code;
  if (
    typeof row.configured !== "boolean" ||
    !Number.isSafeInteger(pending) ||
    Number(pending) < 0 ||
    Number(pending) > 1_000_000 ||
    !Number.isSafeInteger(failures) ||
    Number(failures) < 0 ||
    Number(failures) > 20 ||
    (lastError !== null &&
      (typeof lastError !== "string" ||
        !/^[a-z][a-z0-9_]{0,63}$/.test(lastError)))
  ) {
    throw internalError();
  }
  return {
    configured: row.configured,
    pending_update_count: Number(pending),
    failure_count: Number(failures),
    last_error_code: lastError as string | null,
  };
}

export function createBotDeliveryRepository(
  client: BotRpcClient,
): BotDeliveryRepository {
  return {
    async pollUpdates(input) {
      return projectUpdates(
        await callRpc(client, "bot_updates_poll_internal", {
          p_bot_id: input.botId,
          p_offset: input.offset,
          p_limit: input.limit,
          p_allowed_updates: input.allowedUpdates,
          p_timeout_marker: input.leaseToken,
        }),
      );
    },
    async releasePollingLease(input) {
      await callRpc(client, "bot_updates_poll_release_internal", {
        p_bot_id: input.botId,
        p_timeout_marker: input.leaseToken,
      });
    },
    async setWebhook(input) {
      return operationBoolean(
        await callRpc(client, "bot_webhook_set_internal", {
          p_bot_id: input.botId,
          p_url: input.url,
          p_secret_ciphertext: input.secretCiphertext,
          p_secret_fingerprint: input.secretFingerprint,
          p_drop_pending_updates: input.dropPendingUpdates,
          p_idempotency_key: input.idempotencyKey,
          p_request_fingerprint: input.requestFingerprint,
        }),
      );
    },
    async deleteWebhook(input) {
      return operationBoolean(
        await callRpc(client, "bot_webhook_delete_internal", {
          p_bot_id: input.botId,
          p_drop_pending_updates: input.dropPendingUpdates,
          p_idempotency_key: input.idempotencyKey,
          p_request_fingerprint: input.requestFingerprint,
        }),
      );
    },
    async getWebhookInfo(botId) {
      return webhookInfo(
        await callRpc(client, "bot_webhook_info_internal", {
          p_bot_id: botId,
        }),
      );
    },
  };
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new BotApiError("conflict"));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new BotApiError("conflict"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    timer.unref();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createUpdateDeliveryHandlers(input: {
  repository: BotDeliveryRepository;
  fingerprint: BotMethodFingerprint;
  encryptionKey: Uint8Array;
  validateTarget: (url: string) => Promise<ValidatedWebhookTarget>;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  randomId?: () => string;
}): BotMethodHandlers {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;
  const randomId = input.randomId ?? randomUUID;

  return {
    async getUpdates(context, methodInput) {
      const offset = methodInput.offset ?? 0;
      const limit = methodInput.limit ?? 100;
      const timeoutMs = (methodInput.timeout ?? 0) * 1_000;
      const allowedUpdates = methodInput.allowed_updates ?? [...UPDATE_TYPES];
      const leaseToken = randomId();
      const deadline = now() + timeoutMs;
      try {
        for (;;) {
          const updates = await input.repository.pollUpdates({
            botId: context.bot.botId,
            offset,
            limit,
            allowedUpdates,
            leaseToken,
          });
          if (updates.length > 0) {
            return updates.map((update) => ({
              ...update.payload,
              update_id: update.update_id,
            }));
          }
          const remaining = deadline - now();
          if (remaining <= 0) return [];
          await sleep(Math.min(250, remaining), context.signal);
        }
      } finally {
        try {
          await input.repository.releasePollingLease({
            botId: context.bot.botId,
            leaseToken,
          });
        } catch {
          // The short database lease expires even if best-effort release fails.
        }
      }
    },
    async setWebhook(context, methodInput) {
      let validated: ValidatedWebhookTarget;
      try {
        validated = await input.validateTarget(methodInput.url);
      } catch {
        throw new BotApiError("validation_failed");
      }
      const encrypted = encryptWebhookSecret(
        methodInput.secret_token,
        input.encryptionKey,
      );
      const persisted = await input.repository.setWebhook({
        botId: context.bot.botId,
        url: validated.url.href,
        secretCiphertext: encrypted.ciphertext,
        secretFingerprint: encrypted.fingerprint,
        dropPendingUpdates: methodInput.drop_pending_updates ?? false,
        idempotencyKey: methodInput.idempotency_key,
        requestFingerprint: input.fingerprint("setWebhook", methodInput),
      });
      return persisted.result;
    },
    async deleteWebhook(context, methodInput) {
      const persisted = await input.repository.deleteWebhook({
        botId: context.bot.botId,
        dropPendingUpdates: methodInput.drop_pending_updates ?? false,
        idempotencyKey: methodInput.idempotency_key,
        requestFingerprint: input.fingerprint("deleteWebhook", methodInput),
      });
      return persisted.result;
    },
    async getWebhookInfo(context) {
      return input.repository.getWebhookInfo(context.bot.botId);
    },
  };
}
