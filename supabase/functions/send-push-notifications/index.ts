// @ts-types="npm:@types/web-push@3.6.4"
import webpush from "npm:web-push@3.6.7";
import { drainAlbumPush, type AlbumPushDependencies, type AlbumPushSummary } from "./album-dispatch.ts";
import { buildFcmMessage, isPermanentFcmTokenError } from "./fcm.ts";
import { drainVoicePush, isVoiceRequestAuthorized, voiceSummary } from "./voice-dispatch.ts";
import {
  buildDeclarativeWebPushPayload,
  createWebPushTopic,
  getWebPushUrgency,
  isPermanentWebPushSubscriptionError,
  readWebPushErrorReason,
  type SafeWebPushPayload,
} from "./webpush.ts";
import {
  buildWnsToast,
  isAllowedWnsChannelUrl,
  isPermanentWnsChannelError,
  readWnsResponseStatus,
} from "./wns.ts";

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

type WebPushDeliveryStatus =
  | "deliver"
  | "foreground"
  | "read"
  | "subscription_inactive"
  | "claim_lost";

type NativePushDeliveryStatus = "deliver" | "read" | "device_inactive" | "claim_lost";

type NativeOutboxRow = {
  id: string;
  device_id: string;
  payload: Record<string, unknown>;
  attempt_count: number;
};

type PushDeviceRow = {
  id: string;
  token: string;
  provider: "fcm" | "apns" | "wns";
  enabled: boolean;
  revoked_at?: string | null;
  app_version?: string | null;
};

type FcmConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

type WnsConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const dispatchToken = Deno.env.get("KUB_PUSH_DISPATCH_TOKEN");
  if (dispatchToken && !isAuthorized(request, dispatchToken)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const body = await readBody(request);
  if (body?.scope === "voice") {
    if (!isVoiceRequestAuthorized(request, dispatchToken)) return json({ ok: false, error: "unauthorized" }, 401);
    return json({ ok: true, ...await dispatchVoice(body.limit) });
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

  const limit = normalizeLimit(body?.limit);
  const claimToken = crypto.randomUUID();
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const rows = await claimOutbox(supabaseUrl, secretKey, limit, claimToken);
  if (!rows.ok) return json(rows.body, rows.status);

  const subscriptionIds = Array.from(new Set(rows.data.map((row) => row.subscription_id)));
  const subscriptions = await selectSubscriptions(supabaseUrl, secretKey, subscriptionIds);
  if (!subscriptions.ok) return json(subscriptions.body, subscriptions.status);
  const byId = new Map(subscriptions.data.map((item) => [item.id, item]));

  let sent = 0;
  let failed = 0;
  let pruned = 0;
  for (const row of rows.data) {
    const result = await deliver(
      supabaseUrl,
      secretKey,
      claimToken,
      row,
      byId.get(row.subscription_id),
      webPushAppOrigin,
    );
    if (result === "sent") sent += 1;
    else if (result === "pruned") pruned += 1;
    else if (result === "deferred") continue;
    else failed += 1;
  }

  const nativeRows = await claimNativeOutbox(supabaseUrl, secretKey, limit, claimToken);
  if (!nativeRows.ok) return json(nativeRows.body, nativeRows.status);
  const native = await dispatchNativePush(
    supabaseUrl,
    secretKey,
    claimToken,
    nativeRows.data,
  );

  const album = Deno.env.get("ALBUM_PUSH_DISPATCH_ENABLED") === "1"
    ? await dispatchAlbumPush(supabaseUrl, secretKey, limit, webPushAppOrigin)
    : undefined;
  if (album?.status === "claim_failed" || album?.status === "claim_invalid") {
    return json({ ok: false, error: "album_push_claim_failed", album }, 500);
  }

  const voice = Deno.env.get("VOICE_PUSH_DISPATCH_ENABLED") === "1"
    ? isVoiceRequestAuthorized(request, Deno.env.get("KUB_PUSH_DISPATCH_TOKEN"))
      ? await dispatchVoice(body?.limit) : voiceSummary("unauthorized")
    : undefined;
  return json({ ok: true, sent, failed, pruned, limit, native, ...(album ? { album } : {}), ...(voice ? { voice } : {}) });
});

