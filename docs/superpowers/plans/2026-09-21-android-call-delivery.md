# Android Closed-Call Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a bounded, server-authored Android FCM ring/cancel signal for an active private call without creating an in-app notification row or changing existing message/task/system push behavior.

**Architecture:** `voice_channels` remains the source of truth for a ring. A separate transient outbox records only authoritative ring and cancel events; a trusted dispatcher validates device/session eligibility and builds a short-lived, data-only FCM message through a pure builder. Each event carries the server-selected recipient user and authenticated session UUID, and a native Android handler displays it only when both match the current verified local binding. The native handler owns replacing, expiring, cancelling, and tombstoning the OS call notification.

**Tech Stack:** PostgreSQL / Supabase RLS and RPCs, Deno Edge Functions, TypeScript, FCM HTTP v1, Capacitor 8, Java Android service, Node test runner, PGlite rehearsal tests, ADB physical QA.

**Spec:** `docs/proposals/2026-09-18-one-to-one-calls.md`

## Global Constraints

- The proposal's A/B/C/D2/E/F/G implementation areas already exist and remain regression boundaries. This plan extends only slice D, Android while the app process is closed. It does not claim that a new foreground incoming ring is surfaced on public routes outside `MainLayout`; that case remains unmeasured and outside this killed-process foundation.
- The authoritative ring remains `voice_channels.ring_started_at`, `ring_caller`, and `ring_answered_at`; no second call lifecycle is introduced.
- Existing `notifications`, `notifications_push_outbox`, and `notifications_native_push_outbox` remain unchanged and continue to own message/task/system delivery.
- Ring and cancel are data-only FCM messages. The envelope contains no top-level `notification`, Android `notification`, title, body, name, avatar, media URL, or message text.
- The current 45-second ring ceiling is also the maximum event lifetime.
- The builder performs formatting and structural validation only. Session validity, membership, blocks, recipient derivation, `calls_enabled`, device capability, preferences, and authorization belong to the database and dispatcher.
- `recipient_id` and `recipient_session_id` are server-selected UUID bindings, not credentials or bearer material. The native adapter stores only the current authenticated binding, replaces it after verified login/session refresh, clears it on logout, and requires an exact match before showing a call notification.
- FCM tokens remain only at the envelope transport boundary and never enter `message.data`, SQL outbox payloads, logs, tests, or reports.
- Voice fan-out and retries are at-least-once per eligible device. An FCM provider acknowledgement is not exactly-once delivery; per-device outcomes plus deterministic native ring-key deduplication provide idempotent effects.
- No `collapse_key` is used. FCM retains only four active collapse keys per registration token, and collapsing calls in different chats would discard independent rings.
- Existing browser/PWA, Windows, iOS, message/task/system FCM, and in-app notification behavior must remain unchanged.
- No production schema apply, deployment, release publication, device installation, or real FCM send occurs before its explicit task and gate.

## Pre-Rollout Baseline, 2026-09-21

Historical observations before Tasks 1-5. For the current disabled server rollout
and device availability, use [the rollout report](../../operations/2026-09-21-android-call-rollout.md).

- Production has live private-call RPCs, Realtime publication, missed-call sweep, per-session `calls_enabled`, Android FCM registration, native notification outbox, and one-minute push cron.
- Production has no voice ring outbox, no ring/cancel enqueue in voice RPCs, no push-device-to-session binding, no device call-protocol capability, no call FCM payload, and no Android call channel or killed-process handler.
- `user_push_devices.device_id` is null for every current row and the client currently sends `p_device_id: null`.
- The native outbox cannot carry a transient ring without fabricating a `notifications` row because `notification_id` is non-null and references `notifications(id)`.
- Table/function ownership is split: voice objects are owned by `supabase_admin`; push device and existing native outbox objects are owned by `postgres`. Schema work therefore uses separate migrations and separate owner rehearsals.
- Published Android Stable is `0.1.7` build `8`; the authorised Nothing device currently has `0.1.5` build `6`. That device remains untouched until the signed native candidate task.

