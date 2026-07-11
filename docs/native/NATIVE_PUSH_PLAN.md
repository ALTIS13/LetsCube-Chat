# Native Push Plan

LETSCUBE has a browser/PWA push foundation and an Android FCM delivery
foundation:

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

## Device token schema

The Android delivery migration applied after explicit approval is:

```text
.migration-backup/supabase/migrations/20260711_native_push_fcm_delivery.sql
```

It adds `user_push_devices`, the `register_push_device` /
`unregister_push_device` RPCs and the native delivery outbox.
The existing browser `push_subscriptions` table remains the Web/PWA model.

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

- Use FCM through `@capacitor/push-notifications`.
- Store server credentials only in backend/Supabase secrets or server-side
  worker config.
- Request notification permission from a user action.
- Android channels:
  - `messages`;
  - `tasks`;
  - `system`.
- The Android client must never print raw FCM tokens. Tokens go only to the
  authenticated registration RPC.

Current implementation status:

- Client permission, registration, channels and internal tap-routing foundation
  exists.
- `android/app/google-services.json` is present only on the packaging machine,
  intentionally ignored and untracked.
- Firebase Admin credentials are stored only in the trusted server environment;
  the repository contains no private key or service-account JSON.
- The self-hosted Edge Function sends FCM HTTP v1 messages from the native
  outbox while preserving the separate browser Web Push path.
- Physical Android QA confirmed registration, background delivery and opening
  the app from a system notification. Full real-account message/task/mute and
  killed-app scenarios remain release gates.

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