async function dispatchAlbumPush(
  supabaseUrl: string,
  secretKey: string,
  limit: number,
  webPushAppOrigin: string | undefined,
): Promise<AlbumPushSummary> {
  const subscriptions = new Map<string, SubscriptionRow>();
  const devices = new Map<string, PushDeviceRow>();
  let webLookupFailed = false;
  let deviceLookupFailed = false;
  let fcmAccessToken: Promise<string> | undefined;

  const deps: AlbumPushDependencies = {
    uuid: () => crypto.randomUUID(),
    claim: async (claimLimit, claimToken) => {
      const response = await restFetch(new URL("/rest/v1/rpc/album_push_claim", supabaseUrl), secretKey, {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({ p_limit: claimLimit, p_claim_token: claimToken }),
      });
      if (!response.ok) throw new Error("album_claim_failed");
      const rows = await response.json() as Array<{ subscription_id?: string | null; device_id?: string | null }>;
      if (!Array.isArray(rows)) return rows;
      const subscriptionIds = [...new Set(rows.map((row) => row.subscription_id).filter((id): id is string => typeof id === "string"))];
      const deviceIds = [...new Set(rows.map((row) => row.device_id).filter((id): id is string => typeof id === "string"))];
      const web = await selectSubscriptions(supabaseUrl, secretKey, subscriptionIds);
      const native = await selectPushDevices(supabaseUrl, secretKey, deviceIds);
      webLookupFailed = !web.ok;
      deviceLookupFailed = !native.ok;
      if (web.ok) for (const item of web.data) subscriptions.set(item.id, item);
      if (native.ok) for (const item of native.data) devices.set(item.id, item);
      return rows;
    },
    recheck: async (id, claimToken) => {
      const response = await restFetch(new URL("/rest/v1/rpc/album_push_recheck", supabaseUrl), secretKey, {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({ p_outbox_id: id, p_claim_token: claimToken }),
      });
      if (!response.ok) throw new Error("album_recheck_failed");
      const rows = await response.json() as unknown;
      return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    },
    ack: async (id, claimToken, outcome, error) => {
      const response = await restFetch(new URL("/rest/v1/rpc/album_push_ack", supabaseUrl), secretKey, {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({ p_outbox_id: id, p_claim_token: claimToken, p_outcome: outcome, p_error: error }),
      });
      return response.ok && await response.json() === true;
    },
    send: async (row, payload) => {
      if (row.subscription_id) {
        if (webLookupFailed) return { outcome: "release", error: "subscription_query_failed" };
        const subscription = subscriptions.get(row.subscription_id);
        if (!subscription || subscription.is_active === false) return { outcome: "gone", error: "subscription_missing" };
        const safe = safePayload(payload);
        try {
          const topic = await createWebPushTopic(safe.tag);
          await webpush.sendNotification(
            { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
            JSON.stringify(buildDeclarativeWebPushPayload(safe, webPushAppOrigin)),
            { TTL: 60 * 60 * 24, urgency: getWebPushUrgency(safe.kind), ...(topic ? { topic } : {}) },
          );
          return { outcome: "sent" };
        } catch (error) {
          const status = typeof error === "object" && error ? (error as { statusCode?: number }).statusCode : undefined;
          const reason = readWebPushErrorReason(error);
          if (isPermanentWebPushSubscriptionError(status, reason)) {
            await patchRow(supabaseUrl, secretKey, "push_subscriptions", subscription.id, {
              is_active: false, updated_at: new Date().toISOString(),
            });
            return { outcome: "gone", error: `webpush:${status ?? "unknown"}` };
          }
          return { outcome: "retry", error: `webpush:${status ?? "unknown"}` };
        }
      }

      if (deviceLookupFailed) return { outcome: "release", error: "device_query_failed" };
      const device = row.device_id ? devices.get(row.device_id) : undefined;
      if (!device || !device.enabled || device.revoked_at || device.provider !== "fcm") {
        return { outcome: "gone", error: "device_inactive" };
      }
      const config = readFcmConfig();
      if (!config) return { outcome: "release", error: "fcm_credentials_pending" };
      try {
        fcmAccessToken ??= getGoogleAccessToken(config);
        const accessToken = await fcmAccessToken;
        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`,
          {
            method: "POST",
            signal: AbortSignal.timeout(15000),
            headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
            body: JSON.stringify(buildFcmMessage(payload, device.token, device.app_version)),
          },
        );
        if (response.ok) return { outcome: "sent" };
        const body = await readJson(response);
        if (isPermanentFcmTokenError(response.status, body)) {
          await patchRow(supabaseUrl, secretKey, "user_push_devices", device.id, {
            enabled: false, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          });
          return { outcome: "gone", error: `fcm:${response.status}` };
        }
        return { outcome: "retry", error: `fcm:${response.status}:${readFcmErrorStatus(body)}`.slice(0, 160) };
      } catch {
        fcmAccessToken = undefined;
        return { outcome: "retry", error: "fcm:network_error" };
      }
    },
  };
  return await drainAlbumPush(deps, limit);
}

async function dispatchVoice(limit: unknown) {
  const enabled = () => Deno.env.get("VOICE_PUSH_DISPATCH_ENABLED") === "1";
  if (!enabled()) return voiceSummary("disabled");
  const config = readFcmConfig();
  if (!config) return voiceSummary("credentials_pending");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = readSupabaseSecretKey();
  if (!supabaseUrl || !secretKey) return voiceSummary("runtime_pending");
  try {
    return await drainVoicePush({
      enabled, now: Date.now, uuid: () => crypto.randomUUID(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      getAccessToken: (signal) => getGoogleAccessToken(config, signal),
      rpc: async (name, args, signal) => {
        signal.throwIfAborted();
        const response = await restFetch(new URL(`/rest/v1/rpc/${name}`, supabaseUrl), secretKey, {
          method: "POST", headers: { prefer: "return=representation" }, signal, body: JSON.stringify(args),
        });
        if (!response.ok) throw new Error("voice_rpc_failed");
        return await response.json();
      },
      send: async (envelope, accessToken, signal) => {
        signal.throwIfAborted();
        const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`, {
          method: "POST", signal, headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify(envelope),
        });
        return { status: response.status, retryAfter: response.headers.get("retry-after"), body: await readJson(response) };
      },
    }, limit);
  } catch { return voiceSummary("rpc_failed"); }
}

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

