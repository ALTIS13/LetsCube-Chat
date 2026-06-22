import { createAuthRateLimiter } from "./rateLimit.mjs";
import { normalizeInviteCode, shouldValidateInviteGate } from "./inviteCode.mjs";

type GatewayAction = "signup" | "recovery";

type RequestBody = {
  action?: unknown;
  email?: unknown;
  password?: unknown;
  fullName?: unknown;
  captchaToken?: unknown;
  inviteCode?: unknown;
  redirectTo?: unknown;
};

const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 80;
const MAX_PASSWORD_LENGTH = 1024;
const MAX_TOKEN_LENGTH = 4096;
const rateLimiter = createAuthRateLimiter({
  windowMs: readPositiveEnvSeconds("KUB_AUTH_GATEWAY_RATE_WINDOW_SECONDS", 15 * 60) * 1000,
  emailLimit: readPositiveEnvInteger("KUB_AUTH_GATEWAY_EMAIL_LIMIT", 5),
  ipLimit: readPositiveEnvInteger("KUB_AUTH_GATEWAY_IP_LIMIT", 30),
});

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return corsResponse(null, 204, request);
  if (request.method !== "POST") return corsJson({ ok: false, error: "method_not_allowed" }, 405, request);

  const body = await readBody(request);
  const action = normalizeAction(body?.action);
  if (!action) return corsJson({ ok: false, error: "bad_request" }, 400, request);

  const email = normalizeEmail(body?.email);
  if (!email) return corsJson({ ok: false, error: "invalid_email" }, 400, request);

  const ip = clientIp(request);
  const rateLimit = rateLimiter.check({ action, email, ip });
  if (!rateLimit.ok) {
    return corsJson({ ok: false, error: "rate_limited" }, 429, request, {
      "retry-after": String(rateLimit.retryAfterSeconds),
    });
  }

  const captchaToken = normalizeToken(body?.captchaToken);
  if (!captchaToken) return corsJson({ ok: false, error: "captcha_required" }, 400, request);

  const captcha = await verifyYandexSmartCaptcha(captchaToken, ip);
  if (!captcha.ok) return corsJson({ ok: false, error: captcha.error }, captcha.status, request);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = readSupabasePublicKey();
  if (!supabaseUrl || !supabaseKey) {
    return corsJson({ ok: false, error: "not_configured" }, 500, request);
  }

  const redirectTo = safeRedirectTo(body?.redirectTo);

  if (action === "signup") {
    const password = normalizePassword(body?.password);
    if (!password) return corsJson({ ok: false, error: "invalid_password" }, 400, request);

    const fullName = normalizeFullName(body?.fullName);
    if (!fullName) return corsJson({ ok: false, error: "invalid_name" }, 400, request);

    const rawInviteCode = body?.inviteCode;
    const inviteCode = normalizeInviteCode(rawInviteCode);
    const inviteRequired = readBooleanEnv("KUB_AUTH_SIGNUP_INVITE_REQUIRED", false);
    if (rawInviteCode != null && String(rawInviteCode).trim() && !inviteCode) {
      return corsJson({ ok: false, error: "invite_invalid" }, 400, request);
    }
    if (shouldValidateInviteGate(action)) {
      const invite = await validateInviteSignupGate(supabaseUrl, supabaseKey, inviteCode, inviteRequired);
      if (!invite.ok) return corsJson({ ok: false, error: invite.error }, invite.status, request);
    }

    const authResponse = await callAuthEndpoint(supabaseUrl, supabaseKey, "signup", {
      redirectTo,
      body: {
        email,
        password,
        data: {
          full_name: fullName,
          ...(inviteCode ? { invite_code: inviteCode } : {}),
        },
      },
    });

    if (!authResponse.ok && !isExistingAccountError(authResponse.body)) {
      const inviteError = readInviteError(authResponse.body);
      if (inviteError) return corsJson({ ok: false, error: inviteError }, 400, request);
      console.error("auth-yandex-gateway signup failed", summarizeAuthError(authResponse.status, authResponse.body));
      return corsJson({ ok: false, error: "auth_failed" }, 400, request);
    }
    return corsJson({ ok: true }, 200, request);
  }

  const authResponse = await callAuthEndpoint(supabaseUrl, supabaseKey, "recover", {
    redirectTo,
    body: { email },
  });
  if (!authResponse.ok) {
    console.error("auth-yandex-gateway recovery failed", summarizeAuthError(authResponse.status, authResponse.body));
    return corsJson({ ok: false, error: "auth_failed" }, 400, request);
  }
  return corsJson({ ok: true }, 200, request);
});

