import webpush from "npm:web-push@3.6.7";
import { buildFcmMessage, isPermanentFcmTokenError } from "./fcm.ts";
import {
  buildDeclarativeWebPushPayload,
  createWebPushTopic,
  getWebPushUrgency,
  isPermanentWebPushSubscriptionError,
  readWebPushErrorReason,
} from "./webpush.ts";

type OutboxRow = {
  id: string;
  subscription_id: string;
  payload: Record<string, unknown>;
  attempt_count: number;
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  is_active?: boolean;
};

type NativeOutboxRow = {
  id: string;
  device_id: string;
  payload: Record<string, unknown>;
  attempt_count: number;
};

type PushDeviceRow = {
  id: string;
  token: string;
  enabled: boolean;
  revoked_at?: string | null;
};

type FcmConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_ATTEMPTS = 5;

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const dispatchToken = Deno.env.get("KUB_PUSH_DISPATCH_TOKEN");
  if (dispatchToken && !isAuthorized(request, dispatchToken)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = readSupabaseSecretKey();
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@kub.local";
  const webPushAppOrigin = Deno.env.get("WEB_PUSH_APP_ORIGIN");
  if (!supabaseUrl || !secretKey) {
    return json({ ok: false, error: "supabase_runtime_env_not_configured" }, 500);
  }
  if (!vapidPublic || !vapidPrivate) {
    return json({ ok: false, error: "vapid_not_configured" }, 500);
  }

  const body = await readBody(request);
  const limit = normalizeLimit(body?.limit);
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const [rows, nativeRows] = await Promise.all([
    selectOutbox(supabaseUrl, secretKey, limit),
    selectNativeOutbox(supabaseUrl, secretKey, limit),
  ]);
  if (!rows.ok) return json(rows.body, rows.status);
  if (!nativeRows.ok) return json(nativeRows.body, nativeRows.status);

  const subscriptionIds = Array.from(new Set(rows.data.map((row) => row.subscription_id)));
  const subscriptions = await selectSubscriptions(supabaseUrl, secretKey, subscriptionIds);
  if (!subscriptions.ok) return json(subscriptions.body, subscriptions.status);
  const byId = new Map(subscriptions.data.map((item) => [item.id, item]));

  let sent = 0;
  let failed = 0;
  let pruned = 0;
  for (const row of rows.data) {
    const result = await deliver(supabaseUrl, secretKey, row, byId.get(row.subscription_id), webPushAppOrigin);
    if (result === "sent") sent += 1;
    else if (result === "pruned") pruned += 1;
    else failed += 1;
  }

  const native = await dispatchNativePush(
    supabaseUrl,
    secretKey,
    nativeRows.data,
    nativeRows.schemaMissing,
  );

  return json({ ok: true, sent, failed, pruned, limit, native });
});

function isAuthorized(request: Request, expectedToken: string) {
  const headerToken = request.headers.get("x-kub-push-token");
  const bearerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return headerToken === expectedToken || bearerToken === expectedToken;
}

function readSupabaseSecretKey() {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys) as Record<string, string>;
      return parsed.default || Object.values(parsed).find(Boolean) || "";
    } catch {
      return "";
    }
  }
  return Deno.env.get("SUPABASE_SECRET_KEY") || "";
}

async function readBody(request: Request): Promise<{ limit?: unknown } | null> {
  const text = await request.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as { limit?: unknown };
  } catch {
    return null;
  }
}

function normalizeLimit(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(value), MAX_LIMIT));
}

async function selectOutbox(supabaseUrl: string, secretKey: string, limit: number) {
  const url = new URL("/rest/v1/notifications_push_outbox", supabaseUrl);
  url.searchParams.set("select", "id,subscription_id,payload,attempt_count");
  url.searchParams.set("sent_at", "is.null");
  url.searchParams.set("attempt_count", `lt.${MAX_ATTEMPTS}`);
  url.searchParams.set("order", "created_at.asc");
  url.searchParams.set("limit", String(limit));
  const response = await restFetch(url, secretKey);
  if (!response.ok) return { ok: false as const, status: 500, body: await summarizeResponse(response) };
  return { ok: true as const, data: (await response.json()) as OutboxRow[] };
}

async function selectSubscriptions(supabaseUrl: string, secretKey: string, ids: string[]) {
  if (ids.length === 0) return { ok: true as const, data: [] as SubscriptionRow[] };
  const url = new URL("/rest/v1/push_subscriptions", supabaseUrl);
  url.searchParams.set("select", "id,endpoint,p256dh,auth,is_active");
  url.searchParams.set("id", `in.(${ids.join(",")})`);
  const response = await restFetch(url, secretKey);
  if (!response.ok) return { ok: false as const, status: 500, body: await summarizeResponse(response) };
  return { ok: true as const, data: (await response.json()) as SubscriptionRow[] };
}

