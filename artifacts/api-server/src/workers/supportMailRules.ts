import { createHash, createHmac } from "node:crypto";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Environment = Record<string, string | undefined>;

export type SupportMailConfig =
  | { enabled: false }
  | {
      enabled: true;
      supabase: {
        url: string;
        serviceRoleKey: string;
      };
      imap: {
        host: string;
        port: number;
        secure: boolean;
        user: string;
        password: string;
      };
      smtp: {
        host: string;
        port: number;
        secure: boolean;
        user: string;
        password: string;
      };
      from: {
        address: string;
        name: string;
      };
      mailDomain: string;
      trustedAuthServer: string;
      hmacSecret: string;
      contactHmacSecret: string;
      pollMs: number;
      publicState: {
        enabled: true;
        mailboxDomain: string;
      };
    };

export type InboundMailInput = {
  messageId?: string | null;
  fromName?: string | null;
  fromAddress?: string | null;
  recipientAddress?: string | null;
  subject?: string | null;
  textBody?: string | null;
  htmlBody?: string | null;
  autoSubmitted?: string | null;
  precedence?: string | null;
  attachmentCount?: number | null;
};

export type NormalizedInboundMail =
  | {
      kind: "accepted";
      value: {
        messageId: string;
        fromName: string;
        fromAddress: string;
        recipientAddress: string;
        subject: string;
        body: string;
        attachmentCount: number;
      };
    }
  | {
      kind: "quarantine";
      code:
        | "automated_message"
        | "invalid_sender"
        | "invalid_recipient"
        | "empty_message";
    };

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error("support_mail_config_invalid");
  }
  return value;
}

function boundedInteger(
  environment: Environment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error("support_mail_config_invalid");
  }
  return value;
}

function mailDomain(address: string): string {
  const separator = address.lastIndexOf("@");
  return separator >= 0 ? address.slice(separator + 1).toLowerCase() : "";
}

export function readSupportMailConfig(
  environment: Environment,
): SupportMailConfig {
  if (environment.SUPPORT_MAIL_ENABLED !== "1") {
    return { enabled: false };
  }

  const supabaseUrl = required(environment, "SUPABASE_URL");
  const serviceRoleKey =
    environment.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    environment.SELFHOST_SERVICE_ROLE_KEY?.trim();
  const host = required(environment, "SUPPORT_MAIL_HOST");
  const user = required(environment, "SUPPORT_MAIL_USER").toLowerCase();
  const password = required(environment, "SUPPORT_MAIL_PASSWORD");
  const fromAddress = required(environment, "SUPPORT_MAIL_FROM").toLowerCase();
  const fromName = required(environment, "SUPPORT_MAIL_FROM_NAME");
  const trustedAuthServer = required(
    environment,
    "SUPPORT_MAIL_TRUSTED_AUTH_SERVER",
  ).toLowerCase();
  const hmacSecret = required(environment, "SUPPORT_MAIL_HMAC_SECRET");
  const contactHmacSecret =
    environment.SUPPORT_MAIL_CONTACT_HMAC_SECRET?.trim() ||
    environment.SUPPORT_GUEST_SECRET_HMAC_KEY?.trim() ||
    environment.SUPPORT_GATEWAY_HMAC_SECRET?.trim();
  if (environment.SUPPORT_MAIL_TLS?.trim() === "0") {
    throw new Error("support_mail_config_invalid");
  }
  const secure = true;

  if (
    !serviceRoleKey ||
    !EMAIL_RE.test(user) ||
    !EMAIL_RE.test(fromAddress) ||
    hmacSecret.length < 32 ||
    !contactHmacSecret ||
    contactHmacSecret.length < 32 ||
    !/^[a-z0-9.-]+$/.test(trustedAuthServer)
  ) {
    throw new Error("support_mail_config_invalid");
  }

  const domain = mailDomain(fromAddress);
  if (!domain) {
    throw new Error("support_mail_config_invalid");
  }

  return {
    enabled: true,
    supabase: {
      url: supabaseUrl,
      serviceRoleKey,
    },
    imap: {
      host,
      port: boundedInteger(
        environment,
        "SUPPORT_MAIL_IMAP_PORT",
        993,
        1,
        65535,
      ),
      secure,
      user,
      password,
    },
    smtp: {
      host,
      port: boundedInteger(
        environment,
        "SUPPORT_MAIL_SMTP_PORT",
        465,
        1,
        65535,
      ),
      secure,
      user,
      password,
    },
    from: {
      address: fromAddress,
      name: fromName.slice(0, 120),
    },
    mailDomain: domain,
    trustedAuthServer,
    hmacSecret,
    contactHmacSecret,
    pollMs: boundedInteger(
      environment,
      "SUPPORT_MAIL_POLL_MS",
      30_000,
      5_000,
      300_000,
    ),
    publicState: {
      enabled: true,
      mailboxDomain: domain,
    },
  };
}

