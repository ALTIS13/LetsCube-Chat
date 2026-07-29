import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject, type HeaderValue } from "mailparser";
import nodemailer, { type Transporter } from "nodemailer";
import type { SupportMailConfig } from "./supportMailRules";

const MAX_INBOUND_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGES_PER_POLL = 25;

export interface TransportInboundMail {
  providerReference: string;
  messageId: string | null;
  inReplyTo: string | null;
  fromName: string | null;
  fromAddress: string | null;
  recipientAddress: string | null;
  subject: string | null;
  textBody: string | null;
  htmlBody: string | null;
  autoSubmitted: string | null;
  precedence: string | null;
  authenticationResults: string[];
  attachmentCount: number;
  quarantineCode: string | null;
}

export interface OutboundTransportMail {
  to: string;
  from: {
    address: string;
    name: string;
  };
  replyTo: string;
  messageId: string;
  subject: string;
  text: string;
  html: string;
}

export interface SupportMailTransport {
  pollInbox(
    handler: (message: TransportInboundMail) => Promise<boolean>,
  ): Promise<number>;
  send(message: OutboundTransportMail): Promise<string>;
  close(): Promise<void>;
}

interface ImapErrorEmitter {
  on(event: "error", listener: (error: Error) => void): unknown;
}

export function observeImapClientErrors(client: ImapErrorEmitter): void {
  client.on("error", () => undefined);
}

export async function processSupportInboxFetch(
  client: ImapFlow,
  selected: number[],
  handler: (message: TransportInboundMail) => Promise<boolean>,
): Promise<number> {
  const seenUids: number[] = [];
  const uidValidity =
    client.mailbox && typeof client.mailbox === "object"
      ? String(client.mailbox.uidValidity)
      : "unknown";

  for await (const item of client.fetch(
    selected,
    {
      uid: true,
      envelope: true,
      size: true,
      source: { maxLength: MAX_INBOUND_SOURCE_BYTES + 1 },
    },
    { uid: true },
  )) {
    const providerReference = `${uidValidity}:${item.uid}`;
    const oversized =
      (item.size ?? 0) > MAX_INBOUND_SOURCE_BYTES ||
      (item.source?.byteLength ?? 0) > MAX_INBOUND_SOURCE_BYTES;
    let message: TransportInboundMail;

    if (oversized || !item.source) {
      const sender = item.envelope?.from?.[0];
      const recipient = item.envelope?.to?.[0];
      message = {
        providerReference,
        messageId: item.envelope?.messageId ?? null,
        inReplyTo: item.envelope?.inReplyTo ?? null,
        fromName: sender?.name ?? null,
        fromAddress: sender?.address?.toLowerCase() ?? null,
        recipientAddress: recipient?.address?.toLowerCase() ?? null,
        subject: item.envelope?.subject ?? null,
        textBody: null,
        htmlBody: null,
        autoSubmitted: null,
        precedence: null,
        authenticationResults: [],
        attachmentCount: 0,
        quarantineCode: oversized ? "message_too_large" : "missing_source",
      };
    } else {
      try {
        const parsed = await simpleParser(item.source, {
          maxHtmlLengthToParse: 512 * 1024,
          skipImageLinks: true,
          skipTextToHtml: true,
          skipTextLinks: true,
        });
        const sender = firstAddress(parsed.from);
        const recipient = firstAddress(parsed.to);
        message = {
          providerReference,
          messageId: parsed.messageId ?? item.envelope?.messageId ?? null,
          inReplyTo: parsed.inReplyTo ?? item.envelope?.inReplyTo ?? null,
          fromName: sender.name,
          fromAddress: sender.address,
          recipientAddress: recipient.address,
          subject: parsed.subject ?? item.envelope?.subject ?? null,
          textBody: parsed.text ?? null,
          htmlBody: typeof parsed.html === "string" ? parsed.html : null,
          autoSubmitted: headerString(parsed.headers.get("auto-submitted")),
          precedence: headerString(parsed.headers.get("precedence")),
          authenticationResults: authenticationResultLines(parsed.headerLines),
          attachmentCount: parsed.attachments.length,
          quarantineCode: null,
        };
      } catch {
        const sender = item.envelope?.from?.[0];
        const recipient = item.envelope?.to?.[0];
        message = {
          providerReference,
          messageId: item.envelope?.messageId ?? null,
          inReplyTo: item.envelope?.inReplyTo ?? null,
          fromName: sender?.name ?? null,
          fromAddress: sender?.address?.toLowerCase() ?? null,
          recipientAddress: recipient?.address?.toLowerCase() ?? null,
          subject: item.envelope?.subject ?? null,
          textBody: null,
          htmlBody: null,
          autoSubmitted: null,
          precedence: null,
          authenticationResults: [],
          attachmentCount: 0,
          quarantineCode: "message_parse_failed",
        };
      }
    }

    try {
      if (await handler(message)) {
        seenUids.push(item.uid);
      }
    } catch {
      // Keep this UID unseen for a later retry without blocking the remaining
      // bounded batch.
    }
  }

  let processed = 0;
  // ImapFlow cannot run another command while a fetch iterator is active.
  // Apply flags only after the iterator has completed to avoid a deadlock.
  for (const uid of seenUids) {
    try {
      await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      processed += 1;
    } catch {
      // Core ingestion is idempotent. Leaving the UID unseen is safer than
      // losing a message when the flag update fails.
    }
  }
  return processed;
}