async function readBody(request: Request): Promise<RequestBody | null> {
  const text = await request.text();
  if (!text.trim() || text.length > 12_000) return null;
  try {
    return JSON.parse(text) as RequestBody;
  } catch {
    return null;
  }
}

function normalizeAction(value: unknown): GatewayAction | null {
  return value === "signup" || value === "recovery" ? value : null;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function normalizePassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length < 6 || value.length > MAX_PASSWORD_LENGTH) return null;
  return value;
}

function normalizeFullName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const fullName = value.trim().replace(/\s+/g, " ");
  if (fullName.length < 2 || fullName.length > MAX_NAME_LENGTH) return null;
  return fullName;
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

async function verifyYandexSmartCaptcha(token: string, ip: string | null): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const secret = Deno.env.get("YANDEX_SMARTCAPTCHA_SECRET");
  if (!secret) return { ok: false, error: "not_configured", status: 500 };

  const params = new URLSearchParams();
  params.set("secret", secret);
  params.set("token", token);
  if (ip) params.set("ip", ip);

  let response: Response;
  try {
    response = await fetch("https://smartcaptcha.cloud.yandex.ru/validate", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
    });
  } catch {
    return { ok: false, error: "captcha_failed", status: 503 };
  }

  if (!response.ok) return { ok: false, error: "captcha_failed", status: 503 };

  try {
    const result = (await response.json()) as { status?: string };
    return result.status === "ok"
      ? { ok: true }
      : { ok: false, error: "captcha_failed", status: 400 };
  } catch {
    return { ok: false, error: "captcha_failed", status: 503 };
  }
}

function readSupabasePublicKey() {
  return (
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
    Deno.env.get("SUPABASE_ANON_KEY") ||
    Deno.env.get("ANON_KEY") ||
    ""
  );
}

async function callAuthEndpoint(
  supabaseUrl: string,
  supabaseKey: string,
  endpoint: "signup" | "recover",
  payload: { redirectTo?: string; body: Record<string, unknown> },
) {
  const url = new URL(`/auth/v1/${endpoint}`, supabaseUrl);
  if (payload.redirectTo) url.searchParams.set("redirect_to", payload.redirectTo);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      authorization: `Bearer ${supabaseKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload.body),
  });

  return {
    ok: response.ok,
    status: response.status,
    body: await readRemoteJson(response),
  };
}

async function readRemoteJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function safeRedirectTo(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    const allowedOrigins = configuredRedirectOrigins();
    if (!allowedOrigins.has(url.origin)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function configuredRedirectOrigins() {
  const values = new Set<string>();
  const configured = Deno.env.get("KUB_AUTH_ALLOWED_REDIRECT_ORIGINS");
  for (const origin of (configured || "").split(",")) {
    const trimmed = origin.trim().replace(/\/+$/g, "");
    if (trimmed) values.add(trimmed);
  }
  return values;
}

function allowedCorsOrigin(request: Request): string {
  const origin = request.headers.get("origin")?.replace(/\/+$/g, "");
  if (!origin) return "*";

  const allowedOrigins = configuredRedirectOrigins();
  if (allowedOrigins.size === 0 || allowedOrigins.has(origin)) return origin;

  return "null";
}

function clientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip") || null;
}

function readPositiveEnvSeconds(name: string, fallback: number): number {
  return readPositiveEnvInteger(name, fallback);
}

function readPositiveEnvInteger(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = Deno.env.get(name);
  if (value == null) return fallback;
  return ["1", "true", "on", "yes"].includes(value.trim().toLowerCase());
}

function isExistingAccountError(error: Record<string, unknown>) {
  const code = String(error.code || "").toLowerCase();
  const message = String(error.message || error.msg || "").toLowerCase();
  return code === "user_already_exists" || message.includes("already registered") || message.includes("already exists");
}

function summarizeAuthError(status: number, error: Record<string, unknown>) {
  return {
    status,
    code: String(error.code || "auth_error").slice(0, 80),
    message: String(error.message || error.msg || "auth error").slice(0, 160),
  };
}

async function validateInviteCode(
  supabaseUrl: string,
  supabaseKey: string,
  inviteCode: string | null,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const url = new URL("/rest/v1/rpc/registration_invite_validate", supabaseUrl);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        authorization: `Bearer ${supabaseKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_code: inviteCode }),
    });
  } catch {
    return { ok: false, error: "invite_not_configured", status: 503 };
  }

  if (!response.ok) {
    console.error("auth-yandex-gateway invite validation unavailable", {
      status: response.status,
    });
    return { ok: false, error: "invite_not_configured", status: 500 };
  }

  const body = await readRemoteJson(response);
  const row = Array.isArray(body) ? body[0] : body;
  if (row && typeof row === "object" && "ok" in row) {
    const result = row as { ok?: unknown; error?: unknown };
    if (result.ok === true) return { ok: true };
    const error = typeof result.error === "string" ? result.error : "invite_invalid";
    return { ok: false, error, status: 400 };
  }
  return { ok: false, error: "invite_invalid", status: 400 };
}

