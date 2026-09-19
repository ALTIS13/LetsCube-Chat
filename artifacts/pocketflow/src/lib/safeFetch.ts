import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import type { Socket } from "node:net";

import {
  SsrfError,
  createPinnedLookup,
  resolveSafeTarget,
  socketMatchesPin,
  type DnsResolver,
  type SafeTarget,
} from "#pf/lib/ssrf";

/**
 * The only way PocketFlow reaches an address a person gave it.
 *
 * `ssrf.ts` decides what may be dialled; this dials it and keeps the decision
 * true for the length of the request. Four bounds, all of them the brief's
 * (§6, §20), and each one is a way a fetch of an arbitrary URL goes wrong:
 *
 *   - **a redirect is a new URL**, so every hop is re-validated from scratch —
 *     re-parsed, re-resolved, re-judged. A guard applied only to what the
 *     person typed is a guard an attacker skips with one 302.
 *   - **redirects are bounded**, or a pair of URLs pointing at each other is an
 *     infinite loop with a socket in it.
 *   - **time is bounded**, and bounded *in total* rather than per hop, so three
 *     redirects cannot quietly buy three times the budget.
 *   - **bytes are bounded**, counted as they arrive rather than after.
 *
 * And one that is not in the brief but belongs with them: the request asks for
 * `identity` encoding. A byte cap counted on a gzip stream is not a byte cap —
 * a few hundred kilobytes of response can decompress into gigabytes, and the
 * process dies of a bound that was technically enforced.
 *
 * Nothing here sends a credential: no cookies are kept, no `Authorization` is
 * ever attached, and `ssrf.ts` refuses a URL that carries userinfo. So a
 * redirect to another origin is allowed (a watched site moving to `www.` is
 * ordinary), because there is nothing to leak to it — only a downgrade from
 * https to http is refused, since that is a redirect nobody legitimate wants.
 */

export type SafeFetchErrorCode =
  | "denied"
  | "timeout"
  | "network"
  | "tls"
  | "response_too_large"
  | "redirect_limit"
  | "redirect_invalid"
  | "redirect_downgrade"
  | "status_invalid"
  | "address_mismatch";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  /** Present when the cause was the address policy, so a caller can log the precise reason. */
  readonly denial: SsrfError | null;

  constructor(code: SafeFetchErrorCode, denial: SsrfError | null = null) {
    super(`safe_fetch:${code}`);
    this.name = "SafeFetchError";
    this.code = code;
    this.denial = denial;
  }

  /** What a person may be told. Delegates the delicate case to SsrfError. */
  get publicMessage(): string {
    if (this.denial) return this.denial.publicMessage;
    switch (this.code) {
      case "timeout":
        return "Адрес не ответил вовремя.";
      case "response_too_large":
        return "Ответ слишком большой, чтобы его наблюдать.";
      case "redirect_limit":
      case "redirect_invalid":
      case "redirect_downgrade":
        return "Слишком много или неверных перенаправлений.";
      case "tls":
        return "Не удалось установить защищённое соединение.";
      default:
        return "Адрес недоступен.";
    }
  }
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 1_024 * 1_024;
export const DEFAULT_MAX_REDIRECTS = 3;

const USER_AGENT = "PocketFlow/1.0 (+url-watcher)";

/**
 * What to do when the body runs past `maxBytes`.
 *
 * `"error"` is the default and is right for anything that compares one body to
 * the last one: a silently truncated body hashes stably, so a change past the
 * cut would never be seen and the watcher would report "unchanged" for ever —
 * a lie rather than a limitation.
 *
 * `"truncate"` is right for a caller that only wants the status line and is
 * reading the body solely to drain the socket. Either way the cap is enforced
 * on the bytes as they arrive, and the connection is dropped at the cap.
 */
export type OversizePolicy = "error" | "truncate";