async function readBody(request: Request): Promise<{ limit?: unknown; scope?: unknown } | null> {
  const text = await request.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as { limit?: unknown; scope?: unknown };
  } catch {
    return null;
  }
}

function normalizeLimit(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(value), MAX_LIMIT));
}

async function claimOutbox(
  supabaseUrl: string,
  secretKey: string,
  limit: number,
  claimToken: string,
) {
  const url = new URL("/rest/v1/rpc/push_outbox_claim", supabaseUrl);
  const response = await restFetch(url, secretKey, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      p_limit: limit,
      p_claim_token: claimToken,
    }),
  });
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

async function recheckWebPushDelivery(
  supabaseUrl: string,
  secretKey: string,
  outboxId: string,
  claimToken: string,
): Promise<{ ok: true; status: WebPushDeliveryStatus } | { ok: false }> {
  const url = new URL("/rest/v1/rpc/push_outbox_delivery_recheck", supabaseUrl);
  const response = await restFetch(url, secretKey, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      p_outbox_id: outboxId,
      p_claim_token: claimToken,
    }),
  });
  if (!response.ok) return { ok: false };

  const status = await response.json() as unknown;
  if (
    status !== "deliver" && status !== "foreground" && status !== "read" &&
    status !== "subscription_inactive" && status !== "claim_lost"
  ) {
    return { ok: false };
  }
  return { ok: true, status };
}