## Firebase Contract Checked 2026-09-21

- [FCM message lifespan](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan): an accepted message ID is not proof of delivery; Android TTL is a duration, and `ttl=0` means an undeliverable message is discarded rather than stored. The client must still reject an event whose absolute expiry has passed.
- [Android message priority](https://firebase.google.com/docs/cloud-messaging/android-message-priority): `HIGH` may wake a sleeping device and gives only a short processing window. It must result in a prompt user-visible notification, with no network fetch before rendering.
- [FCM message types](https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type): data messages are processed by application code; notification messages are SDK-displayed and always collapsible. Ring/cancel therefore use `data` only.

## Review Focus

- A delayed ring must never be shown after `expires_at`, including when FCM accepted it earlier.
- A cancel must target exactly the same ring key as its ring, while a later ring in the same channel must get a different key.
- A cancel received before its ring leaves a tombstone for that ring generation until absolute expiry, so a reordered late ring cannot resurrect it. A cancel for an older ring key must not remove a newer generation in the same channel.
- A device with no verified session binding or `calls_enabled=false` must receive no call event while ordinary push remains unaffected.
- Foreground Realtime and background FCM must not produce two visible incoming-call surfaces for the same ring.
- A malformed or future-start payload must be ignored without opening the app, displaying a notification, or logging private data.

---

### Task 1: Freeze the Pure Voice FCM Contract

**Files:**
- Create: `supabase/functions/send-push-notifications/voice-payload.ts`
- Create: `tests/unit/voice-push-payload.test.mts`

**Interfaces:**
- Consumes: an untrusted runtime value whose accepted shape is `{ event: "ring" | "cancel", chat_id: string, channel_id: string, caller_id: string, recipient_id: string, recipient_session_id: string, ring_started_at: number, expires_at: number }`, an FCM token, and epoch-millisecond `now`. Both timestamp fields and `now` are non-negative JavaScript safe integers in Unix epoch milliseconds; the builder accepts no ISO strings, seconds, `Date` objects, or implicit coercion. The trusted dispatcher is the sole timestamp-normalization authority.
- Produces: `buildVoiceFcmMessage(input: unknown, token: string, now: number): VoiceFcmMessageEnvelope | null`.

- [x] **Step 1: Write the failing contract tests**

  Cover a valid ring, matching cancel key, a new ring in the same channel, floored TTL including `0s`, malformed DTOs, missing/invalid recipient session UUIDs, invalid time boundaries, caller equal to recipient user, distinct user/session namespaces, strict output allowlist, absence of notification/collapse fields, token isolation, and input immutability.

- [x] **Step 2: Run the RED test**

  Run: `node --test tests/unit/voice-push-payload.test.mts`

  Expected: FAIL because `voice-payload.ts` does not exist.

- [x] **Step 3: Implement the minimal pure builder**

  The output data keys are exactly `protocol_version`, `type`, `event`, `ring_key`, `chat_id`, `channel_id`, `caller_id`, `recipient_id`, `recipient_session_id`, `route`, `ring_started_at`, and `expires_at`. UUIDs are runtime-validated and normalized to lowercase. Self-call rejection compares `caller_id` with `recipient_id`, never a session or device identifier. Times are non-negative safe integer epoch milliseconds; `ring_started_at <= now < expires_at`, and `0 < expires_at - ring_started_at <= 45000`. Android priority is `HIGH`; TTL is `floor((expires_at - now) / 1000) + "s"`. Empty tokens and tokens containing leading, trailing, embedded whitespace or control characters return null without logging.

- [x] **Step 4: Run GREEN and existing FCM regression tests**

  Run:

  ```powershell
  node --test tests/unit/voice-push-payload.test.mts
  node --test tests/unit/fcm-delivery.test.mjs tests/unit/push-dispatcher-ownership.test.mjs
  pnpm.cmd --filter @workspace/kub run typecheck
  git diff --check
  ```

  Expected: all commands exit `0`; `fcm.ts` and `index.ts` remain byte-unchanged.

### Task 2: Add the Session Binding and Transient Outbox Under Their Real Owners

**Files:**
- Create via `pnpm.cmd exec supabase migration new android_push_session_binding --workdir .migration-backup`: `.migration-backup/supabase/migrations/*_android_push_session_binding.sql`
- Create beside that CLI-generated migration: matching `.rehearsal.sql` and `.rollback.sql` companions with the same generated timestamp stem
- Create via `pnpm.cmd exec supabase migration new android_voice_ring_outbox --workdir .migration-backup`: `.migration-backup/supabase/migrations/*_android_voice_ring_outbox.sql`
- Create beside that CLI-generated migration: matching `.rehearsal.sql` and `.rollback.sql` companions with the same generated timestamp stem
- Create: `tests/server/voice-ring-push-db.test.mjs`

**Interfaces:**
- Produces: server-derived `user_push_devices.session_id` and an RLS-closed logical outbox implemented as `voice_ring_push_events` plus `voice_ring_push_devices`, with idempotent ring/cancel events and separate device attempts.

- [x] **Step 1: Capture and verify a fresh pre-change schema backup**

  Record its path, size, SHA-256, target database identity, actual PostgreSQL server version, and restore readability. Check existing migration filenames before each `supabase migration new` call and fail rather than overwrite or reuse a colliding stem. Discover the installed CLI syntax with `pnpm.cmd exec supabase migration new --help`; do not hand-author timestamps. Do not proceed if the backup is not demonstrably the before-state.

- [x] **Step 2: Write failing PGlite contract tests**

  Assert that registration derives `session_id` from JWT rather than an RPC argument; legacy unbound devices are ineligible for call delivery; a stale session cannot receive after another account uses the same installation; callers never become recipients; ring insertion is unique by recipient/session/channel/start/event; answer, decline, caller cancel, replacement, and missed sweep create or expose a matching cancel state; all tables have RLS and no `anon`/`authenticated` table grants.

- [x] **Step 3: Rehearse the postgres-owned binding migration**

  Add nullable `session_id uuid references auth.sessions(id) on delete set null` and nullable `voice_call_protocol smallint check (voice_call_protocol = 1)` to `user_push_devices`. Registration never accepts a client-supplied session UUID: it reads the JWT `session_id`, verifies the live `auth.sessions` row belongs to `auth.uid()`, and rebinds the token on every refresh. Preserve the current seven-argument `register_push_device(text, text, text, text, text, text, text)` as an exact compatibility wrapper returning `void`. Add a distinct eight-argument overload whose `p_voice_call_protocol smallint` argument is required at the SQL signature level (the value may be `1` or null), require all other nullable arguments to be passed explicitly, and return exactly one verified `(recipient_id uuid, recipient_session_id uuid)` row to the authenticated adapter. Both wrappers forward to one non-exposed core implementation with explicit casts; the seven-argument wrapper calls the core with `null::smallint` and discards its result. Do not add defaults to the eight-argument overload: seven-argument and omitted-argument calls must remain unambiguous. Capture `pg_get_function_identity_arguments`, result types, privileges, owner, defaults, and representative old/new named calls in rehearsal tests before replacement. Generic push remains eligible when either binding field is null; voice push is fail-closed unless the device is session-bound and advertises protocol 1.

- [x] **Step 4: Rehearse the supabase_admin-owned outbox migration**

  Create the logical outbox using `voice_ring_push_events` (recipient/session/chat/channel/caller/generation/event/expiry/state) and `voice_ring_push_devices` (captured device id/lease/attempts/outcome/timestamps). Narrow private row triggers amend the existing voice RPC/sweep transactions without replacing their bodies. The dispatcher must revalidate the session and `calls_enabled` at claim/send time. Do not copy names, bodies, media, routes, or tokens into SQL.

- [x] **Step 5: Mutation-check both rehearsals**

  Removing caller exclusion, session ownership validation, expiry ceiling, terminal cancellation, RLS, revoke, unique idempotency, or owner assertion must make the corresponding rehearsal fail.

- [x] **Step 6: Stop before production apply**

  Review the two owner-specific migrations and their rollbacks. Applying them is a separate controlled action after this task passes.

  Completed 2026-09-21: 235 server tests, 18 mutations, independent review,
  real-owner PG17 full-schema round trips, real PostgREST and forced concurrency.
  [Evidence and remaining gates](../../operations/2026-09-21-android-call-delivery.md).

### Task 3: Connect a Trusted, Immediate Dispatcher Behind a Disabled Gate

**Files:**
- Modify: `supabase/functions/send-push-notifications/index.ts`
- Import: `supabase/functions/send-push-notifications/voice-payload.ts`
- Create: `tests/unit/voice-push-dispatch.test.mts`
- Modify: `tests/unit/push-dispatcher-ownership.test.mjs`
- Create: `20260921122846_android_voice_push_dispatch.sql` and matching rehearsal/rollback companions under `.migration-backup/supabase/migrations/`, as `supabase_admin`.

  Execution ruling, 2026-09-21: keep the independently reviewed Task 2 proposals
  byte-identical; add Task 3 separately instead of rewriting their proven inputs.
  Rollback order is Task 3, Task 2 outbox, Task 2 session binding.

**Interfaces:**
- Consumes: claimed `voice_ring_push_events` / `voice_ring_push_devices` rows and freshly revalidated session-bound, enabled Android/FCM devices.
- Produces: one FCM HTTP v1 send attempt per eligible device and a terminal/retry outbox transition without exposing the token.

- [x] **Step 1: Add failing dispatcher tests**

  Prove fail-closed behavior for absent, stale, or mismatched session binding, absent or unsupported `voice_call_protocol`, `calls_enabled=false`, revoked/disabled devices, expired/replaced rings, caller devices, and unsupported event protocol versions. Prove that ordinary native notification outbox dispatch remains unchanged.

- [x] **Step 2: Add a disabled voice-outbox drain**

  Claim with `FOR UPDATE SKIP LOCKED`, re-read the exact `voice_channels` ring before a ring send, and build only through `buildVoiceFcmMessage`. The dispatcher is the sole timestamp normalization authority: it parses PostgreSQL `timestamptz` strings once, rejects invalid dates, and passes non-negative safe integer Unix epoch milliseconds for `ring_started_at`, `expires_at`, and `now`; neither SQL payloads nor the builder guess units. It passes the server-selected `recipient_id` and freshly revalidated `recipient_session_id`. Cancel events retain the same ring key. Retries stop at absolute expiry. Delivery is at-least-once per device: persist each device attempt/outcome, tolerate uncertain provider acknowledgement, and rely on the deterministic ring key for native deduplication; never report an FCM acceptance as delivered.

- [x] **Step 3: Add immediate wake-up without changing the one-minute generic cron**

  Queue `net.http_post` in the same transaction after a new voice outbox event, using the existing production scheduler endpoint and secret lookup shape. The rehearsal inspects only secret names, never values. The dispatcher gate remains disabled, so this task sends no production ring.

- [x] **Step 4: Verify Edge and legacy-dispatcher ownership**

  The Supabase Edge function remains the sole owner of Web/FCM delivery. The legacy API push loop remains off and does not claim the voice outbox.

  Completed 2026-09-21 as disabled source/proposal only: independent spec/quality
  review, 291 server and 89 focused push tests, 20 mutations, actual PG17/PostgREST
  and deployed Edge-runtime rehearsal, forced races and exact rollback.
  [Evidence and device limitations](../../operations/2026-09-21-android-call-dispatch.md).

### Task 4: Build the Signed Android Native Candidate

Source/debug checkpoint, 2026-09-21: native receipt and session binding are complete,
independently reviewed and verified. A signed candidate is NOT built.
Version/signing/publication remain Task 5's explicit release gate.
[Current evidence](../../operations/2026-09-21-android-call-native.md).

**Files:**
- Create: `android/app/src/main/java/com/kub/messenger/VoiceCallMessagingService.java`
- Create: `android/app/src/main/java/com/kub/messenger/VoiceCallNotificationContract.java`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/src/main/java/com/kub/messenger/MainActivity.java`
- Modify: `artifacts/kub/src/lib/platform/nativePush.ts`
- Modify: `artifacts/kub/src/hooks/usePush.ts`
- Modify: `android/version.properties`
- Create: `tests/unit/android-voice-push.test.mjs`

**Interfaces:**
- Consumes: protocol version 1 data-only ring/cancel events.
- Produces: an importance-4 `calls` channel, deterministic per-ring notification identity, local absolute-expiry timer, cancel handling, and safe internal chat routing.

- [x] **Step 1: Characterize Capacitor delegation and write failing native contract tests**

  Replace the plugin manifest's `MESSAGING_EVENT` service with the LETSCUBE service. Delegate non-voice messages and token refresh to Capacitor unchanged. Reject malformed, stale, future-start, self-recipient, recipient-user mismatch, recipient-session mismatch, or unsupported events before notification creation. Tests cover cancel-before-ring and reordered duplicate delivery: a cancel writes a per-ring tombstone retained until absolute expiry, a late ring with that key stays suppressed, an older cancel cannot remove a newer ring in the same channel, and repeated ring/cancel events are idempotent.

- [x] **Step 2: Implement immediate local handling**

  Display the call notification from payload data only, without network fetches. Ring and cancel resolve the same deterministic notification id; a new start time in the same channel resolves a different id. Tombstones and active notifications are keyed by the full ring generation, not only channel. The local timer removes the card and tombstone at `expires_at` even when cancel is late or absent.

  API 26+ OS timeout removes an already posted card after process death; API 34
  two-process instrumentation proved this independently of the app timer.
  Private tombstones expire logically at the deadline and are lazily pruned on
  next access when the process is absent. API 24-25 capability stays disabled.

- [x] **Step 3: Bind push registration to the current server session**

  Registration uses the exact eight-argument overload and sends `p_voice_call_protocol: 1`; the server still derives and validates the session claim. After authenticated login/session refresh, write the returned verified `{ recipient_id, recipient_session_id }` binding to native-private storage before call events become eligible; replace it atomically when the account/session changes and clear it on logout, auth invalidation, and local account removal. Re-register on authenticated resume so an upgraded legacy device becomes eligible without token exposure or local raw-token storage. Native receipt compares both payload UUIDs with this binding before displaying anything.

- [x] **Step 4: Keep full-screen presentation out of the first activation**

  The first candidate uses a high-importance heads-up call notification. `USE_FULL_SCREEN_INTENT` is not added until store eligibility and Android policy acceptance are separately demonstrated; this does not block killed-process notification delivery.

### Task 5: Physical Matrix, Then Explicit Activation

**Files:**
- Modify after evidence: `docs/PRODUCTION_PRIORITY_TRACKER.md`
- Modify after evidence: `docs/operations/voice.md`
- Modify after evidence: `docs/native/NATIVE_PUSH_PLAN.md`
- Modify after evidence: `docs/QA_RESULTS.md`

**Interfaces:**
- Produces: measured foreground/background/screen-off/killed behavior and a controlled activation or rollback decision.

- [x] **Operational prerequisites: source and isolated rehearsal before enabling either gate**

  Establish observable immediate-wake failure/recovery within the original
  45-second lifetime, bounded handling when multiple drains or more than 20
  targets overlap, and an authorized retention cleanup for expired/exhausted
  outbox rows. The current minute fallback is not a deadline guarantee. Measure
  aggregate capacity and queue age without tokens/payloads. Do not call delivery
  production-ready while these or native receipt checks are unproven.

  Completed as disabled proposal, 2026-09-21: five-second recovery, fixed four
  wake slots, global 16-lease cap, aggregate health and strict 24h/500+500 retention.
  Real pinned PG/net/cron/PostgREST/Edge proves 80 targets, immediate 503 recovery,
  no sends after expiry, delayed-commit admission, forced cleanup race with a
  single-guard mutant, and exact rollback. Both new jobs install inactive.
  Stale 30s is a reclamation threshold plus next-tick latency; locked queued work
  retains capacity rather than being replaced. Not a hard lifetime/SLA promise.
  [Task 5 operational evidence](../../operations/2026-09-21-android-call-operations.md).
  Manual files: `supabase/migration-proposals/20260921153256_android_voice_push_operations*.sql`
  with byte-identical `.migration-backup` copies, outside automatic CLI discovery.

- [x] **Step 1: Apply owner-specific schema only after backup and rehearsals pass**

  Apply the binding migration as `postgres`, then outbox and dispatcher migrations
  and operations proposals as `supabase_admin`, each once in its own transaction
  with raising self-checks. Keep recovery/cleanup cron jobs inactive as well.
  Deploy the reviewed Edge code separately with both gates disabled. Verify actual
  runtime code, roles and gate state; a web Git push does not deploy this Edge code.

  Completed 2026-09-21: fresh full SQL archive restored offline, owner-specific
  apply/rollback rehearsed, four production migrations applied once. Edge runtime
  bytes and authenticated disabled response verified; gates off, jobs inactive.
  [Rollout evidence and limits](../../operations/2026-09-21-android-call-rollout.md).

- [ ] **Step 2: Build and verify one signed candidate**

  Run the existing production release builder and verifier. Confirm package id, signer continuity, version/build increment, non-debuggable status, and artifact SHA-256 before installation.

- [ ] **Step 3: Upgrade an available authorised device without clearing data**

  Use `adb install -r` only after the owner-authorized candidate and signer/data
  continuity gates. Verify session preservation and session-bound enabled FCM
  registration without printing a token. Nothing is unavailable as of 2026-09-21;
  Realme is authorized but uses microG, has an old Firebase-free APK and denied
  notification permission. Keep microG compatibility and official-GMS proof
  separate; neither an old APK nor an emulator substitutes for the required
  physical cases.

- [ ] **Step 4: Run the physical matrix**

  Measure ring appearance and cancel removal with app foreground inside `MainLayout`, public/auth routes outside `MainLayout`, background, screen off/Doze, process removed, permission denied, calls disabled for this session, account switch on one installation, reordered cancel-before-ring injection, and two signed-in devices. Treat public-route incoming ringing as a separate measured gap, not as inherited proof from the current foreground shell. Record latency and the user-visible result, not raw logs or identifiers.

- [ ] **Step 5: Activate narrowly or roll back**

  Enable voice dispatch only after every required physical case passes. Observe aggregate accepted/retry/expired/cancelled counts without payloads or tokens. On failure, disable the dispatcher first; existing Realtime ringing and ordinary push continue unaffected.

## Self-Review

- Spec coverage: A/B/C/D2/E/F/G are acknowledged as existing implementation areas, without claiming unmeasured public-route foreground behavior; only closed Android delivery is planned.
- Contract coverage: ring/cancel identity, cancel-before-ring tombstones, 45-second expiry, HIGH priority, data-only payload, token isolation, recipient user/session binding, at-least-once per-device delivery, foreground dedupe, native expiry, and activation order each have an owning task and test gate.
- Ownership: postgres and supabase_admin changes are separated; no migration assumes cross-owner authority.
- Safety: generic notifications and push outboxes remain intact; no production send is part of the foundation task.
- Placeholder scan: the plan contains no unresolved implementation choices required by these five tasks.
