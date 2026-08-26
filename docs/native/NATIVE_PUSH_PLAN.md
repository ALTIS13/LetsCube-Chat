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
- Earlier Android foundation QA confirmed registration, message/task delivery
  semantics, category suppression, grouping, background and killed-process
  delivery, plus exact-message notification tap routing. That historical
  evidence was not promoted by itself; fix round 3 established a separate
  authenticated registration and fresh acceptance on the signed candidate.
- The signed `0.1.2/3` candidate passed Android 13/14/16 Google Play emulator
  notification-permission and lifecycle checks. Separately, the Android 15
  official-GMS Nothing A063 passed its bounded physical permission, callback
  and authenticated notification cases described below; emulator lifecycle is
  not treated as authenticated physical coverage.
- Fix round 3 established an authenticated session and active native
  notification registration on an unpublished same-key QA baseline, then
  proved session/chat/registration retention after direct upgrade to restored,
  non-debuggable final `0.1.2/3`.
- On the official-GMS Nothing candidate, background and killed-process delivery
  produced grouped `messages` system cards. Card taps routed through final
  `MainActivity` to the exact chat/event and completed coherent delivered/read
  synchronization in fix round 3.
- Fix round 1/5 used one bounded credential submission on the official-GMS
  Nothing baseline without reading field values back. The login form remained
  after 25 seconds and no app-shell/chat marker appeared, so no second attempt
  was made and no signed-candidate FCM registration or delivery claim was
  added. Safe permission and callback lifecycle checks still passed.
- Fix round 2/5 built one same-key QA baseline with a temporary, uncommitted
  WebView-debug call. Compiled bytecode contained the call, but Android 15
  published no app devtools socket and a single bounded forward exposed zero
  CDP targets. The credential helper was not invoked. The call was removed from
  source and compiled final bytecode before rebuilding/verifying `0.1.2/3`, so
  authenticated FCM registration and delivery/tap acceptance remain open.
- Fix round 3/5 additionally enabled `android:debuggable=true` only in the
  ignored unpublished QA baseline, allowing one bounded CDP login. All
  temporary call/flag/version edits were restored before the final build; final
  source and DEX have zero WebView-debug calls and final APK/AAB manifests are
  non-debuggable. An earlier missing card while DND was active is recorded as
  an environmental false negative. Fresh post-DND background and killed card,
  exact-chat tap and read-sync checks passed without printing payloads or
  tokens.
- Fix round 4/5 used one further controller-approved same-key, same-version
  unpublished QA overlay for bounded CDP instrumentation. An independent native
  `pushNotificationReceived` listener observed the foreground FCM transport,
  and the resulting unread state was visible. Authenticated offline/reconnect,
  first-unread anchoring and bounded geolocation also passed. The synthetic
  message and all temporary listeners/helpers were removed.
- Final source/Gradle state was restored before rebuilding and reinstalling
  exact nondebuggable `0.1.2/3`; the authenticated shell survived and no WebView
  debug socket or ADB forward remained. Media/camera/regular-video/video-circle/
  voice, remaining physical large-history/footer cases and explicit logout/login
  remain skips, so Task 4 is still open.
- Realme RMX3830 is a custom microG device. It may provide optional UI/media
  coverage but must never count toward FCM acceptance.

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
