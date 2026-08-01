# Project Completion Status

This is a snapshot of the current production-readiness state. It is not a
replacement for release QA.

Snapshot updated: 2026-07-28. The detailed execution source of truth is
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
- Message search remains bounded and indexed; the current largest production
  chat averaged 33.221 ms over 20 full-history RPC runs.
- Permission-aware people lookup accepts only a complete normalized `+E.164`
  query, requires `users.view`, matches a verified contact exactly and returns
  profile metadata without exposing the phone value.

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

## Privacy and support

- Public privacy policy and support routes are implemented.
- The guest support flow opens a chat immediately after name/email/phone,
  category, subject, message, consent and CAPTCHA validation.
- The guest secret is device-local in IndexedDB; only an HMAC digest is stored
  server-side.
- Support schema, RLS, permission-scoped RPCs, immutable events, notification
  fan-out and abuse limits are applied in production after backup/rehearsal.
- The `support-gateway` Edge Function is deployed and rejects unapproved
  origins before processing.
- Operator workspace, permission-gated queue/actions/settings, per-operator
  notification preferences and support Notification Center integration are
  implemented. Public and operator Playwright matrices pass locally at five
  required desktop/mobile viewports.
- Mailcow domain/mailbox/aliases and the server-only IMAP/SMTP bridge are
  prepared. The atomic queue/RPC, intake guard, delivery hardening and
  idempotent acknowledgement migrations are applied after restore rehearsal
  and rollback-safe production smoke. A hardened non-public Coolify worker is
  deployed healthy with mail processing disabled. DNS publication, worker
  enablement and physical inbound/outbound/reply smoke remain open.
- Support attachments/malware scanning, scheduled retention and final legal
  review remain open.

## Self-host readiness

- Production currently runs through Coolify with self-hosted Supabase, Storage,
  Mailcow, the LETSCUBE web app and trusted worker on the LETSCUBE server.
- Data and media were migrated and verified in the production client.
- Runbooks cover operations, backups, DNS/TLS, cutover and rollback. An
  isolated restore drill is still required.

## Native readiness

- Capacitor Android groundwork, production-configured internal APK, FCM
  registration/delivery foundation and physical auth/media/geolocation QA exist.
- Tauri 2 is the selected Windows client. Secure startup, tray/single-instance,
  updater signing, cross-version updates and exact native notification routing
  are physically verified through `0.2.7/11`.
- Windows has a fail-closed Authenticode build path, provider-isolated WNS
  backend delivery helper, sanitized capability matrix and isolated native
  offline/long-session QA runner.
- Android release signing/AAB, Android app links/recovery callback,
  a real Authenticode publisher/SmartScreen reputation, Windows package
  identity/PFN/client WNS registration, killed-process Windows delivery and
  broader device matrices remain open.
- iPhone/iPad PWA and iOS work are owned by a separate execution stream and
  must not be duplicated from the backend/interface/Windows/Android stream.

## Known gaps

- Real SMS provider setup and device QA.
- Android release signing/AAB and broader official Google Play Services QA.
- Windows Authenticode/SmartScreen and killed-process WNS delivery.
- Isolated restore drill.
- Sentry self-host decision and rollout.
- Startup permission capability batching: the current app shell issues 33 repeated role/location permission RPCs before the first meaningful chat interaction.
- Broader installed PWA device/push matrix.
- Physical support email ingestion/reply delivery, safe attachment pipeline
  and full ticket retention/restore rehearsal.