async function claimNativeOutbox(supabaseUrl: string, secretKey: string, limit: number, claimToken: string) {
  const url = new URL("/rest/v1/rpc/native_push_outbox_claim", supabaseUrl);
  const response = await restFetch(url, secretKey, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ p_limit: limit, p_claim_token: claimToken }),
  });
  if (!response.ok) return { ok: false as const, status: 500, body: await summarizeResponse(response) };
  return { ok: true as const, data: (await response.json()) as NativeOutboxRow[] };
}

async function recheckNativePushDelivery(
  supabaseUrl: string,
  secretKey: string,
  outboxId: string,
  claimToken: string,
): Promise<{ ok: true; status: NativePushDeliveryStatus } | { ok: false }> {
  try {
    const url = new URL("/rest/v1/rpc/native_push_outbox_delivery_recheck", supabaseUrl);
    const response = await restFetch(url, secretKey, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ p_outbox_id: outboxId, p_claim_token: claimToken }),
    });
    if (!response.ok) return { ok: false };

    const status = await response.json() as unknown;
    if (status !== "deliver" && status !== "read" && status !== "device_inactive" && status !== "claim_lost") {
      return { ok: false };
    }
    return { ok: true, status };
  } catch {
    return { ok: false };
  }
}

async function selectPushDevices(supabaseUrl: string, secretKey: string, ids: string[]) {
  if (ids.length === 0) return { ok: true as const, data: [] as PushDeviceRow[] };
  const url = new URL("/rest/v1/user_push_devices", supabaseUrl);
  url.searchParams.set("select", "id,token,provider,enabled,revoked_at,app_version");
  url.searchParams.set("id", `in.(${ids.join(",")})`);
  const response = await restFetch(url, secretKey);
  if (!response.ok) return { ok: false as const, status: response.status };
  return { ok: true as const, data: (await response.json()) as PushDeviceRow[] };
}

async function dispatchNativePush(
  supabaseUrl: string,
  secretKey: string,
  claimToken: string,
  rows: NativeOutboxRow[],
) {
  if (rows.length === 0) {
    return { sent: 0, failed: 0, pruned: 0, pending: 0, status: "idle" };
  }

  const deviceIds = Array.from(new Set(rows.map((row) => row.device_id)));
  const devices = await selectPushDevices(supabaseUrl, secretKey, deviceIds);
  if (!devices.ok) {
    for (const row of rows) await markNativeOutbox(supabaseUrl, secretKey, claimToken, row.id, {});
    return { sent: 0, failed: rows.length, pruned: 0, pending: rows.length, status: "device_query_failed" };
  }

  const fcmConfig = readFcmConfig();
  const wnsConfig = readWnsConfig();
  const byId = new Map(devices.data.map((device) => [device.id, device]));
  let fcmAccessToken: string | null | undefined;
  let wnsAccessToken: string | null | undefined;
  let sent = 0;
  let failed = 0;
  let pruned = 0;
  let pending = 0;
  let authenticationFailed = false;
  for (const row of rows) {
    const device = byId.get(row.device_id);
    if (!device || !device.enabled || device.revoked_at) {
      await markNativeOutbox(supabaseUrl, secretKey, claimToken, row.id, {
        sent_at: new Date().toISOString(),
        last_error: "device_missing",
      });
      pruned += 1;
      continue;
    }

    let result: "sent" | "failed" | "pruned";
    if (device.provider === "wns") {
      if (!wnsConfig) {
        await markNativeOutbox(supabaseUrl, secretKey, claimToken, row.id, {});
        pending += 1;
        continue;
      }
      if (wnsAccessToken === undefined) {
        try {
          wnsAccessToken = await getWnsAccessToken(wnsConfig);
        } catch {
          wnsAccessToken = null;
          authenticationFailed = true;
        }
      }
      if (!wnsAccessToken) {
        failed += 1;
        pending += 1;
        continue;
      }
      result = await deliverWns(
        supabaseUrl,
        secretKey,
        claimToken,
        wnsAccessToken,
        row,
        device,
      );
    } else if (device.provider === "fcm") {
      if (!fcmConfig) {
        await markNativeOutbox(supabaseUrl, secretKey, claimToken, row.id, {});
        pending += 1;
        continue;
      }
      if (fcmAccessToken === undefined) {
        try {
          fcmAccessToken = await getGoogleAccessToken(fcmConfig);
        } catch {
          fcmAccessToken = null;
          authenticationFailed = true;
        }
      }
      if (!fcmAccessToken) {
        failed += 1;
        pending += 1;
        continue;
      }
      result = await deliverFcm(
        supabaseUrl,
        secretKey,
        claimToken,
        fcmConfig.projectId,
        fcmAccessToken,
        row,
        device,
      );
    } else {
      await markNativeOutbox(supabaseUrl, secretKey, claimToken, row.id, {});
      pending += 1;
      continue;
    }

    if (result === "sent") sent += 1;
    else if (result === "pruned") pruned += 1;
    else {
      failed += 1;
      pending += 1;
    }
  }
  return {
    sent,
    failed,
    pruned,
    pending,
    status: authenticationFailed
      ? "provider_auth_failed"
      : pending > 0
        ? "credentials_pending"
        : "ready",
  };
}

