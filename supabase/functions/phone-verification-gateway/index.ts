import { createClient } from "npm:@supabase/supabase-js@2.105.1";

const MAX_BODY_BYTES = 4_000;

type GatewayBody = {
  action?: unknown;
  phone?: unknown;
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return corsResponse(request, null, 204);
  if (request.method !== "POST") return corsResponse(request, { ok: false, error: "method_not_allowed" }, 405);

  const raw = await request.text();
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return corsResponse(request, { ok: false, error: "invalid_request" }, 400);
  }

  let body: GatewayBody;
  try {
    body = JSON.parse(raw) as GatewayBody;
  } catch {
    return corsResponse(request, { ok: false, error: "invalid_request" }, 400);
  }

  const token = bearerToken(request.headers.get("authorization"));
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const hmacSecret = Deno.env.get("PHONE_CLAIM_HMAC_SECRET");
  if (!token || !supabaseUrl || !publicKey || !serviceRoleKey || !hmacSecret) {
    return corsResponse(request, { ok: false, error: "not_configured" }, 503);
  }

  const authClient = createClient(supabaseUrl, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) {
    return corsResponse(request, { ok: false, error: "unauthorized" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const action = body.action;

  if (action === "capability") {
    const result = await admin.rpc("phone_verification_policy_read");
    if (result.error) return corsResponse(request, { ok: false, error: "unavailable" }, 503);
    return corsResponse(request, { ok: true, policy: result.data }, 200);
  }

  if (action === "cancel") {
    const result = await admin.rpc("phone_verification_claim_cancel_internal", {
      p_user_id: authData.user.id,
    });
    if (result.error) return corsResponse(request, { ok: false, error: "unavailable" }, 503);
    return corsResponse(request, { ok: true }, 200);
  }

  if (action !== "begin") {
    return corsResponse(request, { ok: false, error: "invalid_request" }, 400);
  }

  const phone = normalizeE164(body.phone);
  if (!phone) return corsResponse(request, { ok: false, error: "invalid_phone" }, 400);
  const phoneHmac = await hmacSha256(phone, hmacSecret);
  const result = await admin.rpc("phone_verification_claim_begin_internal", {
    p_user_id: authData.user.id,
    p_phone_hmac: phoneHmac,
  });
  if (result.error) return corsResponse(request, { ok: false, error: "unavailable" }, 503);
  if (result.data !== "created") {
    const status = result.data === "phone_in_use" ? 409 : 403;
    return corsResponse(request, { ok: false, error: result.data }, status);
  }
  return corsResponse(request, { ok: true }, 200);
});

function normalizeE164(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[\s()-]/gu, "");
  return /^\+[1-9]\d{7,14}$/u.test(normalized) ? normalized : null;
}

function bearerToken(value: string | null): string | null {
  const match = value?.match(/^Bearer\s+(.+)$/iu);
  return match?.[1]?.trim() || null;
}

async function hmacSha256(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function corsResponse(request: Request, body: unknown, status: number): Response {
  const allowedOrigin = allowedCorsOrigin(request.headers.get("origin"));
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(body === null ? {} : { "content-type": "application/json; charset=utf-8" }),
      ...(allowedOrigin ? { "access-control-allow-origin": allowedOrigin } : {}),
      "access-control-allow-headers": "authorization, content-type, apikey",
      "access-control-allow-methods": "POST, OPTIONS",
      vary: "Origin",
    },
  });
}

function allowedCorsOrigin(origin: string | null): string | null {
  if (!origin) return null;
  const configured = (Deno.env.get("KUB_PUBLIC_ORIGINS") ?? "https://app.letscube.ru")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.includes(origin) ? origin : null;
}
