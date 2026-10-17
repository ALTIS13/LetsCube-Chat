import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { logger } from "../lib/logger";
import { buildLegacyWebPushPayload, sanitizeLegacyWebPushFailure } from "./pushDispatcherConfig";

/**
 * Push dispatcher worker (Task #32 — push side of in-app notifications).
 *
 * Drains `public.notifications_push_outbox` rows that the SQL trigger
 * `_enqueue_push_after_notification_insert` enqueues whenever a row
 * lands in `public.notifications`. One outbox row per
 * (notification × push_subscription); each row carries a
 * pre-rendered Russian payload (title/body/url/tag/kind) so we don't
 * have to re-translate on the worker side.
 *
 * We use the service-role key so RLS is bypassed (the outbox table
 * has no permissive policies and is locked from every other role).
 *
 * The opt-in legacy consumer uses the same claim/recheck protocol as cron.
 * On 404 / 410 the exact subscription binding is deactivated. Other errors
 * are recorded in `last_error` and the row is retried on the next
 * tick up to MAX_ATTEMPTS times.
 */

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;
const TICK_MS = 5_000;

interface OutboxRow {
  id: string;
  subscription_id: string;
  payload: Record<string, unknown>;
  attempt_count: number;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  is_active: boolean;
}

let started = false;

export function startPushDispatcher(): void {
  if (started) return;
  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const serviceKey =
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["SELFHOST_SERVICE_ROLE_KEY"];
  const vapidPublic = process.env["VAPID_PUBLIC_KEY"];
  const vapidPrivate = process.env["VAPID_PRIVATE_KEY"];
  const vapidContact = process.env["VAPID_SUBJECT"] ?? process.env["VAPID_CONTACT"] ?? "mailto:admin@kub.local";

  if (!url || !serviceKey) {
    logger.warn(
      "pushDispatcher disabled: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing",
    );
    return;
  }
  if (!vapidPublic || !vapidPrivate) {
    logger.warn(
      "pushDispatcher disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY missing",
    );
    return;
  }

  webpush.setVapidDetails(vapidContact, vapidPublic, vapidPrivate);
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  started = true;
  logger.info("pushDispatcher started");
  void loop(supabase);
}

async function loop(supabase: SupabaseClient): Promise<void> {
  // Sequential ticks; if a tick takes longer than TICK_MS we just
  // schedule the next one immediately so we never run two in
  // parallel and risk re-sending the same row twice.
  while (true) {
    try {
      await tick(supabase);
    } catch {
      logger.error("pushDispatcher tick failed");
    }
    await sleep(TICK_MS);
  }
}

