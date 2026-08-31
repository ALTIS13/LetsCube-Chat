import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import type { LookupAddress } from "node:dns";
import type { RequestOptions } from "node:https";

const MAX_URL_BYTES = 2_048;
const MAX_RESPONSE_BYTES = 64 * 1_024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 2;
const WEBHOOK_SECRET_HEADER = "X-Letscube-Bot-Webhook-Secret";
const SECRET_RE = /^[A-Za-z0-9_-]{16,256}$/;
const CIPHERTEXT_RE = /^enc:v1:([A-Za-z0-9_-]+)$/;

const blockedIpv4 = new BlockList();
const blockedIpv6 = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6.addSubnet(network, prefix, "ipv6");
}

export type WebhookAddress = {
  address: string;
  family: 4 | 6;
};

export type WebhookResolver = (
  hostname: string,
) => Promise<readonly WebhookAddress[]>;

export type ValidatedWebhookTarget = {
  url: URL;
  hostname: string;
  addresses: WebhookAddress[];
};

export type WebhookTransportResult = {
  statusCode: number;
  location?: string;
};

export type WebhookTransport = (input: {
  target: ValidatedWebhookTarget;
  body: Buffer;
  secret: string;
}) => Promise<WebhookTransportResult>;

export type WebhookDeliveryResult = {
  kind: "delivered" | "retry" | "dead_letter";
  errorCode: string | null;
  httpStatus: number | null;
};

class WebhookSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSecurityError";
  }
}

class WebhookTransportError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "WebhookTransportError";
    this.code = code;
  }
}

function normalizedHostname(url: URL): string {
  return url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
}

function isBlockedAddress(answer: WebhookAddress): boolean {
  const detectedFamily = isIP(answer.address);
  if (detectedFamily !== answer.family) return true;
  return answer.family === 4
    ? blockedIpv4.check(answer.address, "ipv4")
    : blockedIpv6.check(answer.address, "ipv6");
}

export const resolveWebhookHostname: WebhookResolver = async (hostname) => {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.map((answer: LookupAddress) => {
    if (answer.family !== 4 && answer.family !== 6) {
      throw new WebhookSecurityError("webhook_dns_invalid");
    }
    return { address: answer.address, family: answer.family };
  });
};

export async function validateWebhookTarget(
  rawUrl: string,
  resolver: WebhookResolver = resolveWebhookHostname,
): Promise<ValidatedWebhookTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookSecurityError("webhook_target_invalid");
  }

  const hostname = normalizedHostname(url);
  const canonicalBytes = Buffer.byteLength(url.href, "utf8");
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    hostname.length === 0 ||
    hostname.toLowerCase() === "localhost" ||
    hostname.toLowerCase().endsWith(".localhost") ||
    isIP(hostname) !== 0 ||
    canonicalBytes < 10 ||
    canonicalBytes > MAX_URL_BYTES
  ) {
    throw new WebhookSecurityError("webhook_target_invalid");
  }

  let answers: readonly WebhookAddress[];
  try {
    answers = await resolver(hostname);
  } catch {
    throw new WebhookSecurityError("webhook_dns_invalid");
  }
  if (answers.length === 0 || answers.length > 32) {
    throw new WebhookSecurityError("webhook_dns_invalid");
  }
  if (answers.some(isBlockedAddress)) {
    throw new WebhookSecurityError("webhook_target_blocked");
  }

  return {
    url,
    hostname,
    addresses: answers.map((answer) => ({ ...answer })),
  };
}

export function resolveWebhookEncryptionKey(
  environment: NodeJS.ProcessEnv,
): Buffer {
  const encoded = environment.BOT_WEBHOOK_ENCRYPTION_KEY;
  if (!encoded || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) {
    throw new Error("bot_gateway_config_invalid");
  }
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encoded) {
    throw new Error("bot_gateway_config_invalid");
  }
  return key;
}

