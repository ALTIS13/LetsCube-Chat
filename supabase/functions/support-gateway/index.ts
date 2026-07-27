import { createSupportRateLimiter } from "./rateLimit.mjs";
import {
  normalizeGuestMessage,
  normalizeSupportTicketRequest,
} from "./validation.mjs";

const SUPPORT_SECRET_HEADER = "x-letscube-support-secret";
const MAX_REQUEST_BYTES = 20_000;
const DEFAULT_ALLOWED_ORIGIN = "https://app.letscube.ru";
const inProcessLimiter = createSupportRateLimiter();

Deno.serve(async (request: Request) => {
  try {
    return await handleRequest(request);
  } catch {
    return jsonResponse(
      { ok: false, error: "service_unavailable" },
      503,
      request,
    );
  }
});

async function handleRequest(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) {
    return jsonResponse({ ok: false, error: "forbidden" }, 403, request);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  const route = parseRoute(request);
  if (!route) {
    return jsonResponse({ ok: false, error: "not_found" }, 404, request);
  }

  if (route.kind === "create" && request.method === "POST") {
    return createTicket(request);
  }
  if (route.kind === "ticket" && request.method === "GET") {
    return getTicket(request, route.ticketId);
  }
  if (route.kind === "messages" && request.method === "POST") {
    return createMessage(request, route.ticketId);
  }
  if (route.kind === "session" && request.method === "DELETE") {
    return revokeSession(request, route.ticketId);
  }
  return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, request);
}

async function createTicket(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const normalized = normalizeSupportTicketRequest(body);
  if (!normalized.ok) {
    return jsonResponse({ ok: false, error: normalized.error }, 400, request);
  }

  const ip = clientIp(request);
  const ipPrefix = networkPrefix(ip);
  const userAgent = boundedHeader(request, "user-agent", 1_024);
  const emailHash = await hmacHex(`email:${normalized.value.email}`);
  const phoneHash = await hmacHex(`phone:${normalized.value.phone}`);
  const ipHash = ip ? await hmacHex(`ip:${ip}`) : null;
  const ipPrefixHash = ipPrefix ? await hmacHex(`ip-prefix:${ipPrefix}`) : null;
  const userAgentHash = userAgent ? await hmacHex(`ua:${userAgent}`) : null;

  const localLimit = inProcessLimiter.checkTicket({
    ipHash,
    emailHash,
    phoneHash,
  });
  if (!localLimit.ok) {
    return jsonResponse({ ok: false, error: "rate_limited" }, 429, request, {
      "retry-after": String(localLimit.retryAfterSeconds),
    });
  }

  const captcha = await verifyYandexSmartCaptcha(
    normalized.value.captchaToken,
    ip,
  );
  if (!captcha.ok) {
    return jsonResponse({ ok: false, error: captcha.error }, captcha.status, request);
  }

  const rawSecret = randomSecret();
  const secretHash = await hmacHex(`guest-secret:${rawSecret}`);
  const subjectReferenceHash = await hmacHex(
    `support-subject:${normalized.value.email}:${normalized.value.phone}`,
  );
  const now = Date.now();
  const idleExpiresAt = new Date(now + 30 * 24 * 60 * 60 * 1_000).toISOString();
  const absoluteExpiresAt = new Date(now + 90 * 24 * 60 * 60 * 1_000).toISOString();

  const rpcResult = await serviceRpc("support_guest_ticket_create", {
    p_contact_name: normalized.value.fullName,
    p_email_original: normalized.value.email,
    p_email_normalized: normalized.value.email,
    p_phone_original: normalized.value.phone,
    p_phone_e164: normalized.value.phone,
    p_email_hash: emailHash,
    p_phone_hash: phoneHash,
    p_category: normalized.value.category,
    p_subject: normalized.value.subject,
    p_message: normalized.value.message,
    p_secret_hash: secretHash,
    p_idle_expires_at: idleExpiresAt,
    p_absolute_expires_at: absoluteExpiresAt,
    p_policy_version: normalized.value.privacyVersion,
    p_subject_reference_hash: subjectReferenceHash,
    p_ip_hash: ipHash,
    p_ip_prefix_hash: ipPrefixHash,
    p_user_agent_hash: userAgentHash,
  });
  if (!rpcResult.ok) {
    return jsonResponse(
      { ok: false, error: rpcResult.error },
      rpcResult.status,
      request,
    );
  }

  const ticket = projectPublicTicket(readRecord(rpcResult.data, "ticket"));
  const session = readRecord(rpcResult.data, "session");
  if (!ticket || !session) {
    return jsonResponse({ ok: false, error: "service_unavailable" }, 503, request);
  }

  return jsonResponse(
    {
      ticket,
      session: {
        ticketId: ticket.id,
        secret: rawSecret,
        idleExpiresAt: readString(session, "idleExpiresAt") ?? idleExpiresAt,
        absoluteExpiresAt:
          readString(session, "absoluteExpiresAt") ?? absoluteExpiresAt,
        updatedAt: readString(session, "updatedAt") ?? new Date(now).toISOString(),
      },
    },
    200,
    request,
  );
}