async function selectNativeOutbox(supabaseUrl: string, secretKey: string, limit: number) {
  const url = new URL("/rest/v1/notifications_native_push_outbox", supabaseUrl);
  url.searchParams.set("select", "id,device_id,payload,attempt_count");
  url.searchParams.set("sent_at", "is.null");
  url.searchParams.set("attempt_count", `lt.${MAX_ATTEMPTS}`);
  url.searchParams.set("order", "created_at.asc");
  url.searchParams.set("limit", String(limit));
  const response = await restFetch(url, secretKey);
  if (response.ok) {
    return {
      ok: true as const,
      data: (await response.json()) as NativeOutboxRow[],
      schemaMissing: false,
    };
  }

  const text = await response.text();
  if (response.status === 404 || text.includes("notifications_native_push_outbox")) {
    return { ok: true as const, data: [] as NativeOutboxRow[], schemaMissing: true };
  }
  return {
    ok: false as const,
    status: 500,
    body: {
      ok: false,
      error: "native_push_outbox_query_failed",
      status: response.status,
    },
  };
}

async function selectPushDevices(supabaseUrl: string, secretKey: string, ids: string[]) {
  if (ids.length === 0) return { ok: true as const, data: [] as PushDeviceRow[] };
  const url = new URL("/rest/v1/user_push_devices", supabaseUrl);
  url.searchParams.set("select", "id,token,enabled,revoked_at");
  url.searchParams.set("id", `in.(${ids.join(",")})`);
  const response = await restFetch(url, secretKey);
  if (!response.ok) return { ok: false as const, status: response.status };
  return { ok: true as const, data: (await response.json()) as PushDeviceRow[] };
}

async function dispatchNativePush(
  supabaseUrl: string,
  secretKey: string,
  rows: NativeOutboxRow[],
  schemaMissing: boolean,
) {
  if (schemaMissing) {
    return { sent: 0, failed: 0, pruned: 0, pending: 0, status: "schema_pending" };
  }
  if (rows.length === 0) {
    return { sent: 0, failed: 0, pruned: 0, pending: 0, status: "idle" };
  }

  const config = readFcmConfig();
  if (!config) {
    return { sent: 0, failed: 0, pruned: 0, pending: rows.length, status: "credentials_pending" };
  }

  const deviceIds = Array.from(new Set(rows.map((row) => row.device_id)));
  const devices = await selectPushDevices(supabaseUrl, secretKey, deviceIds);
  if (!devices.ok) {
    return { sent: 0, failed: rows.length, pruned: 0, pending: rows.length, status: "device_query_failed" };
  }

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(config);
  } catch {
    return { sent: 0, failed: rows.length, pruned: 0, pending: rows.length, status: "fcm_auth_failed" };
  }

  const byId = new Map(devices.data.map((device) => [device.id, device]));
  let sent = 0;
  let failed = 0;
  let pruned = 0;
  for (const row of rows) {
    const result = await deliverFcm(
      supabaseUrl,
      secretKey,
      config.projectId,
      accessToken,
      row,
      byId.get(row.device_id),
    );
    if (result === "sent") sent += 1;
    else if (result === "pruned") pruned += 1;
    else failed += 1;
  }
  return { sent, failed, pruned, pending: failed, status: "ready" };
}

async function deliverFcm(
  supabaseUrl: string,
  secretKey: string,
  projectId: string,
  accessToken: string,
  row: NativeOutboxRow,
  device: PushDeviceRow | undefined,
): Promise<"sent" | "failed" | "pruned"> {
  if (!device || !device.enabled || device.revoked_at) {
    await markNativeOutbox(supabaseUrl, secretKey, row.id, {
      sent_at: new Date().toISOString(),
      last_error: "device_missing",
    });
    return "pruned";
  }

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildFcmMessage(row.payload, device.token)),
    },
  );

  if (response.ok) {
    await markNativeOutbox(supabaseUrl, secretKey, row.id, {
      sent_at: new Date().toISOString(),
      last_error: null,
    });
    return "sent";
  }

  const body = await readJson(response);
  if (isPermanentFcmTokenError(response.status, body)) {
    await patchRow(supabaseUrl, secretKey, "user_push_devices", device.id, {
      enabled: false,
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await markNativeOutbox(supabaseUrl, secretKey, row.id, {
      sent_at: new Date().toISOString(),
      last_error: `gone:${response.status}`,
    });
    return "pruned";
  }

  await markNativeOutbox(supabaseUrl, secretKey, row.id, {
    attempt_count: row.attempt_count + 1,
    last_error: `fcm:${response.status}:${readFcmErrorStatus(body)}`.slice(0, 160),
  });
  return "failed";
}

async function deliver(
  supabaseUrl: string,
  secretKey: string,
  row: OutboxRow,
  subscription: SubscriptionRow | undefined,
  webPushAppOrigin: string | undefined,
): Promise<"sent" | "failed" | "pruned"> {
  if (!subscription || subscription.is_active === false) {
    await markOutbox(supabaseUrl, secretKey, row.id, { sent_at: new Date().toISOString(), last_error: "subscription_missing" });
    return "pruned";
  }

  try {
    const legacyPayload = safePayload(row.payload);
    const topic = await createWebPushTopic(legacyPayload.tag);
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(buildDeclarativeWebPushPayload(legacyPayload, webPushAppOrigin)),
      {
        TTL: 60 * 60 * 24,
        urgency: getWebPushUrgency(legacyPayload.kind),
        ...(topic ? { topic } : {}),
      },
    );
    await markOutbox(supabaseUrl, secretKey, row.id, { sent_at: new Date().toISOString(), last_error: null });
    return "sent";
  } catch (error) {
    const status = typeof error === "object" && error ? (error as { statusCode?: number }).statusCode : undefined;
    const reason = readWebPushErrorReason(error);
    if (isPermanentWebPushSubscriptionError(status, reason)) {
      await patchRow(supabaseUrl, secretKey, "push_subscriptions", subscription.id, {
        is_active: false,
        updated_at: new Date().toISOString(),
      });
      await markOutbox(supabaseUrl, secretKey, row.id, {
        sent_at: new Date().toISOString(),
        last_error: `gone:${status ?? "unknown"}:${reason ?? "subscription_invalid"}`,
      });
      return "pruned";
    }

    await markOutbox(supabaseUrl, secretKey, row.id, {
      attempt_count: row.attempt_count + 1,
      last_error: `webpush:${status ?? "unknown"}:${reason ?? "unknown"}`,
    });
    return "failed";
  }
}

