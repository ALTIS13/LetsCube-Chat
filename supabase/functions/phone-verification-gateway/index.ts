import { createClient } from "npm:@supabase/supabase-js@2.105.1";
import { sendP1Sms } from "../auth-send-sms/p1sms.mjs";

const MAX_BODY_BYTES = 4_000;

type GatewayBody = {
  action?: unknown;
  phone?: unknown;
  code?: unknown;
  target_user_id?: unknown;
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return corsResponse(request, null, 204);
  if (request.method !== "POST") {
    return corsResponse(request, { ok: false, error: "method_not_allowed" }, 405);
  }

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
  if (!token) return corsResponse(request, { ok: false, error: "unauthorized" }, 401);
  if (!supabaseUrl || !publicKey || !serviceRoleKey || !hmacSecret) {
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

  if (action === "remove") {
    const result = await admin.rpc("profile_phone_remove_internal", {
      p_user_id: authData.user.id,
    });
    if (result.error) return corsResponse(request, { ok: false, error: "unavailable" }, 503);
    return corsResponse(request, { ok: true }, 200);
  }

  if (action === "admin_remove") {
    // Removing someone else's number is the one action here that is still
    // administrator-only. It used to be covered by a blanket check in front of
    // every action, which also blocked users from verifying their own number at
    // all; the check now guards this branch alone. `admin_profile_phone_remove_internal`
    // repeats the permission check server-side, so this is defence in depth
    // rather than the only barrier.
    const adminAccess = await admin.rpc("phone_verification_admin_access_internal", {
      p_user_id: authData.user.id,
    });
    if (adminAccess.error) return corsResponse(request, { ok: false, error: "unavailable" }, 503);
    if (adminAccess.data !== true) {
      return corsResponse(request, { ok: false, error: "disabled" }, 403);
    }

    const targetUserId = readUuid(body.target_user_id);
    if (!targetUserId) {
      return corsResponse(request, { ok: false, error: "invalid_user" }, 400);
    }
    const result = await admin.rpc("admin_profile_phone_remove_internal", {
      p_actor_id: authData.user.id,
      p_target_user_id: targetUserId,
    });
    if (result.error) return corsResponse(request, { ok: false, error: "unavailable" }, 503);
    if (result.data !== "removed") {
      return corsResponse(
        request,
        { ok: false, error: result.data },
        result.data === "disabled" ? 403 : 400,
      );
    }
    return corsResponse(request, { ok: true }, 200);
  }

  const phone = normalizeE164(body.phone);
  if (!phone) return corsResponse(request, { ok: false, error: "invalid_phone" }, 400);
  const phoneHmac = await hmacSha256(phone, hmacSecret);

  if (action === "verify") {
    const code = readFourDigitOtp(body.code);
    if (!code) return corsResponse(request, { ok: false, error: "invalid_code" }, 400);

    const otpHmac = await hmacSha256(
      `phone-otp:v1:${authData.user.id}:${phoneHmac}:${code}`,
      hmacSecret,
    );
    const verification = await admin.rpc("phone_verification_code_verify_internal", {
      p_user_id: authData.user.id,
      p_phone_hmac: phoneHmac,
      p_otp_hmac: otpHmac,
    });
    if (verification.error) {
      return corsResponse(request, { ok: false, error: "unavailable" }, 503);
    }
    if (verification.data !== "valid") {
      return corsResponse(
        request,
        { ok: false, error: verification.data },
        verification.data === "invalid_code" ? 400 : 409,
      );
    }

    const authUpdate = await admin.auth.admin.updateUserById(authData.user.id, {
      phone,
      phone_confirm: true,
    });
    if (authUpdate.error) {
      const conflict = isPhoneConflict(authUpdate.error.message);
      return corsResponse(
        request,
        { ok: false, error: conflict ? "phone_in_use" : "unavailable" },
        conflict ? 409 : 503,
      );
    }

    const finalized = await admin.rpc("phone_verification_profile_finalize_internal", {
      p_user_id: authData.user.id,
      p_phone_hmac: phoneHmac,
      p_otp_hmac: otpHmac,
    });
    if (finalized.error || finalized.data !== "verified") {
      return corsResponse(request, { ok: false, error: "unavailable" }, 503);
    }
    return corsResponse(request, { ok: true }, 200);
  }

  if (action !== "begin") {
    return corsResponse(request, { ok: false, error: "invalid_request" }, 400);
  }

  if (Deno.env.get("SMS_DELIVERY_ENABLED") !== "true") {
    return corsResponse(request, { ok: false, error: "delivery_unavailable" }, 503);
  }
  const p1SmsApiKey = Deno.env.get("P1SMS_API_KEY");
  if (!p1SmsApiKey) return corsResponse(request, { ok: false, error: "not_configured" }, 503);

  const existingPhone = await admin
    .from("profile_contacts")
    .select("user_id")
    .eq("phone", phone)
    .eq("phone_verified", true)
    .neq("user_id", authData.user.id)
    .limit(1)
    .maybeSingle();
  if (existingPhone.error) return corsResponse(request, { ok: false, error: "unavailable" }, 503);
  if (existingPhone.data) return corsResponse(request, { ok: false, error: "phone_in_use" }, 409);

  const claim = await admin.rpc("phone_verification_claim_begin_internal", {
    p_user_id: authData.user.id,
    p_phone_hmac: phoneHmac,
  });
  if (claim.error) return corsResponse(request, { ok: false, error: "unavailable" }, 503);
  if (claim.data !== "created") {
    const status = claim.data === "phone_in_use" ? 409 : claim.data === "rate_limited" ? 429 : 403;
    return corsResponse(
      request,
      { ok: false, error: claim.data },
      status,
    );
  }

  const otp = generateFourDigitOtp();
  const otpHmac = await hmacSha256(
    `phone-otp:v1:${authData.user.id}:${phoneHmac}:${otp}`,
    hmacSecret,
  );
  const prepared = await admin.rpc("phone_verification_code_prepare_internal", {
    p_user_id: authData.user.id,
    p_phone_hmac: phoneHmac,
    p_otp_hmac: otpHmac,
  });
  if (prepared.error || prepared.data !== "prepared") {
    await cancelClaim(admin, authData.user.id);
    return corsResponse(request, { ok: false, error: "unavailable" }, 503);
  }

  const deliveryId = crypto.randomUUID();
  const authorization = await admin.rpc("phone_verification_claim_authorize_sms", {
    p_user_id: authData.user.id,
    p_phone_hmac: phoneHmac,
    p_webhook_id: deliveryId,
  });
  if (authorization.error || authorization.data !== "authorized") {
    await cancelClaim(admin, authData.user.id);
    const category = authorization.data === "rate_limited" ? "rate_limited" : "unavailable";
    return corsResponse(request, { ok: false, error: category }, category === "rate_limited" ? 429 : 503);
  }

  const delivery = await sendP1Sms({
    enabled: true,
    apiKey: p1SmsApiKey,
    phone,
    otp,
  });
  await admin.rpc("phone_verification_sms_event_finish", {
    p_webhook_id: deliveryId,
    p_result_category: delivery.category,
    p_accepted: delivery.ok,
  });

  if (!delivery.ok && delivery.category !== "timeout_unknown") {
    await cancelClaim(admin, authData.user.id);
    return corsResponse(request, { ok: false, error: "delivery_unavailable" }, 503);
  }

  return corsResponse(
    request,
    { ok: true, delivery: delivery.ok ? "accepted" : "unconfirmed" },
    200,
  );
});

function generateFourDigitOtp(): string {
  let value = 0;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (value >= 4_294_960_000);
  return (value % 10_000).toString().padStart(4, "0");
}

function readFourDigitOtp(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim() : "";
  return /^\d{4}$/u.test(code) ? code : null;
}

function readUuid(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)
    ? id
    : null;
}

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

async function cancelClaim(admin: ReturnType<typeof createClient>, userId: string): Promise<void> {
  await admin.rpc("phone_verification_claim_cancel_internal", { p_user_id: userId });
}

function isPhoneConflict(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("phone") && (normalized.includes("already") || normalized.includes("unique"));
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
