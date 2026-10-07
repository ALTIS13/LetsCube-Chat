# Android read-card cleanup and 0.1.12 candidate

## Authority and scope

The owner's latest instructions authorize necessary database changes and native
build/sign/update/publication after affected-boundary verification. This does not
waive backup, rollback, signer continuity, real-device acceptance or privacy.
Coordinator owns build/device/release; independent workers own native source,
read-only review and the isolated D-335 PG17 rehearsal. A063 belongs to Apollo.

## Observed causes and repair

D-351 shared-web ownership was deployed in `a9c84de3`, but Android had no native
read-card cleanup bridge. A blanket chat-tag cancellation could remove a newer
unread replacement. Android's notification service also enqueues posts, so
locking the application's calls alone does not prove which OS card is current.

The new `ChatNotifications` bridge accepts exact server-confirmed notification
and message pairs. It checks the app-owned card protocol, chat, pair and latest
post generation. Latest post intent is persisted before posting; a cold process
can validate a previous card. A local document/account lease retires obsolete
callbacks, including same-account epoch changes. This is a presentation fence,
not independent authentication or atomic Auth-to-OS synchronization.

If persisting intent fails, generic delivery remains available under a separate
untracked identity. Canonical PendingIntent creation happens only after the
durable write succeeds, so a failed replacement cannot rewrite the old card's
tap extras. Legacy/missing-ID and untracked cards intentionally are not removed
automatically. Voice notifications and provider-v1 redaction remain unchanged.

The Android caller handles both newly confirmed reads and initially read server
rows even when an older notification in the same chat remains unread. Browser
tag cleanup retains its existing unread protection. A per-owner seen-pair set
avoids duplicate IPC on unchanged refreshes.

Android enqueue reference:
[AOSP NotificationManagerService](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android16-release/services/core/java/com/android/server/notification/NotificationManagerService.java).
PendingIntent creator-update semantics:
[Android API](https://developer.android.com/reference/android/app/PendingIntent#FLAG_UPDATE_CURRENT).

## Source verification

- Actual Java producer/cleanup/probe: 57/57, including 27 compiled mutants.
- Native JS cleanup: 25/25; actual hook cleanup: 7/7; adjacent ownership: 19/19.
- Typecheck: exit0. Existing-JBR debug Java and AndroidTest compile pass.
- Actual Gradle JUnit: 4/4, no failures/errors/skips.
- Version0.1.12/build13 metadata/build-signing/verifier tests: 37/37.
- Independent final source/release-helper review: pending.

These do not yet constitute real OS, Firebase transport or installed-client
proof. Do not repeat unchanged accepted suites; test newly changed inputs.

## Candidate and device boundary

Published Android remains 0.1.11/build12 at this checkpoint. Its verified APK
SHA256 is `9242a541b93833811bc76547eece69d64c1e3c820765de7a454352ec2b7a941f`;
its existing signer must be retained. Old APK/AAB copies are byte-identical in
ignored private evidence. The current stable manifest SHA256 is
`d5ed19f0edeadb7115d3fe6a0d212e4338aa99893a0ddabc2bd316f45ecb9348`.

Realme RMX3830, Android15: a new ephemeral testing user10 isolates fictional
cards and anonymous WebView checks from primary-user data. No screenshots,
traces, personal UI dumps, logout or data clearing. Release instrumentation
uses a QA-only test application ID and must have the release APK's signer.
Primary app-code upgrade is authorized, but userdata must be retained. Never
run `connected*AndroidTest` across attached devices.

Acceptance gates before immutable stable publication:

1. Freeze/review source and commit before web/Capacitor release build.
2. Actual signed APK/AAB, Firebase initialization resources, production config,
   package identity, V2 signer continuity and every bundled web asset's byte parity.
3. Selected user10 actual OS old/new/missing-ID/voice cleanup, immediate queued
   replacement, and persisted-card post -> fresh process -> read removal.
4. Anonymous bundled React mount, native bridge availability and guest geometry.
5. Remove only the created QA test package/profile; restore primary user0.
6. Upload verified bytes; backup/check prior catalog under publication lock;
   atomically publish non-mandatory0.1.12/13; verify public catalog and actual APK.

Rollback restores the byte-identical prior catalog under the same lock; it does
not delete immutable artifacts or downgrade already installed clients. Direct
producer fixtures are not FCM-delivery acceptance. The isolated D-335 migration
rehearsal is independent, and no production SQL has been applied in this slice.
