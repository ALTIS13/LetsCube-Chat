import { createClient } from "npm:@supabase/supabase-js@2.105.1";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { sendSmsRu } from "./smsRu.mjs";

const MAX_BODY_BYTES = 12_000;

type SendSmsEvent = {
  user?: { id?: unknown; phone?: unknown };
  sms?: { otp?: unknown };
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return safeError(405, "method_not_allowed");

  const rawBody = await request.text();
  if (!rawBody || new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return safeError(400, "invalid_request");
  }

  const hookSecret = Deno.env.get("SEND_SMS_HOOK_SECRET");
  if (!hookSecret) return safeError(503, "not_configured");

  let event: SendSmsEvent;
  try {
    const secret = hookSecret.replace(/^v1,whsec_/, "");
    event = new Webhook(secret).verify(rawBody, Object.fromEntries(request.headers)) as SendSmsEvent;
  } catch {
    return safeError(401, "invalid_signature");
  }

  const userId = readUuid(event.user?.id);
  const phone = readE164(event.user?.phone);
  const otp = readOtp(event.sms?.otp);
  const webhookId = request.headers.get("webhook-id")?.trim() ?? "";
  if (!userId || !phone || !otp || !webhookId || webhookId.length > 200) {
    return safeError(400, "invalid_request");
  }

  // This repository stage is intentionally fail-closed. Merely deploying the
  // function cannot contact SMS.RU until the provider approval gate is opened.
  if (Deno.env.get("SMS_DELIVERY_ENABLED") !== "true") {
    return safeError(503, "delivery_disabled");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const claimHmacSecret = Deno.env.get("PHONE_CLAIM_HMAC_SECRET");
  const apiId = Deno.env.get("SMS_RU_API_ID");
  if (!supabaseUrl || !serviceRoleKey || !claimHmacSecret || !apiId) {
    return safeError(503, "not_configured");
  }

  const phoneHmac = await hmacSha256(phone, claimHmacSecret);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authorization = await admin.rpc("phone_verification_claim_authorize_sms", {
    p_user_id: userId,
    p_phone_hmac: phoneHmac,
    p_webhook_id: webhookId,
  });
  if (authorization.error) return safeError(503, "claim_check_failed");
  if (authorization.data === "duplicate") return Response.json({}, { status: 200 });
  if (authorization.data !== "authorized") return safeError(403, "claim_required");

  const result = await sendSmsRu({
    enabled: true,
    apiId,
    phone,
    otp,
    sender: Deno.env.get("SMS_RU_SENDER_APPROVED") === "true" ? "LETSCUBE" : undefined,
  });

  await admin.rpc("phone_verification_sms_event_finish", {
    p_webhook_id: webhookId,
    p_result_category: result.category,
    p_accepted: result.ok,
  });

  return result.ok ? Response.json({}, { status: 200 }) : safeError(503, result.category);
});

function safeError(status: number, category: string): Response {
  return Response.json({ error: { http_code: status, message: category } }, { status });
}

function readUuid(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(text)
    ? text
    : null;
}

function readE164(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\+\d{8,15}$/u.test(text) ? text : null;
}

function readOtp(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d{6}$/u.test(text) ? text : null;
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
