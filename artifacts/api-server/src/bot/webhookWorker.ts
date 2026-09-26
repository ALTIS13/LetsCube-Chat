import { randomUUID } from "node:crypto";

import type { BotRpcClient, BotRpcResult } from "#bot/repository";
import {
  decryptWebhookSecret,
  deliverWebhook,
  type WebhookDeliveryResult,
} from "#bot/webhookSecurity";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;

export type WebhookClaim = {
  attemptId: number;
  botId: string;
  updateId: number;
  attemptCount: number;
  webhookEpoch: number;
};

export type PreparedWebhookClaim = {
  targetUrl: string;
  secretCiphertext: string;
  payload: Record<string, unknown>;
};

type ViewerDeliveryCheck = "allowed" | "revoked" | "stale";

export interface WebhookWorkerRepository {
  claim(input: { limit: number; claimToken: string }): Promise<WebhookClaim[]>;
  prepare(input: {
    attemptId: number;
    claimToken: string;
    webhookEpoch: number;
  }): Promise<PreparedWebhookClaim | null>;
  recheckViewer(input: { attemptId: number; claimToken: string }): Promise<ViewerDeliveryCheck>;
  finish(input: {
    attemptId: number;
    claimToken: string;
    status: "delivered" | "retry" | "dead_letter";
    errorCode: string | null;
    httpStatus: number | null;
  }): Promise<boolean>;
  cleanup(input: { now: string; limit: number }): Promise<unknown>;
  cleanupViewer(input: { now: string; limit: number }): Promise<unknown>;
}

function safeInteger(value: unknown, minimum: number, maximum: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d{1,16}$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error("webhook_worker_rpc_invalid");
  }
  return parsed;
}

async function rpc(
  client: BotRpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  let response: BotRpcResult;
  try {
    response = await client.rpc(name, args);
  } catch {
    throw new Error("webhook_worker_rpc_failed");
  }
  if (response.error) throw new Error("webhook_worker_rpc_failed");
  return response.data;
}

export function createWebhookWorkerRepository(
  client: BotRpcClient,
): WebhookWorkerRepository {
  return {
    async claim(input) {
      const value = await rpc(client, "bot_delivery_claim_internal", {
        p_limit: input.limit,
        p_claim_token: input.claimToken,
      });
      if (!Array.isArray(value) || value.length > input.limit) {
        throw new Error("webhook_worker_rpc_invalid");
      }
      return value.map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          throw new Error("webhook_worker_rpc_invalid");
        }
        const row = entry as Record<string, unknown>;
        if (typeof row.bot_id !== "string" || !UUID_RE.test(row.bot_id)) {
          throw new Error("webhook_worker_rpc_invalid");
        }
        return {
          attemptId: safeInteger(row.attempt_id, 1, Number.MAX_SAFE_INTEGER),
          botId: row.bot_id,
          updateId: safeInteger(row.update_id, 1, Number.MAX_SAFE_INTEGER),
          attemptCount: safeInteger(row.attempt_count, 1, 12),
          webhookEpoch: safeInteger(
            row.webhook_epoch,
            1,
            Number.MAX_SAFE_INTEGER,
          ),
        };
      });
    },
    async prepare(input) {
      const value = await rpc(client, "bot_delivery_prepare_internal", {
        p_attempt_id: input.attemptId,
        p_claim_token: input.claimToken,
        p_webhook_epoch: input.webhookEpoch,
      });
      if (value === null) return null;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("webhook_worker_rpc_invalid");
      }
      const row = value as Record<string, unknown>;
      if (
        typeof row.target_url !== "string" ||
        Buffer.byteLength(row.target_url, "utf8") < 10 ||
        Buffer.byteLength(row.target_url, "utf8") > 2_048 ||
        typeof row.secret_ciphertext !== "string" ||
        Buffer.byteLength(row.secret_ciphertext, "utf8") < 55 ||
        Buffer.byteLength(row.secret_ciphertext, "utf8") > 4_103 ||
        !/^enc:v1:[A-Za-z0-9_-]+$/.test(row.secret_ciphertext) ||
        !row.payload ||
        typeof row.payload !== "object" ||
        Array.isArray(row.payload) ||
        Buffer.byteLength(JSON.stringify(row.payload), "utf8") > 65_536
      ) {
        throw new Error("webhook_worker_rpc_invalid");
      }
      return {
        targetUrl: row.target_url,
        secretCiphertext: row.secret_ciphertext,
        payload: row.payload as Record<string, unknown>,
      };
    },
    async recheckViewer(input) {
      const value = await rpc(client, "bot_viewer_delivery_recheck_internal", {
        p_attempt_id: input.attemptId,
        p_claim_token: input.claimToken,
      });
      if (value !== "allowed" && value !== "revoked" && value !== "stale") {
        throw new Error("webhook_worker_rpc_invalid");
      }
      return value;
    },
    async finish(input) {
      const value = await rpc(client, "bot_delivery_finish_internal", {
        p_attempt_id: input.attemptId,
        p_claim_token: input.claimToken,
        p_status: input.status,
        p_error_code: input.errorCode,
        p_http_status: input.httpStatus,
      });
      return value === true;
    },
    async cleanup(input) {
      return rpc(client, "bot_delivery_cleanup_internal", {
        p_now: input.now,
        p_limit: input.limit,
      });
    },
    async cleanupViewer(input) {
      return rpc(client, "bot_viewer_interface_cleanup_internal", {
        p_now: input.now,
        p_limit: input.limit,
      });
    },
  };
}