function authenticationDomain(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[<>"'()[\]]/g, "");
  const separator = normalized.lastIndexOf("@");
  return (
    separator >= 0 ? normalized.slice(separator + 1) : normalized
  ).replace(/\.$/, "");
}

function isAlignedDomain(candidate: string, expected: string): boolean {
  return candidate === expected || candidate.endsWith(`.${expected}`);
}

export function hasTrustedSenderAuthentication(
  authenticationResults: readonly string[],
  trustedAuthServer: string,
  senderAddress: string,
): boolean {
  const expectedServer = trustedAuthServer.trim().toLowerCase();
  const senderDomain = mailDomain(senderAddress.trim().toLowerCase());
  if (!expectedServer || !senderDomain) return false;

  for (const rawResult of authenticationResults.slice(0, 1)) {
    const clauses = rawResult
      .replace(/[\r\n]+/g, " ")
      .split(";")
      .map((value) => value.trim())
      .filter(Boolean);
    if (clauses.shift()?.toLowerCase() !== expectedServer) continue;

    const normalized = clauses.join("; ");
    if (/\bdmarc\s*=\s*pass\b/i.test(normalized)) {
      return true;
    }

    for (const clause of clauses) {
      const dkimDomain = /\bdkim\s*=\s*pass\b/i.test(clause)
        ? /\bheader\.d\s*=\s*([^\s;]+)/i.exec(clause)?.[1]
        : null;
      if (
        dkimDomain &&
        isAlignedDomain(authenticationDomain(dkimDomain), senderDomain)
      ) {
        return true;
      }

      const spfIdentity = /\bspf\s*=\s*pass\b/i.test(clause)
        ? /\bsmtp\.mailfrom\s*=\s*([^\s;]+)/i.exec(clause)?.[1]
        : null;
      if (
        spfIdentity &&
        isAlignedDomain(authenticationDomain(spfIdentity), senderDomain)
      ) {
        return true;
      }
    }
  }

  return false;
}

function cleanHeader(
  value: string | null | undefined,
  maximum: number,
): string {
  return (value ?? "")
    .replace(/[\r\n\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function cleanBody(value: string | null | undefined): string {
  const normalized = (value ?? "").replace(/\r\n?/g, "\n");
  const body = normalized
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return body.slice(0, 8_000);
}

export function normalizeInboundMail(
  input: InboundMailInput,
): NormalizedInboundMail {
  const autoSubmitted = cleanHeader(input.autoSubmitted, 80).toLowerCase();
  const precedence = cleanHeader(input.precedence, 80).toLowerCase();
  if (
    (autoSubmitted && autoSubmitted !== "no") ||
    ["bulk", "junk", "list", "auto_reply"].includes(precedence)
  ) {
    return { kind: "quarantine", code: "automated_message" };
  }

  const fromAddress = cleanHeader(input.fromAddress, 320).toLowerCase();
  if (!EMAIL_RE.test(fromAddress)) {
    return { kind: "quarantine", code: "invalid_sender" };
  }

  const recipientAddress = cleanHeader(
    input.recipientAddress,
    320,
  ).toLowerCase();
  if (!EMAIL_RE.test(recipientAddress)) {
    return { kind: "quarantine", code: "invalid_recipient" };
  }

  const body = cleanBody(input.textBody);
  if (!body) {
    return { kind: "quarantine", code: "empty_message" };
  }

  return {
    kind: "accepted",
    value: {
      messageId: cleanHeader(input.messageId, 512),
      fromName: cleanHeader(input.fromName, 160),
      fromAddress,
      recipientAddress,
      subject: cleanHeader(input.subject, 300) || "Обращение в поддержку",
      body,
      attachmentCount: Math.max(
        0,
        Math.min(32, Number(input.attachmentCount) || 0),
      ),
    },
  };
}

export function hashMailValue(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value.trim()).digest("hex");
}

export function hashMessageIdentifier(value: string): string {
  return createHash("sha256").update(value.trim()).digest("hex");
}

export function buildSupportReplyAddress(
  ticketId: string,
  domain: string,
  secret: string,
): string {
  if (!UUID_RE.test(ticketId) || !domain || !secret) {
    throw new Error("support_mail_identifier_invalid");
  }
  const token = hashMailValue(`route:${ticketId}`, secret).slice(0, 32);
  return `support+${token}@${domain.toLowerCase()}`;
}

export function buildOutboundMessageId(
  outboxId: string,
  domain: string,
): string {
  if (!UUID_RE.test(outboxId) || !domain) {
    throw new Error("support_mail_identifier_invalid");
  }
  return `<support-${outboxId.replaceAll("-", "").toLowerCase()}@${domain.toLowerCase()}>`;
}

export function sanitizeSupportMailErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    const code = error.code.toLowerCase().replace(/[^a-z0-9_]/g, "");
    return code.slice(0, 64) || "unknown";
  }
  return "unknown";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderSupportReplyEmail(input: {
  publicReference: string;
  contactName: string;
  subject: string;
  body: string;
}): { subject: string; text: string; html: string } {
  const reference = cleanHeader(input.publicReference, 80);
  const contactName = cleanHeader(input.contactName, 160);
  const subject = cleanHeader(input.subject, 240);
  const body = cleanBody(input.body);
  const title = `Ответ поддержки LETSCUBE · ${reference}`;
  const text = [
    contactName ? `Здравствуйте, ${contactName}!` : "Здравствуйте!",
    "",
    body,
    "",
    `Обращение: ${reference}`,
    "Ответьте на это письмо, чтобы продолжить диалог.",
  ].join("\n");

  return {
    subject: `${title}${subject ? ` · ${subject}` : ""}`,
    text,
    html: `<!doctype html>
<html lang="ru">
  <body style="margin:0;background:#07131f;color:#f4f8fb;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#07131f;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#0c1e2e;border:1px solid #24445d">
          <tr><td style="padding:28px">
            <div style="font-size:24px;font-weight:700;color:#ffffff">LETSCUBE</div>
            <div style="margin-top:6px;color:#6eb5e8">Поддержка кибер-арены</div>
            <p style="margin:28px 0 16px">Здравствуйте${contactName ? `, ${escapeHtml(contactName)}` : ""}!</p>
            <div style="white-space:pre-wrap;line-height:1.6;color:#edf4f8">${escapeHtml(body)}</div>
            <div style="margin-top:28px;padding-top:18px;border-top:1px solid #24445d;color:#9db4c6;font-size:13px">
              Обращение: ${escapeHtml(reference)}<br>
              Ответьте на это письмо, чтобы продолжить диалог.
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
  };
}
