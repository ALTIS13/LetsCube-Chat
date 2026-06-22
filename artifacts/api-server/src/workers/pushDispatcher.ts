import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { logger } from "../lib/logger";

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
 * On 404 / 410 from the push endpoint the subscription is permanently
 * gone (browser cleared it / user uninstalled the PWA), so we delete
 * it from `push_subscriptions` to stop the bleeding. Other errors
 * are recorded in `last_error` and the row is retried on the next
 * tick up to MAX_ATTEMPTS times.
 */

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;
const TICK_MS = 5_000;

interface OutboxRow {
  id: string;
  notification_id: string;
  subscription_id: string;
  user_id: string;
  payload: Record<string, unknown>;
  attempt_count: number;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

let started = false;

export function startPushDispatcher(): void {
  if (started) return;
  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const serviceKey =
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["SELFHOST_SERVICE_ROLE_KEY"];
  const vapidPublic = process.env["VAPID_PUBLIC_KEY"];
  const vapidPrivate = process.env["VAPID_PRIVATE_KEY"];
  const vapidContact = process.env["VAPID_CONTACT"] ?? "mailto:admin@kub.local";

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
    } catch (err) {
      logger.error({ err }, "pushDispatcher tick failed");
    }
    await sleep(TICK_MS);
  }
}

async function tick(supabase: SupabaseClient): Promise<void> {
  const { data: rows, error } = await supabase
    .from("notifications_push_outbox")
    .select("id, notification_id, subscription_id, user_id, payload, attempt_count")
    .is("sent_at", null)
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    logger.error({ err: error }, "pushDispatcher select failed");
    return;
  }
  if (!rows || rows.length === 0) return;

  const subIds = Array.from(new Set(rows.map((r) => r.subscription_id as string)));
  const { data: subs, error: subErr } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("id", subIds);
  if (subErr) {
    logger.error({ err: subErr }, "pushDispatcher subs lookup failed");
    return;
  }
  const subById = new Map<string, SubscriptionRow>();
  for (const s of (subs ?? []) as SubscriptionRow[]) subById.set(s.id, s);

  await Promise.all(
    (rows as OutboxRow[]).map((row) => deliver(supabase, row, subById.get(row.subscription_id))),
  );
}

async function deliver(
  supabase: SupabaseClient,
  row: OutboxRow,
  sub: SubscriptionRow | undefined,
): Promise<void> {
  if (!sub) {
    // Subscription was deleted between enqueue and delivery — drop
    // the outbox row so it doesn't get retried.
    await supabase
      .from("notifications_push_outbox")
      .update({ sent_at: new Date().toISOString(), last_error: "subscription_missing" })
      .eq("id", row.id);
    return;
  }
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(row.payload),
      { TTL: 60 * 60 * 24 },
    );
    await supabase
      .from("notifications_push_outbox")
      .update({ sent_at: new Date().toISOString(), last_error: null })
      .eq("id", row.id);
  } catch (err: unknown) {
    const status = (err as { statusCode?: number } | null)?.statusCode;
    const message = err instanceof Error ? err.message : String(err);
    if (status === 404 || status === 410) {
      // Permanent: prune the dead subscription. Outbox row stays
      // marked with the error for observability.
      await supabase.from("push_subscriptions").delete().eq("id", sub.id);
      await supabase
        .from("notifications_push_outbox")
        .update({ sent_at: new Date().toISOString(), last_error: `gone:${status}` })
        .eq("id", row.id);
    } else {
      // Advance attempt_count atomically so a permanently-broken
      // endpoint eventually drops out of the SELECT filter.
      await supabase
        .from("notifications_push_outbox")
        .update({
          attempt_count: row.attempt_count + 1,
          last_error: `${status ?? "?"}:${message}`.slice(0, 500),
        })
        .eq("id", row.id);
      logger.warn({ err, rowId: row.id, status }, "push delivery failed");
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
