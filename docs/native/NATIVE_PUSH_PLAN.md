# Native Push Plan

KUB currently has browser/PWA push foundation:

- browser push subscriptions;
- notification preferences and chat mute preferences;
- message/task/invite notification rows;
- server-side push outbox;
- Supabase Edge Function dispatcher;
- service worker click routing.

Native apps need platform push tokens and delivery adapters. Browser VAPID
subscriptions are not enough for Android/iOS native builds.

## Target architecture

Keep the current notification model as the source of truth:

1. App action creates an in-app notification row.
2. Backend enqueue logic evaluates preferences, chat mute, sender echo, and
   visibility.
3. Delivery queue fans out to registered devices.
4. Platform adapters deliver to:
   - Web Push/VAPID for browsers and PWA;
   - FCM for Android;
   - APNs for iOS;
   - optional Windows notification channel if desktop wrapper needs it.

## Possible schema extension later

Do not apply SQL now. A future proposal can add a device table such as:

```text
native_push_devices
- id
- user_id
- platform
- token
- app_version
- is_active
- last_seen_at
```

The existing browser `push_subscriptions` table should remain for web/PWA.

## Payload policy

- No raw media URLs.
- No signed storage URLs.
- No passwords, tokens, or emails.
- Message preview is truncated text or safe media label:
  - Photo
  - Video
  - Voice
  - File
  - Location
- Sender does not receive own message push.
- Muted chats suppress message push.
- Disabled message/task/invite categories suppress that category only.

## Android

- Use FCM through a Capacitor-compatible push plugin.
- Store server credentials only in backend/Supabase secrets or server-side
  worker config.
- Request notification permission from a user action.

## iOS

- Use APNs credentials and TestFlight real-device QA.
- Simulator push is not a replacement for device QA.
- Ensure notification click opens chat/task/invite deep links.

## Grouping

Native platforms have different grouping behavior. Use stable logical tags:

- `message:chat:<chat_id>`
- `task:<task_id>`
- `invite:<invite_id>`

Platform-level notification history may still retain older cards depending on
OS settings. The app should always route the latest click safely.