export function encryptWebhookSecret(
  secret: string,
  key: Uint8Array,
): { ciphertext: string; fingerprint: string } {
  if (!SECRET_RE.test(secret) || key.byteLength !== 32) {
    throw new WebhookSecurityError("webhook_secret_invalid");
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const envelope = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
  return {
    ciphertext: `enc:v1:${envelope.toString("base64url")}`,
    fingerprint: createHash("sha256").update(secret, "utf8").digest("hex"),
  };
}

export function decryptWebhookSecret(
  ciphertext: string,
  key: Uint8Array,
): string {
  try {
    const match = CIPHERTEXT_RE.exec(ciphertext);
    if (!match || key.byteLength !== 32) {
      throw new Error("invalid");
    }
    const envelope = Buffer.from(match[1], "base64url");
    if (
      envelope.length < 44 ||
      envelope.length > 284 ||
      envelope.toString("base64url") !== match[1]
    ) {
      throw new Error("invalid");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      envelope.subarray(0, 12),
    );
    decipher.setAuthTag(envelope.subarray(12, 28));
    const secret = Buffer.concat([
      decipher.update(envelope.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
    if (!SECRET_RE.test(secret)) throw new Error("invalid");
    return secret;
  } catch {
    throw new WebhookSecurityError("webhook_secret_invalid");
  }
}

export async function requestPinnedWebhook(input: {
  target: ValidatedWebhookTarget;
  body: Buffer;
  secret: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  tls?: Pick<RequestOptions, "ca">;
  request?: typeof httpsRequest;
}): Promise<WebhookTransportResult> {
  const timeoutMs = input.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxResponseBytes = input.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  const selected = input.target.addresses[0];
  if (!selected || isBlockedAddress(selected)) {
    throw new WebhookTransportError("connection_target_invalid");
  }

  return await new Promise<WebhookTransportResult>((resolve, reject) => {
    let settled = false;
    const finish = (
      callback: () => void,
      timer: NodeJS.Timeout,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const options: RequestOptions = {
      method: "POST",
      agent: false,
      servername: input.target.hostname,
      headers: {
        "content-type": "application/json",
        "content-length": input.body.byteLength,
        [WEBHOOK_SECRET_HEADER]: input.secret,
      },
      lookup(_hostname, _options, callback) {
        callback(null, selected.address, selected.family);
      },
      ...input.tls,
    };
    const requestFactory = input.request ?? httpsRequest;
    const request = requestFactory(input.target.url, options, (response) => {
      let responseBytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        responseBytes += Buffer.byteLength(chunk);
        if (responseBytes > maxResponseBytes) {
          const error = new WebhookTransportError("response_too_large");
          finish(() => reject(error), timer);
          response.destroy();
          request.destroy(error);
        }
      });
      response.once("end", () => {
        const statusCode = response.statusCode;
        if (!statusCode || statusCode < 100 || statusCode > 599) {
          finish(
            () => reject(new WebhookTransportError("network_error")),
            timer,
          );
          return;
        }
        const location = response.headers.location;
        finish(
          () =>
            resolve({
              statusCode,
              ...(typeof location === "string" && location.length <= MAX_URL_BYTES
                ? { location }
                : {}),
            }),
          timer,
        );
      });
    });
    const timer = setTimeout(() => {
      request.destroy(new WebhookTransportError("webhook_timeout"));
    }, timeoutMs);
    timer.unref();
    request.once("error", (error) => {
      const safeError =
        error instanceof WebhookTransportError
          ? error
          : new WebhookTransportError(
              error && typeof error === "object" && "code" in error &&
                String((error as { code?: unknown }).code).startsWith("ERR_TLS")
                ? "tls_error"
                : "network_error",
            );
      finish(() => reject(safeError), timer);
    });
    request.end(input.body);
  });
}

function classifiedResult(
  kind: WebhookDeliveryResult["kind"],
  errorCode: string | null,
  httpStatus: number | null,
): WebhookDeliveryResult {
  return { kind, errorCode, httpStatus };
}

export async function deliverWebhook(input: {
  url: string;
  payload: Record<string, unknown>;
  secret: string;
  resolver?: WebhookResolver;
  transport?: WebhookTransport;
}): Promise<WebhookDeliveryResult> {
  const resolver = input.resolver ?? resolveWebhookHostname;
  const transport = input.transport ?? ((request) => requestPinnedWebhook(request));
  const body = Buffer.from(JSON.stringify(input.payload), "utf8");
  if (body.byteLength > MAX_RESPONSE_BYTES) {
    return classifiedResult("dead_letter", "payload_too_large", null);
  }

  let currentUrl = input.url;
  let initialOrigin: string | undefined;
  for (let redirectCount = 0; ; redirectCount += 1) {
    let target: ValidatedWebhookTarget;
    try {
      target = await validateWebhookTarget(currentUrl, resolver);
    } catch {
      return classifiedResult(
        "dead_letter",
        redirectCount === 0
          ? "webhook_target_invalid"
          : "redirect_target_invalid",
        null,
      );
    }
    initialOrigin ??= target.url.origin;

    let response: WebhookTransportResult;
    try {
      response = await transport({ target, body, secret: input.secret });
    } catch (error) {
      const code =
        error instanceof WebhookTransportError ? error.code : "network_error";
      if (code === "response_too_large" || code === "tls_error") {
        return classifiedResult("dead_letter", code, null);
      }
      return classifiedResult("retry", code, null);
    }

    const status = response.statusCode;
    if (status >= 200 && status <= 299) {
      return classifiedResult("delivered", null, status);
    }
    if (status >= 300 && status <= 399) {
      if (!response.location) {
        return classifiedResult("dead_letter", "redirect_invalid", status);
      }
      if (redirectCount >= MAX_REDIRECTS) {
        return classifiedResult("dead_letter", "redirect_limit_exceeded", status);
      }
      let redirected: URL;
      try {
        redirected = new URL(response.location, target.url);
      } catch {
        return classifiedResult("dead_letter", "redirect_invalid", status);
      }
      let validatedRedirect: ValidatedWebhookTarget;
      try {
        validatedRedirect = await validateWebhookTarget(redirected.href, resolver);
      } catch {
        return classifiedResult("dead_letter", "redirect_target_invalid", status);
      }
      if (validatedRedirect.url.origin !== initialOrigin) {
        return classifiedResult("dead_letter", "redirect_origin_invalid", status);
      }
      currentUrl = validatedRedirect.url.href;
      continue;
    }
    if ([408, 409, 425, 429].includes(status) || status >= 500) {
      return classifiedResult("retry", "http_transient_error", status);
    }
    if (status >= 400 && status <= 499) {
      return classifiedResult("dead_letter", "http_client_error", status);
    }
    return classifiedResult("dead_letter", "http_status_invalid", status);
  }
}
