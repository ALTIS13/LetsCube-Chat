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
- Version 0.1.12 / build 13 metadata/build-signing/verifier tests: 37/37.
- Independent final source/release-helper review: accepted, no open P1/P2.
- Additional pending-NEW -> capability rotation -> OLD/current NEW cleanup:
  one actual-source GREEN, one compiled omission mutant detected.

Source tests alone are not OS/Firebase/installed-client proof. Selected actual
OS and installed-client checks below passed; Firebase transport was not exercised
by the direct-producer fixtures. Do not repeat unchanged accepted suites.

## Candidate and device boundary

Previous published Android was 0.1.11/build12. Its verified APK
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

Completed acceptance gates for immutable stable publication:

1. `[x]` Freeze/review source and commit `d86975dd` before web/Capacitor release build.
2. `[x]` Actual signed APK/AAB, Firebase initialization resources, production config,
   package identity, V2 signer continuity and every bundled web asset's byte parity.
3. `[x]` Selected user10 actual OS old/new/missing-ID/voice cleanup, immediate queued
   replacement, and persisted-card post -> fresh process -> read removal.
4. `[x]` Anonymous bundled React mount, native bridge availability and guest geometry.
5. `[x]` Remove only the created QA test package/profile; restore primary user0.
6. `[x]` Upload verified bytes; backup/check prior catalog under publication lock;
  atomically publish non-mandatory 0.1.12 / 13; verify public catalog and actual APK.

## Installed and published outcome, 14:53 Moscow

Realme RMX3830 / Android 15 was upgraded with `install -r --user 10`, preserving
primary userdata. Same-signer release instrumentation used a QA-only package.
Four individually selected tests passed, zero skips: ordinary read/newer pending
replacement/missing-ID/voice boundaries; cold-stage post; fresh-process read
with an empty static cache; anonymous bundled React/native bridge/viewport.
No all-device runner, personal capture, login, DB mutation or A063 operation.

Returning to user0 automatically removed the ephemeral QA profile. An explicit
remove during that automatic transition returned an error; independent closure
then verified user10 absent, QA test package absent from primary, user0 current
and the updated primary application present. No broad cleanup was used.

Release: 0.1.12 / build 13, 7,629,027 bytes; SHA256
`9fe235e5ca8a182729386bd82663e3edec0d0310b1782fdb382023b9acb2b47b`.
Signer SHA256 remains
`AC8249647E3E32B32E7DBA283C6C7BC835F293401A3CF82115901CE74F4A0839`.
Fresh embedded web build `a697cfc66bb39f13` includes the accepted capture/auth/
receipt repairs. All 33 runtime web assets match the rebuilt web output exactly.
The existing AAPT `.*` rule excludes only the web-host `.well-known/assetlinks.json`
endpoint; it is not an embedded runtime asset. Generic v1 redaction is retained.

[Published APK](https://api.letscube.ru/releases/files/android/0.1.12/letscube-0.1.12.apk)
and [Stable catalog](https://api.letscube.ru/releases/v1/android/stable.json) were
independently re-fetched: exact version/build/size/hash, non-mandatory update and
full Android release verifier pass. Publication used an immutable new directory,
under-lock prior-catalog hash guard and byte-identical backup. The backup and
scoped rollback helper are retained in the private release staging/evidence.

Web/main `d86975ddcf62b8c9faa3cc99e71b851757a5717f` is the sole healthy runtime,
image ID `sha256:5b86d47d2f66b65445a672bca095043949f298b8460af4f2b9f24e66e9e38d6d`.
Own-tree pre-push guard verified 2 commits / 11 JS-TS files / 18 aliases, no SQL/server
delta. New ChatNotifications/cleanup-binding markers changed0/0 ->2/1; existing
read RPC stays1. Public entry `/assets/index-Bzj8bQ54.js` and SW hashes match the
running container; old `/assets/index-DwddQARP.js` remains byte-identical.
Anonymous home/login200, mounted, zero page errors. These no-capture checks do
not certify private authenticated chat UI or full phone-recording/device QA.

Private evidence: `.ops-private/20261007-android-0.1.12-evidence/` and
`.ops-private/20261007-native-cleanup-web-*.json`. No secrets or personal rows
are committed. Source/review workers and finite native commands completed.

Rollback restores the byte-identical prior catalog under the same lock; it does
not delete immutable artifacts or downgrade already installed clients. Direct
producer fixtures are not FCM-delivery acceptance. The isolated D-335 migration
rehearsal is independent, and no production SQL has been applied in this slice.