async function deliverFcm(
  supabaseUrl: string,
  secretKey: string,
  claimToken: string,
  projectId: string,
  accessToken: string,
  row: NativeOutboxRow,
  device: PushDeviceRow,
): Promise<"sent" | "failed" | "pruned"> {
  const eligibility = await recheckNativePushDelivery(supabaseUrl, secretKey, row.id, claimToken);
  if (!eligibility.ok) return "failed";
  if (eligibility.status !== "deliver") return "pruned";

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildFcmMessage(row.payload, device.token, device.app_version)),
    },
  );

  if (response.ok) {
    await markNativeOutbox(supabaseUrl, secretKey, claimToken, row.id, {
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
    await markNativeOutbox(supabaseUrl, secretKey, claimToken, row.id, {
      sent_at: new Date().toISOString(),
      last_error: `gone:${response.status}`,
    });
    return "pruned";
  }

  await markNativeOutbox(supabaseUrl, secretKey, claimToken, row.id, {
    attempt_count: row.attempt_count + 1,
    last_error: `fcm:${response.status}:${readFcmErrorStatus(body)}`.slice(0, 160),
  });
  return "failed";
}

async function deliverWns(
  supabaseUrl: string,
  secretKey: string,
  claimToken: string,
  accessToken: string,
  row: NativeOutboxRow,
  device: PushDeviceRow,
): Promise<"sent" | "failed" | "pruned"> {
  if (!isAllowedWnsChannelUrl(device.token)) {
    const revokedAt = new Date().toISOString();
    await patchRow(supabaseUrl, secretKey, "user_push_devices", device.id, {
      enabled: false,
      revoked_at: revokedAt,
      updated_at: revokedAt,
    });
    await markNativeOutbox(supabaseUrl, secretKey, claimToken, row.id, {
      sent_at: revokedAt,
      last_error: "invalid_channel",
    });
    return "pruned";
  }

  const eligibility = await recheckNativePushDelivery(supabaseUrl, secretKey, row.id, claimToken);
  if (!eligibility.ok) return "failed";
  if (eligibility.status !== "deliver") return "pruned";

  let response: Response;
  try {
    response = await fetch(device.token, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "text/xml; charset=utf-8",
        "x-wns-cache-policy": "no-cache",
        "x-wns-requestforstatus": "true",
        "x-wns-type": "wns/toast",
      },
      body: buildWnsToast(safePayload(row.payload)),
    });
  } catch {
    await markNativeOutbox(supabaseUrl, secretKey, claimToken, row.id, {
      attempt_count: row.attempt_count + 1,
      last_error: "wns:network_error",
    });
    return "failed";
  }

  if (response.ok) {
    await markNativeOutbox(supabaseUrl, secretKey, claimToken, row.id, {
      sent_at: new Date().toISOString(),
      last_error: null,
    });
    return "sent";
  }

  const reason = readWnsResponseStatus(response);
  if (isPermanentWnsChannelError(response.status, reason)) {
    const revokedAt = new Date().toISOString();
    await patchRow(supabaseUrl, secretKey, "user_push_devices", device.id, {
      enabled: false,
      revoked_at: revokedAt,
      updated_at: revokedAt,
    });
    await markNativeOutbox(supabaseUrl, secretKey, claimToken, row.id, {
      sent_at: revokedAt,
      last_error: `gone:${response.status}:${reason}`.slice(0, 160),
    });
    return "pruned";
  }

  await markNativeOutbox(supabaseUrl, secretKey, claimToken, row.id, {
    attempt_count: row.attempt_count + 1,
    last_error: `wns:${response.status}:${reason}`.slice(0, 160),
  });
  return "failed";
}

