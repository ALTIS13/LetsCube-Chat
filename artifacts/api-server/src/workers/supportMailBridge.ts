import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger";
import {
  createSupportMailRepository,
  type OutboundSupportMail,
  type SupportMailRepository,
} from "./supportMailRepository";
import {
  buildOutboundMessageId,
  buildSupportReplyAddress,
  hashMailValue,
  hashMessageIdentifier,
  hasTrustedSenderAuthentication,
  normalizeInboundMail,
  readSupportMailConfig,
  renderSupportReplyEmail,
  sanitizeSupportMailErrorCode,
  type SupportMailConfig,
} from "./supportMailRules";
import {
  createSupportMailTransport,
  type SupportMailTransport,
  type TransportInboundMail,
} from "./supportMailTransport";

export interface SupportMailBridgeState {
  enabled: boolean;
  ready: boolean;
  running: boolean;
  lastCycleAt: string | null;
  lastErrorCode: string | null;
}

export interface SupportMailBridgeController {
  state(): SupportMailBridgeState;
  stop(): Promise<void>;
}

type EnabledConfig = Extract<SupportMailConfig, { enabled: true }>;

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

function routeTokenFromAddress(address: string): string | null {
  const match = /^support\+([a-f0-9]{32})@/i.exec(address);
  return match?.[1]?.toLowerCase() ?? null;
}

function inboundCategory(recipientAddress: string): string {
  const localPart = recipientAddress.split("@", 1)[0]?.toLowerCase();
  if (localPart === "privacy") return "privacy";
  if (localPart === "postmaster") return "abuse";
  return "other";
}

function retryableDeliveryError(error: unknown): boolean {
  if (!error || typeof error !== "object") return true;
  const responseCode =
    "responseCode" in error && typeof error.responseCode === "number"
      ? error.responseCode
      : 0;
  if (responseCode >= 400 && responseCode < 500) return true;
  if (responseCode >= 500) return false;
  const code =
    "code" in error && typeof error.code === "string"
      ? error.code.toUpperCase()
      : "";
  if (["EAUTH", "EENVELOPE", "EMESSAGE"].includes(code)) return false;
  return true;
}

function retryDelaySeconds(attemptCount: number): number {
  return Math.min(3_600, Math.max(30, 30 * 2 ** Math.min(attemptCount, 7)));
}

function routeTokenHash(replyAddress: string, config: EnabledConfig): string {
  const token = routeTokenFromAddress(replyAddress);
  if (!token) throw new Error("support_mail_route_invalid");
  return hashMailValue(`route-token:${token}`, config.hmacSecret);
}

