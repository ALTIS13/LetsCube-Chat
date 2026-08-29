import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const lifecycleKind = (inviteCode) => (inviteCode ? "invite" : "public");

export const normalizeLifecycleUserId = (user) =>
  user && typeof user.id === "string" && UUID.test(user.id) ? user.id : null;

export const lifecycleRpcBody = (userId, kind, inviteCode) => ({
  p_user_id: userId,
  p_signup_kind: kind,
  p_invite_code_hash: inviteCode
    ? createHash("sha256").update(inviteCode).digest("hex")
    : null,
});

export async function resendSignupAndExtend({
  supabaseUrl,
  supabaseKey,
  serviceRoleKey,
  email,
  redirectTo,
  fetchImpl = fetch,
  log = console.error,
}) {
  let authResponse;
  try {
    authResponse = await fetchImpl(new URL("/auth/v1/resend", supabaseUrl), {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        authorization: `Bearer ${supabaseKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "signup",
        email,
        options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
      }),
    });
  } catch {
    return { ok: false, status: 503 };
  }

  if (!authResponse.ok) return { ok: false, status: authResponse.status };

  if (!serviceRoleKey) {
    log("auth-yandex-gateway lifecycle extension failed", { status: 503, code: "not_configured" });
    return { ok: true };
  }

  let lifecycleResponse;
  try {
    lifecycleResponse = await fetchImpl(
      new URL("/rest/v1/rpc/registration_lifecycle_extend_by_email_internal", supabaseUrl),
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ p_email: email }),
      },
    );
  } catch {
    log("auth-yandex-gateway lifecycle extension failed", { status: 503, code: "request_failed" });
    return { ok: true };
  }

  if (!lifecycleResponse.ok) {
    log("auth-yandex-gateway lifecycle extension failed", {
      status: lifecycleResponse.status,
      code: await lifecycleErrorCode(lifecycleResponse),
    });
  }
  return { ok: true };
}

async function lifecycleErrorCode(response) {
  try {
    const body = await response.json();
    return typeof body?.code === "string" ? body.code.slice(0, 80) : "lifecycle_error";
  } catch {
    return "lifecycle_error";
  }
}