async function deliver(
  supabaseUrl: string,
  secretKey: string,
  claimToken: string,
  row: OutboxRow,
  subscription: SubscriptionRow | undefined,
  webPushAppOrigin: string | undefined,
): Promise<"sent" | "failed" | "pruned" | "deferred"> {
  const eligibility = await recheckWebPushDelivery(
    supabaseUrl,
    secretKey,
    row.id,
    claimToken,
  );
  if (!eligibility.ok) return "failed";

  const deliveryStatus = eligibility.status;
  if (deliveryStatus === "foreground") return "deferred";
  if (
    deliveryStatus === "read" || deliveryStatus === "subscription_inactive" ||
    deliveryStatus === "claim_lost"
  ) {
    return "pruned";
  }

  if (!subscription || subscription.is_active === false) {
    await markOutbox(supabaseUrl, secretKey, claimToken, row.id, {
      suppressed_at: new Date().toISOString(),
      suppression_reason: "subscription_inactive",
      claim_token: null,
      claimed_until: null,
      last_error: "subscription_missing",
    });
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
    await markOutbox(supabaseUrl, secretKey, claimToken, row.id, {
      sent_at: new Date().toISOString(),
      claim_token: null,
      claimed_until: null,
      last_error: null,
    });
    return "sent";
  } catch (error) {
    const status = typeof error === "object" && error ? (error as { statusCode?: number }).statusCode : undefined;
    const reason = readWebPushErrorReason(error);
    if (isPermanentWebPushSubscriptionError(status, reason)) {
      await patchRow(supabaseUrl, secretKey, "push_subscriptions", subscription.id, {
        is_active: false,
        updated_at: new Date().toISOString(),
      });
      await markOutbox(supabaseUrl, secretKey, claimToken, row.id, {
        suppressed_at: new Date().toISOString(),
        suppression_reason: "subscription_inactive",
        claim_token: null,
        claimed_until: null,
        last_error: `gone:${status ?? "unknown"}:${reason ?? "subscription_invalid"}`,
      });
      return "pruned";
    }

    await markOutbox(supabaseUrl, secretKey, claimToken, row.id, {
      attempt_count: row.attempt_count + 1,
      claim_token: null,
      claimed_until: null,
      last_error: `webpush:${status ?? "unknown"}:${reason ?? "unknown"}`,
    });
    return "failed";
  }
}