async function sendOutbound(
  item: OutboundSupportMail,
  workerId: string,
  config: EnabledConfig,
  repository: SupportMailRepository,
  transport: SupportMailTransport,
): Promise<boolean> {
  let providerReference: string;
  try {
    const replyTo = buildSupportReplyAddress(
      item.ticketId,
      config.mailDomain,
      config.hmacSecret,
    );
    await repository.registerRoute(
      item.ticketId,
      routeTokenHash(replyTo, config),
    );
    const messageId = buildOutboundMessageId(item.outboxId, config.mailDomain);
    const rendered = renderSupportReplyEmail({
      publicReference: item.publicReference,
      contactName: item.contactName,
      subject: item.subject,
      body: item.body,
    });
    providerReference = await transport.send({
      to: item.recipientEmail,
      from: config.from,
      replyTo,
      messageId,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  } catch (error) {
    const errorCode = sanitizeSupportMailErrorCode(error);
    await repository.markRetry(
      item.outboxId,
      workerId,
      errorCode,
      retryableDeliveryError(error),
      retryDelaySeconds(item.attemptCount),
    );
    return false;
  }

  const providerReferenceHash = hashMailValue(
    providerReference,
    config.hmacSecret,
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await repository.markSent(item.outboxId, workerId, providerReferenceHash);
      return true;
    } catch {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  }

  // SMTP already accepted the deterministic Message-ID. Do not immediately
  // enqueue another send when only the database acknowledgement is uncertain.
  logger.warn(
    { errorCode: "delivery_ack_unconfirmed" },
    "supportMailBridge delivery acknowledgement failed",
  );
  return false;
}

async function ingestInbound(
  message: TransportInboundMail,
  config: EnabledConfig,
  repository: SupportMailRepository,
): Promise<boolean> {
  const normalized = normalizeInboundMail(message);
  const fromAddress =
    normalized.kind === "accepted"
      ? normalized.value.fromAddress
      : (message.fromAddress?.trim().toLowerCase() ?? "");
  const recipientAddress =
    normalized.kind === "accepted"
      ? normalized.value.recipientAddress
      : (message.recipientAddress?.trim().toLowerCase() ?? config.from.address);
  const messageIdentifier = `imap:${message.providerReference}`;
  const routeToken = routeTokenFromAddress(recipientAddress);
  const normalizationQuarantine =
    message.quarantineCode ??
    (normalized.kind === "quarantine" ? normalized.code : null);
  const quarantineCode =
    normalizationQuarantine ??
    (hasTrustedSenderAuthentication(
      message.authenticationResults,
      config.trustedAuthServer,
      fromAddress,
    )
      ? null
      : "sender_auth_failed");

  await repository.ingestInbound({
    messageIdHash: hashMessageIdentifier(messageIdentifier),
    senderHash: hashMailValue(`email:${fromAddress}`, config.contactHmacSecret),
    recipientHash: hashMailValue(
      `email:${recipientAddress}`,
      config.contactHmacSecret,
    ),
    providerReferenceHash: hashMailValue(
      message.providerReference,
      config.hmacSecret,
    ),
    routeTokenHash: routeToken
      ? hashMailValue(`route-token:${routeToken}`, config.hmacSecret)
      : null,
    inReplyToHash: message.inReplyTo
      ? hashMessageIdentifier(message.inReplyTo)
      : null,
    contactName:
      normalized.kind === "accepted"
        ? normalized.value.fromName || "Пользователь"
        : message.fromName?.trim().slice(0, 120) || "Пользователь",
    emailOriginal: fromAddress,
    emailNormalized: fromAddress,
    category: inboundCategory(recipientAddress),
    subject:
      normalized.kind === "accepted"
        ? normalized.value.subject
        : message.subject?.trim().slice(0, 180) || "Обращение в поддержку",
    body: normalized.kind === "accepted" ? normalized.value.body : "",
    quarantineCode,
  });
  return true;
}

async function runCycle(
  workerId: string,
  config: EnabledConfig,
  repository: SupportMailRepository,
  transport: SupportMailTransport,
): Promise<{ sent: number; received: number }> {
  let sent = 0;
  const outbound = await repository.claimOutbound(workerId);
  for (const item of outbound) {
    if (await sendOutbound(item, workerId, config, repository, transport)) {
      sent += 1;
    }
  }
  const received = await transport.pollInbox((message) =>
    ingestInbound(message, config, repository),
  );
  return { sent, received };
}

export function startSupportMailBridge(
  environment: NodeJS.ProcessEnv = process.env,
): SupportMailBridgeController {
  const config = readSupportMailConfig(environment);
  if (!config.enabled) {
    return {
      state: () => ({
        enabled: false,
        ready: true,
        running: false,
        lastCycleAt: null,
        lastErrorCode: null,
      }),
      stop: async () => undefined,
    };
  }

  const workerId = randomUUID();
  const repository = createSupportMailRepository(config);
  const transport = createSupportMailTransport(config);
  const abortController = new AbortController();
  let loopPromise: Promise<void>;
  const current: SupportMailBridgeState = {
    enabled: true,
    ready: false,
    running: true,
    lastCycleAt: null,
    lastErrorCode: null,
  };
  let nextRetentionCleanupAt = 0;

  loopPromise = (async () => {
    while (!abortController.signal.aborted) {
      try {
        if (Date.now() >= nextRetentionCleanupAt) {
          const deleted = await repository.cleanupRetention();
          nextRetentionCleanupAt = Date.now() + 24 * 60 * 60 * 1000;
          if (deleted > 0) {
            logger.info(
              { deleted },
              "supportMailBridge retention cleanup completed",
            );
          }
        }
        const counts = await runCycle(workerId, config, repository, transport);
        current.ready = true;
        current.lastCycleAt = new Date().toISOString();
        current.lastErrorCode = null;
        if (counts.sent > 0 || counts.received > 0) {
          logger.info(counts, "supportMailBridge processed mail");
        }
      } catch (error) {
        current.ready = false;
        current.lastErrorCode = sanitizeSupportMailErrorCode(error);
        logger.warn(
          { errorCode: current.lastErrorCode },
          "supportMailBridge cycle failed",
        );
      }
      await sleep(config.pollMs, abortController.signal);
    }
    current.running = false;
  })();

  return {
    state: () => ({ ...current }),
    async stop() {
      abortController.abort();
      await loopPromise;
      await transport.close();
    },
  };
}
