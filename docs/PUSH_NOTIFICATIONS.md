# Push Notifications

Status: production foundation is in the repo, but database SQL and Edge Function deployment are manual.

## What exists

- PWA service worker handles `push` and `notificationclick`.
- Frontend settings expose Push-уведомления and per-type toggles:
  - Сообщения
  - Задачи
  - Приглашения
- Browser subscription data is stored in `public.push_subscriptions`.
- User preferences are proposed in `public.notification_preferences`.
- Chat-level push mute is proposed in `public.chat_notification_preferences`.
- Pending delivery uses `public.notifications_push_outbox`.
- `supabase/functions/send-push-notifications` is an Edge Function source for draining the outbox.
- Message notifications require the additional proposal `20260529_message_notifications_for_push.sql`, which creates `message` notification rows from `public.messages` inserts.
- Message push copy/collapse polish requires `20260530_push_message_notification_polish.sql`: private first-message chats do not emit `chat_added`, message payloads include `chat_type`, and browser notifications collapse by stable `message:chat:<chat_id>` tags.
- Notification Center read-sync/native-device foundation requires `20260531_notification_center_read_sync_native_push.sql`: it marks historical self-message notifications read, adds `notifications_mark_chat_messages_read`, and proposes `user_push_devices` for future FCM/APNS device tokens.
- Native Android delivery uses `20260711_native_push_fcm_delivery.sql`: it hardens auth-scoped FCM device registration, adds a separate native outbox and fans out the same semantic notification rows to native devices without replacing the browser Web Push outbox.

## Manual Supabase setup

1. Apply the proposal manually:

```sql
.migration-backup/supabase/migrations/20260527_push_notifications_foundation.sql
.migration-backup/supabase/migrations/20260529_message_notifications_for_push.sql
.migration-backup/supabase/migrations/20260530_push_message_notification_polish.sql
.migration-backup/supabase/migrations/20260531_notification_center_read_sync_native_push.sql
.migration-backup/supabase/migrations/20260711_native_push_fcm_delivery.sql
```

2. Generate VAPID keys locally with a trusted tool, for example:

```powershell
npx web-push generate-vapid-keys
```

3. Configure frontend build env in Coolify:

```text
VITE_VAPID_PUBLIC_KEY=<public VAPID key>
```

4. Configure Supabase Edge Function secrets:

```text
VAPID_PUBLIC_KEY=<public VAPID key>
VAPID_PRIVATE_KEY=<private VAPID key>
VAPID_SUBJECT=mailto:admin@example.test
KUB_PUSH_DISPATCH_TOKEN=<random scheduler token>
SUPABASE_SECRET_KEYS=<Supabase runtime secret JSON>
```

Never put the private VAPID key or Supabase runtime secrets into the repository or frontend env.

5. Deploy and schedule the Edge Function:

```powershell
supabase functions deploy send-push-notifications
```

Schedule it from Supabase Cron or an external scheduler with `POST` and either `x-kub-push-token` or `Authorization: Bearer <token>`.

## Privacy and routing

- Message pushes use safe truncated text previews or media labels such as `Фото`, `Видео`, `Голосовое`, `Файл`; raw media URLs are not included.
- Push payload routes only to app paths such as `/?chat=<id>&message=<id>`, `/tasks`, or `/?notifications=1`.
- The service worker rejects cross-origin notification click URLs.
- Sender echo is blocked when notification payload includes `sender_id`.
- User push settings and chat mute settings are enforced in the enqueue function before outbox rows are created.
- Private chat message pushes render as sender + preview. Group message pushes render as chat + `sender: preview`.
- Browser/PWA grouping uses a stable `NotificationOptions.tag`; before showing a replacement notification, the service worker closes existing notifications with the same tag. Exact OS-level notification history behavior still depends on the browser and operating system.
- In-app Notification Center groups message rows by chat/dialog so tasks stay visible. Opening a chat marks loaded message notifications for that chat read immediately; after applying `20260531_notification_center_read_sync_native_push.sql`, the server RPC can mark all matching unread message notifications for the user.
- Native Android push is separate from browser Web Push. The client uses Capacitor Push Notifications and the same in-app notification semantics; FCM credentials and delivery stay in the trusted Edge Function runtime. Do not commit `google-services.json`, Firebase credentials, private keys, raw device tokens, or signing files.

## Native Android push status

Native Android push now has a working client, schema and trusted delivery foundation. It is not release-complete until real-account semantic scenarios and the broader physical matrix pass.

Implemented in the APK/client:

- Android settings use native push copy instead of browser `PushManager` copy.
- `@capacitor/push-notifications` is the native client plugin.
- The app requests Android notification permission only from a user action.
- The app creates Android channels:
  - `messages`
  - `tasks`
  - `system`
- The app listens for FCM registration and sends the token to `register_push_device` when that RPC exists.
- Raw FCM tokens are not printed and are not stored in frontend localStorage.
- Notification tap payloads route inside the SPA where possible.

Verified foundation:

1. Local ignored `google-services.json` matches package `com.kub.messenger`.
2. Auth-scoped device registration and revocation RPCs are applied and verified.
3. Trusted Firebase credentials are configured only in the server runtime.
4. The Edge Function delivers FCM HTTP v1 payloads from the native outbox and prunes only permanent token failures.
5. A physical Android background delivery and notification tap smoke passed.

Still required before release readiness: real multi-account message/task delivery, sender exclusion, mutes/preferences, semantic chat/task routing, killed-app delivery and a broader device matrix.

## Manual QA

- Enable push from profile settings.
- Verify the browser permission prompt appears only after the explicit click.
- Send a message/task/invite to the user from another account.
- Verify notification delivery in a normal browser tab and installed PWA.
- Click the notification and confirm it focuses an existing KUB tab or opens the correct route.
- Send 2-3 messages in the same chat and confirm the browser replaces/updates the same chat notification where tag replacement is supported; send from another chat and confirm it stays separate.