async function getTicket(request: Request, ticketId: string): Promise<Response> {
  const auth = await guestAuth(request, ticketId);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status, request);

  const rpcResult = await serviceRpc("support_guest_ticket_get", {
    p_ticket_id: ticketId,
    p_secret_hash: auth.secretHash,
  });
  if (!rpcResult.ok) {
    return jsonResponse({ ok: false, error: rpcResult.error }, rpcResult.status, request);
  }

  const ticket = projectPublicTicket(rpcResult.data);
  return ticket
    ? jsonResponse(ticket, 200, request)
    : jsonResponse({ ok: false, error: "service_unavailable" }, 503, request);
}

async function createMessage(
  request: Request,
  ticketId: string,
): Promise<Response> {
  const auth = await guestAuth(request, ticketId);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status, request);

  const body = normalizeGuestMessage(await readJsonBody(request));
  if (!body.ok) {
    return jsonResponse({ ok: false, error: body.error }, 400, request);
  }

  const localLimit = inProcessLimiter.checkMessage(auth.secretHash);
  if (!localLimit.ok) {
    return jsonResponse({ ok: false, error: "rate_limited" }, 429, request, {
      "retry-after": String(localLimit.retryAfterSeconds),
    });
  }

  const rpcResult = await serviceRpc("support_guest_message_create", {
    p_ticket_id: ticketId,
    p_secret_hash: auth.secretHash,
    p_body: body.value,
  });
  if (!rpcResult.ok) {
    return jsonResponse({ ok: false, error: rpcResult.error }, rpcResult.status, request);
  }

  const ticket = projectPublicTicket(rpcResult.data);
  return ticket
    ? jsonResponse(ticket, 200, request)
    : jsonResponse({ ok: false, error: "service_unavailable" }, 503, request);
}

async function revokeSession(
  request: Request,
  ticketId: string,
): Promise<Response> {
  const auth = await guestAuth(request, ticketId);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status, request);
  const rpcResult = await serviceRpc("support_guest_session_revoke", {
    p_ticket_id: ticketId,
    p_secret_hash: auth.secretHash,
    p_reason: "guest_forget",
  });
  if (!rpcResult.ok) {
    return jsonResponse({ ok: false, error: rpcResult.error }, rpcResult.status, request);
  }
  return jsonResponse({ ok: true }, 200, request);
}

async function guestAuth(
  request: Request,
  ticketId: string,
): Promise<
  | { ok: true; secretHash: string }
  | { ok: false; error: string; status: number }
> {
  if (!isUuid(ticketId)) return { ok: false, error: "invalid_request", status: 400 };
  const secret = boundedHeader(request, SUPPORT_SECRET_HEADER, 512);
  if (!secret || secret.length < 24) {
    return { ok: false, error: "session_invalid", status: 401 };
  }
  return {
    ok: true,
    secretHash: await hmacHex(`guest-secret:${secret}`),
  };
}

async function verifyYandexSmartCaptcha(
  token: string,
  ip: string | null,
): Promise<
  | { ok: true }
  | { ok: false; error: string; status: number }
