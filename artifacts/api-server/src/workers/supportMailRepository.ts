import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SupportMailConfig } from "./supportMailRules";

export interface OutboundSupportMail {
  outboxId: string;
  ticketId: string;
  ticketMessageId: string;
  publicReference: string;
  recipientEmail: string;
  contactName: string;
  subject: string;
  body: string;
  attemptCount: number;
}

export interface InboundSupportMailRecord {
  messageIdHash: string;
  senderHash: string;
  recipientHash: string;
  providerReferenceHash: string | null;
  routeTokenHash: string | null;
  inReplyToHash: string | null;
  contactName: string;
  emailOriginal: string;
  emailNormalized: string;
  category: string;
  subject: string;
  body: string;
  quarantineCode: string | null;
}

export interface SupportMailRepository {
  registerRoute(ticketId: string, routeTokenHash: string): Promise<void>;
  ingestInbound(record: InboundSupportMailRecord): Promise<string>;
  claimOutbound(workerId: string): Promise<OutboundSupportMail[]>;
  markSent(
    outboxId: string,
    workerId: string,
    providerReferenceHash: string | null,
  ): Promise<void>;
  markRetry(
    outboxId: string,
    workerId: string,
    errorCode: string,
    retryable: boolean,
    retryAfterSeconds: number,
  ): Promise<void>;
  cleanupRetention(): Promise<number>;
}

function requireRpcData<T>(
  result: { data: T | null; error: unknown },
  code: string,
): T {
  if (result.error || result.data === null) {
    throw new Error(code);
  }
  return result.data;
}

function readString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || !field) {
    throw new Error("support_mail_repository_invalid_data");
  }
  return field;
}

function readInteger(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (!Number.isInteger(field)) {
    throw new Error("support_mail_repository_invalid_data");
  }
  return Number(field);
}

function projectOutbound(value: unknown): OutboundSupportMail {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("support_mail_repository_invalid_data");
  }
  const row = value as Record<string, unknown>;
  return {
    outboxId: readString(row, "outbox_id"),
    ticketId: readString(row, "ticket_id"),
    ticketMessageId: readString(row, "ticket_message_id"),
    publicReference: readString(row, "public_reference"),
    recipientEmail: readString(row, "recipient_email"),
    contactName: readString(row, "contact_name"),
    subject: readString(row, "subject"),
    body: readString(row, "body"),
    attemptCount: readInteger(row, "attempt_count"),
  };
}

export function createSupportMailRepository(
  config: Extract<SupportMailConfig, { enabled: true }>,
): SupportMailRepository {
  const client: SupabaseClient = createClient(
    config.supabase.url,
    config.supabase.serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );

  return {
    async registerRoute(ticketId, routeTokenHash) {
      requireRpcData(
        await client.rpc("support_email_route_register", {
          p_ticket_id: ticketId,
          p_route_token_hash: routeTokenHash,
        }),
        "support_mail_route_register_failed",
      );
    },

    async ingestInbound(record) {
      const data = requireRpcData<unknown>(
        await client.rpc("support_email_ingest_inbound", {
          p_message_id_hash: record.messageIdHash,
          p_sender_hash: record.senderHash,
          p_recipient_hash: record.recipientHash,
          p_provider_reference_hash: record.providerReferenceHash,
          p_route_token_hash: record.routeTokenHash,
          p_in_reply_to_hash: record.inReplyToHash,
          p_contact_name: record.contactName,
          p_email_original: record.emailOriginal,
          p_email_normalized: record.emailNormalized,
          p_category: record.category,
          p_subject: record.subject,
          p_body: record.body,
          p_quarantine_code: record.quarantineCode,
        }),
        "support_mail_ingest_failed",
      );
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("support_mail_repository_invalid_data");
      }
      return readString(data as Record<string, unknown>, "status");
    },

    async claimOutbound(workerId) {
      const data = requireRpcData<unknown[]>(
        await client.rpc("support_email_claim_outbound", {
          p_worker_id: workerId,
          p_limit: 1,
          p_lease_seconds: 300,
        }),
        "support_mail_claim_failed",
      );
      if (!Array.isArray(data)) {
        throw new Error("support_mail_repository_invalid_data");
      }
      return data.map(projectOutbound);
    },

    async markSent(outboxId, workerId, providerReferenceHash) {
      const marked = requireRpcData<boolean>(
        await client.rpc("support_email_mark_sent", {
          p_outbox_id: outboxId,
          p_worker_id: workerId,
          p_provider_reference_hash: providerReferenceHash,
        }),
        "support_mail_mark_sent_failed",
      );
      if (!marked) {
        throw new Error("support_mail_lease_lost");
      }
    },

    async markRetry(
      outboxId,
      workerId,
      errorCode,
      retryable,
      retryAfterSeconds,
    ) {
      requireRpcData(
        await client.rpc("support_email_mark_retry", {
          p_outbox_id: outboxId,
          p_worker_id: workerId,
          p_error_code: errorCode,
          p_retryable: retryable,
          p_retry_after_seconds: retryAfterSeconds,
        }),
        "support_mail_mark_retry_failed",
      );
    },

    async cleanupRetention() {
      return requireRpcData<number>(
        await client.rpc("support_email_retention_cleanup", {
          p_limit: 1000,
        }),
        "support_mail_retention_cleanup_failed",
      );
    },
  };
}