export type WebhookBatchResult = {
  claimed: number;
  delivered: number;
  retried: number;
  deadLettered: number;
};

async function finishSafely(
  repository: WebhookWorkerRepository,
  input: Parameters<WebhookWorkerRepository["finish"]>[0],
): Promise<boolean> {
  try {
    return await repository.finish(input);
  } catch {
    return false;
  }
}

function hasViewerCallback(payload: Record<string, unknown>): boolean {
  const callback = payload.callback_query;
  return callback !== null && typeof callback === "object" && !Array.isArray(callback)
    && Object.prototype.hasOwnProperty.call(callback, "viewer_interface_id");
}

export async function runWebhookDeliveryBatch(input: {
  repository: WebhookWorkerRepository;
  encryptionKey: Uint8Array;
  claimToken: string;
  batchSize: number;
  decryptSecret?: (ciphertext: string, key: Uint8Array) => string;
  deliver?: (input: {
    url: string;
    payload: Record<string, unknown>;
    secret: string;
    beforeTransport?: () => Promise<WebhookDeliveryResult | null>;
  }) => Promise<WebhookDeliveryResult>;
}): Promise<WebhookBatchResult> {
  const result: WebhookBatchResult = {
    claimed: 0,
    delivered: 0,
    retried: 0,
    deadLettered: 0,
  };
  const claims = await input.repository.claim({
    limit: input.batchSize,
    claimToken: input.claimToken,
  });
  result.claimed = claims.length;

  for (const claim of claims) {
    let prepared: PreparedWebhookClaim | null;
    try {
      prepared = await input.repository.prepare({
        attemptId: claim.attemptId,
        claimToken: input.claimToken,
        webhookEpoch: claim.webhookEpoch,
      });
    } catch {
      continue;
    }
    if (!prepared) continue;

    let secret: string;
    try {
      secret = (input.decryptSecret ?? decryptWebhookSecret)(
        prepared.secretCiphertext,
        input.encryptionKey,
      );
    } catch {
      const finished = await finishSafely(input.repository, {
        attemptId: claim.attemptId,
        claimToken: input.claimToken,
        status: "dead_letter",
        errorCode: "secret_decrypt_failed",
        httpStatus: null,
      });
      if (finished) result.deadLettered += 1;
      continue;
    }

    const beforeTransport = hasViewerCallback(prepared.payload)
      ? async (): Promise<WebhookDeliveryResult | null> => {
          let decision: ViewerDeliveryCheck;
          try {
            decision = await input.repository.recheckViewer({
              attemptId: claim.attemptId,
              claimToken: input.claimToken,
            });
          } catch {
            return { kind: "retry", errorCode: "viewer_recheck_unavailable", httpStatus: null };
          }
          if (decision === "allowed") return null;
          return decision === "revoked"
            ? { kind: "dead_letter", errorCode: "privacy_revoked", httpStatus: null }
            : { kind: "retry", errorCode: "viewer_claim_stale", httpStatus: null };
        }
      : undefined;
    const earlyDecision = beforeTransport ? await beforeTransport() : null;
    if (earlyDecision) {
      const finished = await finishSafely(input.repository, {
        attemptId: claim.attemptId,
        claimToken: input.claimToken,
        status: earlyDecision.kind,
        errorCode: earlyDecision.errorCode,
        httpStatus: earlyDecision.httpStatus,
      });
      if (finished) {
        if (earlyDecision.kind === "dead_letter") result.deadLettered += 1;
        else result.retried += 1;
      }
      continue;
    }

    let delivery: WebhookDeliveryResult;
    try {
      delivery = await (input.deliver ?? deliverWebhook)({
        url: prepared.targetUrl,
        payload: { ...prepared.payload, update_id: claim.updateId },
        secret,
        beforeTransport,
      });
    } catch {
      delivery = {
        kind: "retry",
        errorCode: "delivery_failed",
        httpStatus: null,
      };
    }

    const errorCode =
      delivery.errorCode === null || ERROR_CODE_RE.test(delivery.errorCode)
        ? delivery.errorCode
        : "delivery_error_invalid";
    const finished = await finishSafely(input.repository, {
      attemptId: claim.attemptId,
      claimToken: input.claimToken,
      status: delivery.kind,
      errorCode,
      httpStatus: delivery.httpStatus,
    });
    if (!finished) continue;
    if (delivery.kind === "delivered") result.delivered += 1;
    if (delivery.kind === "retry") result.retried += 1;
    if (delivery.kind === "dead_letter") result.deadLettered += 1;
  }
  return result;
}