export type HopRequest = {
  target: SafeTarget;
  method: "GET" | "HEAD";
  headers: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxBytes: number;
  onOversize: OversizePolicy;
};

export type HopResponse = {
  status: number;
  /** Lowercased names, last value wins. Only what a watcher reads. */
  headers: Readonly<Record<string, string>>;
  body: Buffer;
  /** True when the body was cut at `maxBytes` under the `"truncate"` policy. */
  truncated: boolean;
  /** What the kernel said the socket connected to, when a socket existed. */
  remoteAddress: string | null;
};

/** The seam a test replaces so the redirect policy can be exercised without a socket. */
export type Hop = (request: HopRequest) => Promise<HopResponse>;

export type SafeFetchOptions = {
  method?: "GET" | "HEAD";
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  onOversize?: OversizePolicy;
  resolver?: DnsResolver;
  hop?: Hop;
  now?: () => number;
  /** Extra request headers. Never a credential; see the file comment. */
  headers?: Readonly<Record<string, string>>;
};

export type SafeFetchResult = {
  /** After redirects. What was actually read. */
  finalUrl: string;
  status: number;
  headers: Readonly<Record<string, string>>;
  body: Buffer;
  /** True when the body was cut at `maxBytes`; only possible under `"truncate"`. */
  truncated: boolean;
  redirects: number;
  /** The address the last hop connected to, for the log and for nothing else. */
  address: string | null;
  elapsedMs: number;
};

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | null {
  const value = headers[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * One request, to one already-approved address.
 *
 * `target.addresses[0]` is the address that was checked and is the address that
 * is dialled; `createPinnedLookup` is what makes the second true, and the
 * `socketMatchesPin` assertion below is the receipt that it stayed true.
 */
export const performHop: Hop = async (input) => {
  const selected = input.target.addresses[0];
  if (!selected) throw new SafeFetchError("denied", new SsrfError("dns_no_answer", input.target.hostname));

  const secure = input.target.url.protocol === "https:";
  const requestFactory = secure ? httpsRequest : httpRequest;

  return await new Promise<HopResponse>((resolve, reject) => {
    let settled = false;
    let request: ClientRequest | null = null;

    const timer = setTimeout(() => {
      finish(() => reject(new SafeFetchError("timeout")));
      request?.destroy();
    }, Math.max(1, input.timeoutMs));
    timer.unref();

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    const options: RequestOptions = {
      method: input.method,
      // No pooling. A shared agent keys sockets by host:port and could hand
      // back a connection opened for a name that resolved somewhere else.
      agent: false,
      headers: { ...input.headers },
      lookup: createPinnedLookup(selected),
      // SNI belongs to the name, not to the pinned address — but only when
      // there is a name. An IP literal as SNI is invalid and some servers
      // reject the handshake outright.
      ...(secure && isIP(input.target.hostname) === 0
        ? { servername: input.target.hostname }
        : {}),
    };

    request = requestFactory(input.target.url, options, (response: IncomingMessage) => {
      const chunks: Buffer[] = [];
      let received = 0;
      let truncated = false;

      const settle = (): void => {
        const status = response.statusCode;
        if (typeof status !== "number" || status < 100 || status > 599) {
          finish(() => reject(new SafeFetchError("status_invalid")));
          return;
        }
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (typeof value === "string") headers[name.toLowerCase()] = value;
          else if (Array.isArray(value)) headers[name.toLowerCase()] = value.join(", ");
        }
        // Read before the socket is dropped; after `destroy()` it is null.
        const remoteAddress = response.socket?.remoteAddress ?? null;
        finish(() =>
          resolve({ status, headers, body: Buffer.concat(chunks), truncated, remoteAddress }),
        );
      };

      response.on("data", (chunk: Buffer | string) => {
        if (truncated) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const room = input.maxBytes - received;
        if (buffer.byteLength > room) {
          if (input.onOversize === "error") {
            const error = new SafeFetchError("response_too_large");
            finish(() => reject(error));
            response.destroy();
            request?.destroy();
            return;
          }
          // Keep exactly the cap and stop. Settling here rather than waiting
          // for `end` matters: the destroy below means `end` never arrives.
          if (room > 0) chunks.push(buffer.subarray(0, room));
          received = input.maxBytes;
          truncated = true;
          settle();
          response.destroy();
          request?.destroy();
          return;
        }
        received += buffer.byteLength;
        chunks.push(buffer);
      });
      response.once("error", () => finish(() => reject(new SafeFetchError("network"))));
      response.once("end", settle);
    });

    // The tripwire. If anything below us ignored `lookup` — a future Node, an
    // agent we did not expect, a proxy env var — the socket lands somewhere
    // that was never checked, and this is where that becomes visible instead
    // of becoming a request.
    request.once("socket", (socket: Socket) => {
      const verify = (): void => {
        if (!socketMatchesPin(socket.remoteAddress, selected)) {
          finish(() => reject(new SafeFetchError("address_mismatch")));
          socket.destroy();
          request?.destroy();
        }
      };
      if (socket.connecting) socket.once("connect", verify);
      else verify();
    });

    request.once("error", (error: unknown) => {
      if (error instanceof SafeFetchError) {
        finish(() => reject(error));
        return;
      }
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      finish(() =>
        reject(new SafeFetchError(code.startsWith("ERR_TLS") ? "tls" : "network")),
      );
    });

    request.end();
  });
};

/**
 * Fetch a URL a person supplied, or refuse it.
 *
 * Throws `SsrfError` when the address policy says no and `SafeFetchError` for
 * everything else. Both carry a `publicMessage` that is safe to put in a chat.
 */
export async function safeFetch(
  rawUrl: string,
  options?: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const now = options?.now ?? Date.now;
  const hop = options?.hop ?? performHop;
  const resolver = options?.resolver;
  const timeoutMs = Math.max(1, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxBytes = Math.max(1, options?.maxBytes ?? DEFAULT_MAX_BYTES);
  const maxRedirects = Math.max(0, options?.maxRedirects ?? DEFAULT_MAX_REDIRECTS);
  const method = options?.method ?? "GET";

  const startedAt = now();
  const deadline = startedAt + timeoutMs;

  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: "*/*",
    // See the file comment: a byte cap on a compressed stream is not a cap.
    "accept-encoding": "identity",
    ...options?.headers,
  };

  let currentUrl = rawUrl;
  for (let redirects = 0; ; redirects += 1) {
    // Every hop, from scratch. Re-parsed, re-resolved, re-judged — the DNS
    // answer that was safe for hop 0 says nothing about hop 1, and neither
    // does hop 0's scheme, port or hostname.
    const target = await resolveSafeTarget(currentUrl, resolver ? { resolver } : undefined);

    const remaining = deadline - now();
    if (remaining <= 0) throw new SafeFetchError("timeout");

    const response = await hop({
      target,
      method,
      headers,
      timeoutMs: remaining,
      maxBytes,
      onOversize: options?.onOversize ?? "error",
    });

    if (response.status >= 300 && response.status <= 399) {
      const location = headerValue(response.headers, "location");
      if (!location) throw new SafeFetchError("redirect_invalid");
      if (redirects >= maxRedirects) throw new SafeFetchError("redirect_limit");

      let next: URL;
      try {
        next = new URL(location, target.url);
      } catch {
        throw new SafeFetchError("redirect_invalid");
      }
      if (target.url.protocol === "https:" && next.protocol !== "https:") {
        throw new SafeFetchError("redirect_downgrade");
      }
      currentUrl = next.href;
      continue;
    }

    return {
      finalUrl: target.url.href,
      status: response.status,
      headers: response.headers,
      body: response.body,
      truncated: response.truncated,
      redirects,
      address: response.remoteAddress,
      elapsedMs: now() - startedAt,
    };
  }
}
