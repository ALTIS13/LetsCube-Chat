# Project Completion Status

This is a snapshot of the current production-readiness state. It is not a
replacement for release QA.

Snapshot updated: 2026-07-09. The detailed execution source of truth is
`docs/PRODUCTION_PRIORITY_TRACKER.md`.

## Chat/messaging

- Private and group chat are implemented.
- Incoming realtime sync has been hardened.
- Message ordering follows server timestamps.
- Safe chat open/jump/highlight exists for search and notifications.

## Media/voice/video/camera

- Staged attachments are implemented.
- Voice recording and staged preview are implemented.
- Video-circle recording, lock UX, staged preview, and playback polish are
  implemented.
- Regular rectangular video recording remains separate from video-circle.
- Camera photo capture works.
- Media viewer and chat media playback controller are implemented.

## Push notifications

- Browser/PWA push foundation exists.
- Push subscriptions and preferences are modeled.
- Message/task/invite notification delivery path exists.
- Message push copy, sender echo guard, mute handling, and same-chat tag
  grouping are documented and implemented in the web/SW path.
- Real delivery still requires environment-specific VAPID, Edge Function, and
  scheduler configuration.

## Phone verification

- Fake verification path has been removed.
- Phone is marked verified only after OTP success.
- Missing SMS provider shows friendly fallback.
- Real phone verification requires Supabase Auth SMS provider setup.

## Tasks/roles/locations

- Dynamic roles and permissions are implemented.
- Location task routing is implemented.
- Location staff can claim allowed staff-pool tasks.
- Clients do not see task/admin controls.
- Recurring tasks and scheduler setup are implemented.

## Search

- Global search v2 with filters is implemented.
- In-chat full-history search is implemented.
- Jump/highlight behavior is implemented.

## PWA

- Manifest, icons, installability baseline, service worker, update UX, and
  offline/reconnect shell are implemented.
- LETSCUBE identity is configured for the document title, Apple standalone
  title, manifest name and dedicated iPhone/PWA/maskable icons.
- Cached chat reopen, background reconciliation, sidebar optimistic updates and
  push-to-chat metadata hydration have been hardened for installed PWA use.

## Monitoring

- Frontend monitoring foundation exists.
- Sentry/self-host rollout is postponed until pre-packaging review.

## Self-host readiness

- Production currently runs through Coolify with self-hosted Supabase, Storage,
  Mailcow, the LETSCUBE web app and trusted worker on the LETSCUBE server.
- Data and media were migrated and verified in the production client.
- Runbooks cover operations, backups, DNS/TLS, cutover and rollback. An
  isolated restore drill is still required.

## Native readiness

- Capacitor Android groundwork and a debug APK exist and were physically
  exercised for auth, media recording and geolocation.
- Product delivery is intentionally focused on installed Web/PWA clients for
  desktop and mobile; APK release work is deferred.
- Native push, signing, app store metadata and deep links remain future work.

## Known gaps

- Real SMS provider setup and device QA.
- Native push token/device model.
- App signing for Android/iOS/Windows.
- Isolated restore drill.
- Sentry self-host decision and rollout.
- Startup permission capability batching: the current app shell issues 33 repeated role/location permission RPCs before the first meaningful chat interaction.
- Broader installed PWA device/push matrix.