async function validateInviteSignupGate(
  supabaseUrl: string,
  supabaseKey: string,
  inviteCode: string | null,
  strictFallback: boolean,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const url = new URL("/rest/v1/rpc/registration_invite_signup_gate", supabaseUrl);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        authorization: `Bearer ${supabaseKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_code: inviteCode }),
    });
  } catch {
    if (!inviteCode && strictFallback) return { ok: false, error: "invite_required", status: 400 };
    if (inviteCode || strictFallback) return validateInviteCode(supabaseUrl, supabaseKey, inviteCode);
    return { ok: true };
  }

  const body = await readRemoteJson(response);
  if (!response.ok) {
    if (isMissingInviteGateRpc(response.status, body)) {
      if (!inviteCode && strictFallback) return { ok: false, error: "invite_required", status: 400 };
      if (inviteCode || strictFallback) return validateInviteCode(supabaseUrl, supabaseKey, inviteCode);
      return { ok: true };
    }
    console.error("auth-yandex-gateway invite gate unavailable", { status: response.status });
    return { ok: false, error: "invite_not_configured", status: 500 };
  }

  const row = Array.isArray(body) ? body[0] : body;
  if (row && typeof row === "object" && "ok" in row) {
    const result = row as { ok?: unknown; error?: unknown };
    if (result.ok === true) return { ok: true };
    const error = typeof result.error === "string" ? result.error : "invite_invalid";
    return { ok: false, error, status: 400 };
  }
  return { ok: false, error: "invite_invalid", status: 400 };
}

function isMissingInviteGateRpc(status: number, error: Record<string, unknown>) {
  const text = [
    String(error.code || ""),
    String(error.error || ""),
    String(error.message || ""),
    String(error.msg || ""),
    String(error.details || ""),
    String(error.hint || ""),
  ].join(" ").toLowerCase();
  return (
    status === 404 ||
    text.includes("pgrst202") ||
    text.includes("42883") ||
    (text.includes("registration_invite_signup_gate") && text.includes("function"))
  );
}

function readInviteError(error: Record<string, unknown>): string | null {
  const text = [
    String(error.code || ""),
    String(error.error || ""),
    String(error.message || ""),
    String(error.msg || ""),
  ]
    .join(" ")
    .toLowerCase();
  for (const code of ["invite_required", "invite_invalid", "invite_expired", "invite_used", "invite_not_configured"]) {
    if (text.includes(code)) return code;
  }
  return null;
}

function corsJson(body: Record<string, unknown>, status: number, request: Request, headers: HeadersInit = {}) {
  return corsResponse(JSON.stringify(body), status, request, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
}

function corsResponse(body: BodyInit | null, status: number, request: Request, headers: HeadersInit = {}) {
  return new Response(body, {
    status,
    headers: {
      "access-control-allow-origin": allowedCorsOrigin(request),
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, apikey, content-type",
      vary: "Origin",
      ...headers,
    },
  });
}
