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

## Manual Supabase setup

1. Apply the proposal manually:

```sql
.migration-backup/supabase/migrations/20260527_push_notifications_foundation.sql
.migration-backup/supabase/migrations/20260529_message_notifications_for_push.sql
.migration-backup/supabase/migrations/20260530_push_message_notification_polish.sql
.migration-backup/supabase/migrations/20260531_notification_center_read_sync_native_push.sql
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
- Native Android push is separate from browser Web Push. It requires local `android/app/google-services.json`, Firebase/FCM configuration, a device-token table/RPC, and backend delivery. Do not commit `google-services.json`, Firebase credentials, private keys, or signing files.

## Native Android push status

Native push is not ready yet. The Android APK currently shows native notifications as a pending setup path instead of reusing browser `PushManager` or the PWA service worker. To enable it later:

1. Place `google-services.json` locally at `android/app/google-services.json`; it is ignored by git.
2. Apply the native device-token proposal in `20260531_notification_center_read_sync_native_push.sql`.
3. Add a Capacitor native push client only after Firebase config is present.
4. Extend the server/Edge Function delivery path to send FCM payloads from backend secrets, not from frontend.
5. Run physical Android foreground/background delivery QA before calling native push production-ready.

## Manual QA

- Enable push from profile settings.
- Verify the browser permission prompt appears only after the explicit click.
- Send a message/task/invite to the user from another account.
- Verify notification delivery in a normal browser tab and installed PWA.
- Click the notification and confirm it focuses an existing KUB tab or opens the correct route.
- Send 2-3 messages in the same chat and confirm the browser replaces/updates the same chat notification where tag replacement is supported; send from another chat and confirm it stays separate.
