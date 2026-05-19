import webpush from "npm:web-push@3.6.7";

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
  if (!supabaseUrl || !secretKey) {
    return json({ ok: false, error: "supabase_runtime_env_not_configured" }, 500);
  }
  if (!vapidPublic || !vapidPrivate) {
    return json({ ok: false, error: "vapid_not_configured" }, 500);
  }

  const body = await readBody(request);
  const limit = normalizeLimit(body?.limit);
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const rows = await selectOutbox(supabaseUrl, secretKey, limit);
  if (!rows.ok) return json(rows.body, rows.status);
  if (rows.data.length === 0) return json({ ok: true, sent: 0, failed: 0, pruned: 0, limit });

  const subscriptionIds = Array.from(new Set(rows.data.map((row) => row.subscription_id)));
  const subscriptions = await selectSubscriptions(supabaseUrl, secretKey, subscriptionIds);
  if (!subscriptions.ok) return json(subscriptions.body, subscriptions.status);
  const byId = new Map(subscriptions.data.map((item) => [item.id, item]));

  let sent = 0;
  let failed = 0;
  let pruned = 0;
  for (const row of rows.data) {
    const result = await deliver(supabaseUrl, secretKey, row, byId.get(row.subscription_id));
    if (result === "sent") sent += 1;
    else if (result === "pruned") pruned += 1;
    else failed += 1;
  }

  return json({ ok: true, sent, failed, pruned, limit });
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

async function deliver(
  supabaseUrl: string,
  secretKey: string,
  row: OutboxRow,
  subscription: SubscriptionRow | undefined,
): Promise<"sent" | "failed" | "pruned"> {
  if (!subscription || subscription.is_active === false) {
    await markOutbox(supabaseUrl, secretKey, row.id, { sent_at: new Date().toISOString(), last_error: "subscription_missing" });
    return "pruned";
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(safePayload(row.payload)),
      { TTL: 60 * 60 * 24 },
    );
    await markOutbox(supabaseUrl, secretKey, row.id, { sent_at: new Date().toISOString(), last_error: null });
    return "sent";
  } catch (error) {
    const status = typeof error === "object" && error ? (error as { statusCode?: number }).statusCode : undefined;
    const message = error instanceof Error ? error.message : String(error);
    if (status === 404 || status === 410) {
      await patchRow(supabaseUrl, secretKey, "push_subscriptions", subscription.id, {
        is_active: false,
        updated_at: new Date().toISOString(),
      });
      await markOutbox(supabaseUrl, secretKey, row.id, {
        sent_at: new Date().toISOString(),
        last_error: `gone:${status}`,
      });
      return "pruned";
    }

    await markOutbox(supabaseUrl, secretKey, row.id, {
      attempt_count: row.attempt_count + 1,
      last_error: `${status ?? "?"}:${message}`.slice(0, 300),
    });
    return "failed";
  }
}

function safePayload(payload: Record<string, unknown>) {
  return {
    title: safeText(payload.title, "KUB", 80),
    body: safeText(payload.body, "Новое уведомление", 180),
    url: safeRelativeUrl(payload.url),
    tag: safeText(payload.tag, "kub-notification", 80),
    kind: safeText(payload.kind, "notification", 60),
    chatId: safeText(payload.chatId, "", 80),
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
  return lower.includes("/storage/v1/") || lower.includes("token=") || lower.includes("password=");
}

async function markOutbox(supabaseUrl: string, secretKey: string, id: string, patch: Record<string, unknown>) {
  await patchRow(supabaseUrl, secretKey, "notifications_push_outbox", id, patch);
}

async function patchRow(
  supabaseUrl: string,
  secretKey: string,
  table: "notifications_push_outbox" | "push_subscriptions",
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