> {
  const secret = Deno.env.get("YANDEX_SMARTCAPTCHA_SECRET");
  if (!secret) return { ok: false, error: "not_configured", status: 503 };
  const body = new URLSearchParams({ secret, token });
  if (ip) body.set("ip", ip);

  let response: Response;
  try {
    response = await fetch("https://smartcaptcha.cloud.yandex.ru/validate", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return { ok: false, error: "captcha_failed", status: 503 };
  }
  if (!response.ok) return { ok: false, error: "captcha_failed", status: 503 };
  try {
    const result = (await response.json()) as { status?: unknown };
    return result.status === "ok"
      ? { ok: true }
      : { ok: false, error: "captcha_failed", status: 400 };
  } catch {
    return { ok: false, error: "captcha_failed", status: 503 };
  }
}

async function serviceRpc(
  functionName: string,
  body: Record<string, unknown>,
): Promise<
  | { ok: true; data: unknown }
  | { ok: false; error: string; status: number }
> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false, error: "not_configured", status: 503 };
  }
  let response: Response;
  try {
    response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${functionName}`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return { ok: false, error: "service_unavailable", status: 503 };
  }

  const data = await safeResponseJson(response);
  if (!response.ok) {
    return mapDatabaseError(response.status, data);
  }
  return { ok: true, data };
}

function mapDatabaseError(
  status: number,
  payload: unknown,
): { ok: false; error: string; status: number } {
  const message =
    payload && typeof payload === "object"
      ? String((payload as { message?: unknown }).message ?? "").toLowerCase()
      : "";
  if (message.includes("support_intake_closed")) {
    return { ok: false, error: "support_closed", status: 503 };
  }
  if (message.includes("support_rate_limited")) {
    return { ok: false, error: "rate_limited", status: 429 };
  }
  if (message.includes("support_guest_session_expired")) {
    return { ok: false, error: "session_expired", status: 401 };
  }
  if (
    message.includes("support_guest_session_invalid") ||
    message.includes("support_ticket_not_found")
  ) {
    return { ok: false, error: "session_invalid", status: 401 };
  }
  if (status === 401 || status === 403) {
    return { ok: false, error: "forbidden", status };
  }
  return { ok: false, error: "service_unavailable", status: 503 };
}

function projectPublicTicket(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = readString(record, "id");
  const publicReference = readString(record, "publicReference");
  const category = readString(record, "category");
  const subject = readString(record, "subject");
  const status = readString(record, "status");
  const createdAt = readString(record, "createdAt");
  const updatedAt = readString(record, "updatedAt");
  if (
    !id ||
    !publicReference ||
    !category ||
    !subject ||
    !status ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  const rawMessages = Array.isArray(record.messages) ? record.messages : [];
  const messages = rawMessages
    .slice(-500)
    .map(projectPublicMessage)
    .filter((message): message is NonNullable<typeof message> => Boolean(message));
  return {
    id,
    publicReference,
    category,
    subject,
    status,
    createdAt,
    updatedAt,
    messages,
  };
}

function projectPublicMessage(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = readString(record, "id");
  const authorType = readString(record, "authorType");
  const body = readString(record, "body");
  const createdAt = readString(record, "createdAt");
  if (
    !id ||
    !["guest", "user", "operator", "system"].includes(authorType ?? "") ||
    body == null ||
    !createdAt
  ) {
    return null;
  }
  return { id, authorType, body: body.slice(0, 8_000), createdAt };
}

function parseRoute(request: Request):
  | { kind: "create" }
  | { kind: "ticket"; ticketId: string }
  | { kind: "messages"; ticketId: string }
  | { kind: "session"; ticketId: string }
  | null {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  const gatewayIndex = segments.lastIndexOf("support-gateway");
  const path = gatewayIndex >= 0 ? segments.slice(gatewayIndex + 1) : segments;
  if (path.length === 1 && path[0] === "tickets") return { kind: "create" };
  if (path.length === 2 && path[0] === "tickets") {
    return { kind: "ticket", ticketId: path[1] };
  }
  if (path.length === 3 && path[0] === "tickets" && path[2] === "messages") {
    return { kind: "messages", ticketId: path[1] };
  }
  if (path.length === 3 && path[0] === "tickets" && path[2] === "session") {
    return { kind: "session", ticketId: path[1] };
  }
  return null;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES) return null;
  const text = await request.text();
  if (!text || text.length > MAX_REQUEST_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function hmacHex(value: string): Promise<string> {
  const secret = Deno.env.get("SUPPORT_GUEST_SECRET_HMAC_KEY");
  if (!secret || secret.length < 32) throw new Error("support_hmac_not_configured");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const direct =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim();
  const value = forwarded || direct;
  return value && value.length <= 64 ? value : null;
}

function networkPrefix(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes(".")) {
    const parts = ip.split(".");
    return parts.length === 4 ? `${parts.slice(0, 3).join(".")}.0/24` : null;
  }
  if (ip.includes(":")) {
    return `${ip.split(":").slice(0, 4).join(":")}::/64`;
  }
  return null;
}

function boundedHeader(
  request: Request,
  name: string,
  maxLength: number,
): string | null {
  const value = request.headers.get(name)?.trim();
  return value && value.length <= maxLength ? value : null;
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true;
  return allowedOrigins().has(origin);
}

function allowedOrigins(): Set<string> {
  const configured =
    Deno.env.get("SUPPORT_ALLOWED_ORIGINS") ?? DEFAULT_ALLOWED_ORIGIN;
  return new Set(
    configured
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    vary: "Origin",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers":
      `authorization,apikey,content-type,${SUPPORT_SECRET_HEADER}`,
    "access-control-expose-headers": "retry-after",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  const origin = request.headers.get("origin");
  if (origin && isAllowedOrigin(origin)) {
    headers.set("access-control-allow-origin", origin);
  }
  return headers;
}

function jsonResponse(
  body: unknown,
  status: number,
  request: Request,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = corsHeaders(request);
  headers.set("content-type", "application/json; charset=utf-8");
  for (const [name, value] of Object.entries(extraHeaders ?? {})) {
    headers.set(name, value);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function safeResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === "object"
    ? (nested as Record<string, unknown>)
    : null;
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