function safePayload(payload: Record<string, unknown>): SafeWebPushPayload {
  const senderKind = safeSenderKind(payload.senderKind ?? payload.sender_kind);
  const senderId = senderKind === "user" ? safeText(payload.senderId ?? payload.sender_id, "", 80) : "";
  const botId = senderKind === "bot" ? safeText(payload.botId ?? payload.bot_id, "", 80) : "";
  const chatId = safeText(payload.chatId ?? payload.chat_id, "", 80);
  return {
    title: safeText(payload.title, "LETSCUBE", 80),
    body: safeText(payload.body, "Новое уведомление", 180),
    url: safeRelativeUrl(payload.url),
    tag: safeText(payload.tag, "kub-notification", 80),
    kind: safeText(payload.kind, "notification", 60),
    chatId,
    messageId: safeText(payload.messageId ?? payload.message_id, "", 80),
    senderKind: senderKind && ((senderKind === "user" && senderId) || (senderKind === "bot" && botId)) ? senderKind : "",
    senderId,
    botId,
    senderName: safeText(payload.senderName ?? payload.sender_name, "", 128),
    senderAvatarUrl: safeTrustedAvatarUrl(payload.senderAvatarUrl ?? payload.sender_avatar_url),
    messageType: safeText(payload.messageType ?? payload.message_type, "", 32),
    preview: safeText(payload.preview, "", 180),
    groupTag: chatId ? `message:chat:${chatId}` : "",
    renotify: typeof payload.renotify === "boolean" ? payload.renotify : true,
  };
}

function safeSenderKind(value: unknown): "user" | "bot" | "" {
  return value === "user" || value === "bot" ? value : "";
}

function safeTrustedAvatarUrl(value: unknown): string {
  if (typeof value !== "string" || looksSensitive(value)) return "";
  try {
    const url = new URL(value, "https://app.letscube.ru");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.origin === "https://app.letscube.ru" || url.origin === "https://api.letscube.ru")
      ? url.href.slice(0, 2048)
      : "";
  } catch {
    return "";
  }
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
    lower.includes("/object/sign/") ||
    lower.includes(".supabase.co/storage") ||
    lower.includes("token=") ||
    lower.includes("password=") ||
    lower.includes("authorization=") ||
    lower.includes("signedurl") ||
    lower.includes("signed_url")
  );
}

async function markOutbox(
  supabaseUrl: string,
  secretKey: string,
  claimToken: string,
  id: string,
  patch: Record<string, unknown>,
) {
  await patchRow(
    supabaseUrl,
    secretKey,
    "notifications_push_outbox",
    id,
    patch,
    claimToken,
  );
}

async function markNativeOutbox(
  supabaseUrl: string,
  secretKey: string,
  claimToken: string,
  id: string,
  patch: Record<string, unknown>,
) {
  const response = await patchRow(supabaseUrl, secretKey, "notifications_native_push_outbox", id, {
    ...patch,
    claim_token: null,
    claimed_until: null,
  }, claimToken, true);
  if (!response.ok || !(await response.json() as Array<{ id: string }>).some((row) => row.id === id)) {
    throw new Error("native_push_ack_failed");
  }
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
  claimToken?: string,
  returnRepresentation = false,
) {
  const url = new URL(`/rest/v1/${table}`, supabaseUrl);
  url.searchParams.set("id", `eq.${id}`);
  if ((table === "notifications_push_outbox" || table === "notifications_native_push_outbox") && claimToken) {
    url.searchParams.set("claim_token", `eq.${claimToken}`);
  }
  if (returnRepresentation) url.searchParams.set("select", "id");
  return await restFetch(url, secretKey, {
    method: "PATCH",
    ...(returnRepresentation ? { headers: { prefer: "return=representation" } } : {}),
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

function readWnsConfig(): WnsConfig | null {
  const tenantId = Deno.env.get("WNS_TENANT_ID")?.trim();
  const clientId = Deno.env.get("WNS_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("WNS_CLIENT_SECRET")?.trim();
  if (!tenantId || !clientId || !clientSecret) return null;
  if (!isSafeWnsIdentifier(tenantId) || !isSafeWnsIdentifier(clientId)) return null;
  return { tenantId, clientId, clientSecret };
}

async function getWnsAccessToken(config: WnsConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
    scope: "https://wns.windows.com/.default",
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  const payload = await readJson(response) as { access_token?: unknown } | null;
  if (!response.ok || typeof payload?.access_token !== "string") {
    throw new Error("wns_oauth_failed");
  }
  return payload.access_token;
}

function isSafeWnsIdentifier(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,128}$/.test(value);
}

async function getGoogleAccessToken(config: FcmConfig, signal?: AbortSignal): Promise<string> {
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
  signal?.throwIfAborted();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal,
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
