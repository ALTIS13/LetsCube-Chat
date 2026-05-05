// КУБ push-worker.
//
// Subscribes to postgres_changes on `messages`, and for every new INSERT
// resolves the recipient list (chat_members minus sender) and delivers a
// Web Push notification to each of their `push_subscriptions`.
//
// Runs as a long-lived pm2 process on the same VPS as the web app.
// Required env vars (loaded from push-worker/.env):
//   SUPABASE_URL                 — public URL of the Supabase project
//   SUPABASE_SERVICE_ROLE_KEY    — service-role JWT (full DB access; never ship to the client!)
//   VAPID_PUBLIC_KEY             — public half of the VAPID keypair (same as NEXT_PUBLIC_VAPID_PUBLIC_KEY)
//   VAPID_PRIVATE_KEY            — private half (server-only)
//   VAPID_SUBJECT                — mailto: or https: URL identifying the app

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, ".env") });

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
  console.error("FATAL: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are required");
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

console.log(`[${new Date().toISOString()}] push-worker started; subscribing to messages…`);

// Build a short body string from the message row, mirroring the in-app preview.
function previewOf(msg, senderName) {
  if (msg.type === "image") return "🖼 Фото";
  if (msg.type === "audio") return "🎤 Голосовое сообщение";
  if (msg.type === "video") return "🎬 Видео";
  if (msg.type === "file")  return `📎 ${msg.content ?? "Файл"}`;
  return msg.content ?? "";
}

async function deliverFor(message) {
  // Resolve sender display name and chat name for the notification title.
  const [{ data: sender }, { data: chat }] = await Promise.all([
    supabase.from("profiles").select("full_name, username").eq("id", message.user_id).single(),
    supabase.from("chats").select("type, name").eq("id", message.chat_id).single(),
  ]);
  const senderName = sender?.full_name ?? sender?.username ?? "Сообщение";
  const isGroup = chat?.type === "group" || chat?.type === "channel";
  const title = isGroup ? `${senderName} в ${chat?.name ?? ""}` : senderName;

  // Recipients = chat members minus the sender themself.
  const { data: members } = await supabase
    .from("chat_members")
    .select("user_id")
    .eq("chat_id", message.chat_id);
  if (!members?.length) return;
  const recipientIds = members.map((m) => m.user_id).filter((id) => id !== message.user_id);
  if (!recipientIds.length) return;

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", recipientIds);
  if (!subs?.length) return;

  const payload = JSON.stringify({
    title,
    body: previewOf(message, senderName),
    chatId: message.chat_id,
    tag: `chat:${message.chat_id}`,
  });

  // Send in parallel; clean up dead subscriptions (HTTP 404/410).
  const results = await Promise.allSettled(subs.map((s) =>
    webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      payload,
    ).catch((err) => { throw { sub: s, err }; }),
  ));
  for (const r of results) {
    if (r.status === "rejected") {
      const status = r.reason?.err?.statusCode;
      if (status === 404 || status === 410) {
        // Subscription is gone — delete so we don't keep retrying.
        await supabase.from("push_subscriptions").delete().eq("id", r.reason.sub.id);
        console.log(`pruned dead subscription ${r.reason.sub.id}`);
      } else {
        console.warn("push send failed:", status, r.reason?.err?.body ?? r.reason?.err?.message);
      }
    }
  }
}

const channel = supabase
  .channel("push-worker")
  .on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "messages" },
    async ({ new: message }) => {
      try {
        await deliverFor(message);
      } catch (err) {
        console.error("deliverFor error:", err);
      }
    },
  )
  .subscribe((status) => {
    console.log(`[${new Date().toISOString()}] realtime status: ${status}`);
  });

// Keep the process alive even if all timers/sockets idle.
process.stdin.resume();

const shutdown = async (sig) => {
  console.log(`[${new Date().toISOString()}] received ${sig}, closing`);
  try { await supabase.removeChannel(channel); } catch {}
  process.exit(0);
};
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
