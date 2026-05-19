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

## Manual Supabase setup

1. Apply the proposal manually:

```sql
.migration-backup/supabase/migrations/20260527_push_notifications_foundation.sql
.migration-backup/supabase/migrations/20260529_message_notifications_for_push.sql
.migration-backup/supabase/migrations/20260530_push_message_notification_polish.sql
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

## Manual QA

- Enable push from profile settings.
- Verify the browser permission prompt appears only after the explicit click.
- Send a message/task/invite to the user from another account.
- Verify notification delivery in a normal browser tab and installed PWA.
- Click the notification and confirm it focuses an existing KUB tab or opens the correct route.
- Send 2-3 messages in the same chat and confirm the browser replaces/updates the same chat notification where tag replacement is supported; send from another chat and confirm it stays separate.