async function tick(supabase: SupabaseClient): Promise<void> {
  const claimToken = randomUUID();
  const { data: rows, error } = await supabase
    .rpc("push_outbox_claim", { p_limit: BATCH_SIZE, p_claim_token: claimToken });

  if (error) {
    logger.error("pushDispatcher claim failed");
    return;
  }
  if (!Array.isArray(rows) || !rows.every(validOutboxRow) ||
      new Set(rows.map((row) => row.id)).size !== rows.length) {
    logger.error("pushDispatcher invalid claim response");
    return;
  }
  if (rows.length === 0) return;

  const subIds = Array.from(new Set(rows.map((r) => r.subscription_id as string)));
  const { data: subs, error: subErr } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth, is_active")
    .in("id", subIds);
  if (subErr) {
    logger.error("pushDispatcher subs lookup failed");
    return;
  }
  const subById = new Map<string, SubscriptionRow>();
  for (const s of (subs ?? []) as SubscriptionRow[]) subById.set(s.id, s);

  await Promise.all(
    (rows as OutboxRow[]).map((row) => deliver(supabase, claimToken, row, subById.get(row.subscription_id))),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validOutboxRow(value: unknown): value is OutboxRow {
  if (!value || typeof value !== "object") return false;
  const row = value as OutboxRow;
  return typeof row.id === "string" && UUID.test(row.id) &&
    typeof row.subscription_id === "string" && UUID.test(row.subscription_id) &&
    Number.isInteger(row.attempt_count) && row.attempt_count >= 0 && row.attempt_count < MAX_ATTEMPTS &&
    Boolean(row.payload) && typeof row.payload === "object" && !Array.isArray(row.payload);
}

async function completeOutbox(
  supabase: SupabaseClient, claimToken: string, id: string, patch: Record<string, unknown>,
): Promise<void> {
  try {
    const { data, error } = await supabase.from("notifications_push_outbox")
      .update({ ...patch, claim_token: null, claimed_until: null })
      .eq("id", id).eq("claim_token", claimToken).select("id");
    if (error || !Array.isArray(data) || !data.some((row) => row.id === id)) {
      logger.warn({ rowId: id }, "pushDispatcher completion unconfirmed");
    }
  } catch {
    // Provider acceptance is uncertain after an ACK failure, not a new send failure.
    logger.warn({ rowId: id }, "pushDispatcher completion unconfirmed");
  }
}

async function deliver(
  supabase: SupabaseClient,
  claimToken: string,
  row: OutboxRow,
  sub: SubscriptionRow | undefined,
): Promise<void> {
  if (!sub || sub.id !== row.subscription_id || typeof sub.user_id !== "string" || !UUID.test(sub.user_id) ||
      typeof sub.endpoint !== "string" || typeof sub.p256dh !== "string" || typeof sub.auth !== "string") return;
  // Hash and send the same immutable strings, never a second subscription read.
  const descriptor = Object.freeze({ id: sub.id.toLowerCase(), user_id: sub.user_id.toLowerCase(),
    endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth });
  const hash = createHash("sha256");
  for (const field of [descriptor.id, descriptor.user_id, descriptor.endpoint, descriptor.p256dh, descriptor.auth]) {
    const bytes = Buffer.from(field, "utf8");
    hash.update(`${bytes.length}:`); hash.update(bytes);
  }
  const descriptorFingerprint = `v1:${hash.digest("hex")}`;
  let payload: string;
  try {
    payload = JSON.stringify(buildLegacyWebPushPayload(row.payload, descriptor.id, process.env["WEB_PUSH_APP_ORIGIN"]));
  } catch {
    await completeOutbox(supabase, claimToken, row.id, {
      attempt_count: row.attempt_count + 1, last_error: "webpush:unknown:invalid_payload",
    });
    return;
  }
  let status: unknown;
  try {
    // Requires the additive bound RPC; a missing migration must fail closed.
    const result = await supabase.rpc("push_outbox_delivery_recheck_bound", {
      p_outbox_id: row.id, p_claim_token: claimToken,
      p_subscription_id: sub.id, p_subscription_fingerprint: descriptorFingerprint,
    });
    if (result.error) return;
    status = result.data;
  } catch {
    return;
  }
  if (status !== "deliver") return;
  try {
    await webpush.sendNotification(
      { endpoint: descriptor.endpoint, keys: { p256dh: descriptor.p256dh, auth: descriptor.auth } },
      payload,
      { TTL: 60 * 60 * 24 },
    );
  } catch (err: unknown) {
    const failure = sanitizeLegacyWebPushFailure(err);
    const status = failure.status ?? undefined;
    if (status === 404 || status === 410) {
      try {
        const { error } = await supabase.from("push_subscriptions")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("id", descriptor.id).eq("user_id", descriptor.user_id).eq("endpoint", descriptor.endpoint)
          .eq("p256dh", descriptor.p256dh).eq("auth", descriptor.auth);
        if (error) logger.warn({ rowId: row.id }, "pushDispatcher subscription deactivation unconfirmed");
      } catch {
        logger.warn({ rowId: row.id }, "pushDispatcher subscription deactivation unconfirmed");
      }
      await completeOutbox(supabase, claimToken, row.id, {
        suppressed_at: new Date().toISOString(), suppression_reason: "subscription_inactive",
        last_error: `gone:${status}:${failure.reason}`,
      });
    } else {
      await completeOutbox(supabase, claimToken, row.id, {
        attempt_count: row.attempt_count + 1,
        last_error: `webpush:${status ?? "unknown"}:${failure.reason}`,
      });
      logger.warn({ rowId: row.id, status, reason: failure.reason }, "push delivery failed");
    }
    return;
  }
  await completeOutbox(supabase, claimToken, row.id, { sent_at: new Date().toISOString(), last_error: null });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