function safePayload(payload: Record<string, unknown>) {
  return {
    title: safeText(payload.title, "LETSCUBE", 80),
    body: safeText(payload.body, "Новое уведомление", 180),
    url: safeRelativeUrl(payload.url),
    tag: safeText(payload.tag, "kub-notification", 80),
    kind: safeText(payload.kind, "notification", 60),
    chatId: safeText(payload.chatId ?? payload.chat_id, "", 80),
    messageId: safeText(payload.messageId ?? payload.message_id, "", 80),
    renotify: typeof payload.renotify === "boolean" ? payload.renotify : true,
  };
}

function safeText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  if (!text || looksSensitive(text)) return fallback;
  return text.slice(0, maxLength);
}

function safeRelativeUrl(value: unknown) {
  if (typeof value !== "string" || looksSensitive(value)) return "/";
  try {
    const url = new URL(value, "https://kub.local");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

function looksSensitive(value: string) {
  const lower = value.toLowerCase();
  return (
    lower.includes("/storage/v1/") ||
    lower.includes(".supabase.co/storage") ||
    lower.includes("token=") ||
    lower.includes("password=") ||
    lower.includes("authorization=")
  );
}

async function markOutbox(supabaseUrl: string, secretKey: string, id: string, patch: Record<string, unknown>) {
  await patchRow(supabaseUrl, secretKey, "notifications_push_outbox", id, patch);
}

async function markNativeOutbox(supabaseUrl: string, secretKey: string, id: string, patch: Record<string, unknown>) {
  await patchRow(supabaseUrl, secretKey, "notifications_native_push_outbox", id, patch);
}

async function patchRow(
  supabaseUrl: string,
  secretKey: string,
  table:
    | "notifications_push_outbox"
    | "notifications_native_push_outbox"
    | "push_subscriptions"
    | "user_push_devices",
  id: string,
  patch: Record<string, unknown>,
) {
  const url = new URL(`/rest/v1/${table}`, supabaseUrl);
  url.searchParams.set("id", `eq.${id}`);
  await restFetch(url, secretKey, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

function readFcmConfig(): FcmConfig | null {
  const projectId = Deno.env.get("FCM_PROJECT_ID")?.trim();
  const clientEmail = Deno.env.get("FCM_CLIENT_EMAIL")?.trim();
  const privateKey = Deno.env.get("FCM_PRIVATE_KEY")?.replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

async function getGoogleAccessToken(config: FcmConfig): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const claims = base64UrlJson({
    iss: config.clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3600,
  });
  const unsignedToken = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(config.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken),
  );
  const assertion = `${unsignedToken}.${base64UrlBytes(new Uint8Array(signature))}`;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await readJson(response) as { access_token?: unknown } | null;
  if (!response.ok || typeof payload?.access_token !== "string") {
    throw new Error("fcm_oauth_failed");
  }
  return payload.access_token;
}

function base64UrlJson(value: Record<string, unknown>): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readFcmErrorStatus(body: unknown): string {
  if (!body || typeof body !== "object") return "unknown";
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return "unknown";
  const status = (error as { status?: unknown }).status;
  return typeof status === "string" ? status.slice(0, 60) : "unknown";
}

function restFetch(url: URL, secretKey: string, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    headers: {
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/json",
      prefer: "return=minimal",
      ...(init.headers ?? {}),
    },
  });
}

async function summarizeResponse(response: Response) {
  const text = await response.text();
  return {
    ok: false,
    error: "push_dispatch_failed",
    status: response.status,
    message: summarizeRemoteError(text),
  };
}

function summarizeRemoteError(text: string) {
  if (!text) return "empty response";
  try {
    const parsed = JSON.parse(text) as { message?: string; code?: string };
    return String(parsed.message || parsed.code || "domain error").slice(0, 160);
  } catch {
    return text.slice(0, 160);
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
