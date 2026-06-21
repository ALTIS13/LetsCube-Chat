type GatewayAction = "signup" | "recovery";

type RequestBody = {
  action?: unknown;
  email?: unknown;
  password?: unknown;
  fullName?: unknown;
  captchaToken?: unknown;
  redirectTo?: unknown;
};

const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 80;
const MAX_PASSWORD_LENGTH = 1024;
const MAX_TOKEN_LENGTH = 4096;

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return corsResponse(null, 204, request);
  if (request.method !== "POST") return corsJson({ ok: false, error: "method_not_allowed" }, 405, request);

  const body = await readBody(request);
  const action = normalizeAction(body?.action);
  if (!action) return corsJson({ ok: false, error: "bad_request" }, 400, request);

  const email = normalizeEmail(body?.email);
  if (!email) return corsJson({ ok: false, error: "invalid_email" }, 400, request);

  const captchaToken = normalizeToken(body?.captchaToken);
  if (!captchaToken) return corsJson({ ok: false, error: "captcha_required" }, 400, request);

  const captcha = await verifyYandexSmartCaptcha(captchaToken, clientIp(request));
  if (!captcha.ok) return corsJson({ ok: false, error: captcha.error }, captcha.status, request);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = readSupabasePublicKey();
  if (!supabaseUrl || !supabaseKey) {
    return corsJson({ ok: false, error: "not_configured" }, 500, request);
  }

  const redirectTo = safeRedirectTo(request, body?.redirectTo);

  if (action === "signup") {
    const password = normalizePassword(body?.password);
    if (!password) return corsJson({ ok: false, error: "invalid_password" }, 400, request);

    const fullName = normalizeFullName(body?.fullName);
    if (!fullName) return corsJson({ ok: false, error: "invalid_name" }, 400, request);

    const authResponse = await callAuthEndpoint(supabaseUrl, supabaseKey, "signup", {
      redirectTo,
      body: {
        email,
        password,
        data: { full_name: fullName },
      },
    });

    if (!authResponse.ok && !isExistingAccountError(authResponse.body)) {
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

function safeRedirectTo(request: Request, value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    const allowedOrigins = allowedRedirectOrigins(request);
    if (!allowedOrigins.has(url.origin)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function allowedRedirectOrigins(request: Request) {
  const values = new Set<string>();
  const configured = Deno.env.get("KUB_AUTH_ALLOWED_REDIRECT_ORIGINS");
  for (const origin of (configured || "").split(",")) {
    const trimmed = origin.trim().replace(/\/+$/g, "");
    if (trimmed) values.add(trimmed);
  }

  const requestOrigin = request.headers.get("origin");
  if (requestOrigin) values.add(requestOrigin.replace(/\/+$/g, ""));
  return values;
}

function clientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip") || null;
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

function corsJson(body: Record<string, unknown>, status: number, request: Request) {
  return corsResponse(JSON.stringify(body), status, request, {
    "content-type": "application/json; charset=utf-8",
  });
}

function corsResponse(body: BodyInit | null, status: number, request: Request, headers: HeadersInit = {}) {
  const origin = request.headers.get("origin") || "*";
  return new Response(body, {
    status,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, apikey, content-type",
      vary: "Origin",
      ...headers,
    },
  });
}