export function createWebhookWorkerRuntime(input: {
  repository: WebhookWorkerRepository;
  encryptionKey: Uint8Array;
  intervalMs?: number;
  cleanupIntervalMs?: number;
  batchSize?: number;
  now?: () => Date;
}): { start(): void; stop(): void } {
  const intervalMs = input.intervalMs ?? 1_000;
  const cleanupIntervalMs = input.cleanupIntervalMs ?? 60 * 60 * 1_000;
  const batchSize = input.batchSize ?? 25;
  const now = input.now ?? (() => new Date());
  let stopped = true;
  let running = false;
  let timer: NodeJS.Timeout | undefined;
  let lastCleanupAt = 0;
  let viewerCatchUpPending = false;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), intervalMs);
    timer.unref();
  };
  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      const current = now();
      const cleanupDue = current.getTime() - lastCleanupAt >= cleanupIntervalMs;
      if (cleanupDue) {
        try {
          await input.repository.cleanup({
            now: current.toISOString(),
            limit: 1_000,
          });
        } catch {
          // Retention failure must not starve due webhook delivery.
        }
        lastCleanupAt = current.getTime();
      }
      if (cleanupDue || viewerCatchUpPending) {
        viewerCatchUpPending = false;
        try {
          const result = await input.repository.cleanupViewer({
            now: current.toISOString(),
            limit: 1_000,
          });
          if (result && typeof result === "object" && !Array.isArray(result)) {
            const counts = result as Record<string, unknown>;
            const grants = counts.grants_deleted;
            const panels = counts.panels_deleted;
            if (
              typeof grants === "number" &&
              Number.isInteger(grants) &&
              grants >= 0 &&
              grants <= 1_000 &&
              typeof panels === "number" &&
              Number.isInteger(panels) &&
              panels >= 0 &&
              panels <= 1_000
            ) {
              viewerCatchUpPending = grants === 1_000 || panels === 1_000;
            }
          }
        } catch {
          // Panel expiry is checked on reads; cleanup only reclaims storage.
        }
      }
      await runWebhookDeliveryBatch({
        repository: input.repository,
        encryptionKey: input.encryptionKey,
        claimToken: randomUUID(),
        batchSize,
      });
    } catch {
      // Claims recover through their bounded database timeout.
    } finally {
      running = false;
      schedule();
    }
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      void tick();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