function firstAddress(value: AddressObject | AddressObject[] | undefined): {
  name: string | null;
  address: string | null;
} {
  const object = Array.isArray(value) ? value[0] : value;
  const address = object?.value.find((candidate) => candidate.address);
  return {
    name: address?.name?.trim() || null,
    address: address?.address?.trim().toLowerCase() || null,
  };
}

function headerString(value: HeaderValue | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.join(", ");
  }
  return null;
}

function authenticationResultLines(
  headerLines: ReadonlyArray<{ key: string; line: string }>,
): string[] {
  const line = headerLines.find(
    (candidate) => candidate.key.toLowerCase() === "authentication-results",
  )?.line;
  if (!line) return [];
  return [line.replace(/^[^:]+:\s*/i, "")];
}

export function createSupportMailTransport(
  config: Extract<SupportMailConfig, { enabled: true }>,
): SupportMailTransport {
  const smtp: Transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.password,
    },
    tls: {
      rejectUnauthorized: true,
      servername: config.smtp.host,
    },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });

  return {
    async pollInbox(handler) {
      const client = new ImapFlow({
        host: config.imap.host,
        port: config.imap.port,
        secure: config.imap.secure,
        auth: {
          user: config.imap.user,
          pass: config.imap.password,
        },
        tls: {
          rejectUnauthorized: true,
        },
        logger: false,
        disableAutoIdle: true,
        connectionTimeout: 20_000,
        greetingTimeout: 20_000,
        socketTimeout: 60_000,
      });
      observeImapClientErrors(client);

      let processed = 0;
      try {
        await client.connect();
        const lock = await client.getMailboxLock("INBOX");
        try {
          const unseen = await client.search({ seen: false }, { uid: true });
          if (!unseen || unseen.length === 0) return 0;
          const selected = unseen.slice(0, MAX_MESSAGES_PER_POLL);
          processed = await processSupportInboxFetch(
            client,
            selected,
            handler,
          );
        } finally {
          lock.release();
        }
      } finally {
        if (client.usable) {
          await client.logout().catch(() => undefined);
        } else {
          client.close();
        }
      }
      return processed;
    },

    async send(message) {
      const result = await smtp.sendMail({
        from: message.from,
        to: message.to,
        replyTo: message.replyTo,
        messageId: message.messageId,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: {
          "Auto-Submitted": "no",
          "X-Auto-Response-Suppress": "OOF, AutoReply",
        },
      });
      return result.messageId || message.messageId;
    },

    async close() {
      smtp.close();
    },
  };
}
