# Realme Android 15 / microG Push QA, 2026-09-23

Owner: Codex. Device: owner-authorized Realme RMX3830, Android 15, Android
WebView 137.0.7151.72, microG GmsCore initially 0.3.15.250932. Scope: local debug APK
and physical QA only. No release signing, publication, production schema/Edge
change or provider credential exposure.

## Installed build and permission

The preexisting LETSCUBE 0.1.3/build 4 had notification permission denied and
zero of six named Firebase initialization resources. The current debug
0.1.7/build 8 had all six names. The owner designated Realme a disposable test
device; only `com.kub.messenger` was uninstalled, then the current debug APK was
installed. Its previous local app session was lost. A QA client account signed
in without credentials appearing in output.

On the new install, the Capacitor plugin returned `prompt` while the settings
row incorrectly displayed blocked/no Enable button. The authenticated
noninteractive push restore mapped an unrequested `prompt` to `native_denied`.
The adapter now returns `native_inactive` for a noninteractive prompt, retaining
`native_denied` for a real denial. The regression failed on the old code and
passed after the change. The rebuilt debug APK on Realme offered Enable; it
opened Android's notification permission dialog, and the resulting permission
was `granted=true, USER_SET`.

## FCM transport result

After permission was granted, the settings row reported unavailable. A focused
Android instrumentation test obtains no token value in its output: the FCM
token request failed with `IOException` after about 10 seconds. The same test
confirmed that Google Play Services availability API reports success. microG
Cloud Messaging was enabled, but its device registration page displayed "Not
registered" and LETSCUBE was absent from the visible registered-app list.
Switching device registration off/on did not register it. Device DNS/ICMP and
TLS to `android.clients.google.com` worked (an unauthenticated HEAD request
returned HTTP 400); this proves transport, not successful check-in.
The official microG setup guidance also recommends a reboot. After reboot, the
phone was unlocked with a normal ADB wake/swipe gesture; the supplied PIN was
not needed or echoed. The non-root ADB secret-code check-in broadcast was
rejected by Android's permission enforcement. The system dialer accepted the
documented check-in sequence, but device registration stayed Not registered.

microG's self-check passed signature spoofing, installed services, companion
signature and framework checks. Its notification permission was granted. The
installed GmsCore was updated in place to the official 0.3.16.252432 APK after
verifying the signing certificate matched; a local copy of the previous APK
remains in ignored QA output. Companion was also updated in place from
0.3.15.40226 to the matching official 0.3.16.40226 with the same signer check
and an ignored APK backup. The device profile was changed from an explicitly
selected Nexus 5X/Android 8.1 to Automatic: Device. Registration was toggled
and the phone rebooted after the upgrade. It still reports Not registered,
Cloud Messaging is enabled but disconnected, and its registered-app list is
empty. `mtalk.google.com:5228` accepts a TCP connection; this does not prove
check-in or FCM delivery. The token-only test still fails with `IOException`
on the updated setup. LETSCUBE cold-launched after the microG upgrade, its
WebView reached a mounted React root, and Android notification permission
remained granted.

As a final bounded device diagnostic, only `com.google.android.gms` app data
was cleared with `pm clear`, then device registration and Cloud Messaging were
re-enabled and the Realme rebooted. This reset microG's prior settings and
registrations for other apps on this owner-designated test phone. The fresh
state still showed Not registered, and the FCM token test still failed with
`IOException`. Neither a system-wide reset nor any LETSCUBE server mutation
was performed.

`node --test` on the native voice adapter/controller, settings rows and push
preferences: 74/74 pass. Kub typecheck: exit 0. Production-configured debug
build and Android instrumentation APK build: exit 0, with existing Vite/Gradle
warnings. Physical instrumentation: Play Services availability 1/1 pass;
FCM token 0/1 pass (`IOException`). Instrumentation's shell exit code is 0 even
on JUnit failure, so the test result must be read from `FAILURES`, not that exit
code. A broad 15-test instrumentation run reported 12 failures: one FCM token
failure and 11 tests that deliberately reject a non-owned physical device;
one two-process probe was skipped. It is not a valid full-suite regression
result for Realme. No raw FCM token or QA credential was printed or committed.

## Check-in root cause and recovery (later on 2026-09-23)

The exact `GmsCheckinSvc` stack trace, captured without identifiers or tokens,
showed `org.microg.gms.common.NotOkayException` from
`HttpFormClient.request` via `AuthRequest.getResponse`, before the device
check-in request. Android AccountManager still held one Google account after
the earlier GmsCore data reset. On this owner-designated test phone, that
device-local Google account binding was removed through Android Settings;
this also removed its synchronized local data from the Realme. The Google
account itself was not deleted. No account name or credential was displayed.

With zero Google accounts in AccountManager, a forced microG check-in logged
success. Its settings now show a recent device registration. The focused
instrumentation reports `OK (2 tests)`: Play Services availability and
`FirebaseMessaging.getToken()` both pass, without exposing the token. microG
Cloud Messaging is enabled, shows a connected state, and lists LETSCUBE as one
registered app. The diagnosis is a stale/broken account authorization path in
microG, not evidence that the APK needs a replacement Google-services stack.
Installing another GmsCore APK or changing the ROM is unnecessary and was not
attempted.

This supersedes the unregistered/token-failure result above; those paragraphs
remain as the chronological diagnostic record. Server-side device registration,
actual foreground/background/closed-process notification delivery, and tap
routing were still unproved at this checkpoint.

## End-to-end FCM delivery and payload correction (later on 2026-09-23)

The QA client then registered a fresh active Android/FCM device row on the
self-hosted server. A single QA message sent from the QA owner account created
a native outbox row, but the first FCM attempt returned HTTP 400 and revoked
the new device. The APK Firebase project and server `FCM_PROJECT_ID` matched.
No token or credential was printed.

A one-off, server-local FCM `validate_only` probe used the same device token:
minimal notification HTTP 200; the original full LETSCUBE payload HTTP 400
with both `google.rpc.BadRequest` (`message.data`) and
`google.firebase.fcm.v1.FcmError` (`INVALID_ARGUMENT`). Removing only
`message.data.message_type` yielded HTTP 200; renaming it to
`message.data.kub_message_type` also yielded HTTP 200. Thus the device token
was valid; `message_type` was a reserved FCM data key. The previous provider
error classifier also incorrectly revoked a device when a payload
`BadRequest` and an FCM error appeared together.

The patch emits `kub_message_type` and preserves the legacy client read
fallback. It refuses to revoke on HTTP 400 when `google.rpc.BadRequest` is
present. Red/green tests exposed both failures before the patch and now pass.
Twenty focused push/projection tests pass; Kub typecheck exits 0. The server
entrypoint and old `fcm.ts` hashes matched the checkout before deployment.
Only `fcm.ts` was replaced in the mounted Edge Function; the original is
retained as `fcm.ts.bak.20260923` beside it. The Edge container was restarted,
is healthy, and its mounted `fcm.ts` hash matches the reviewed source. No SQL
or schema was changed. Browser/PWA push code was not deployed or modified.

After app restart, the QA device row became active again. With the app in the
background, an owner-to-client QA message was accepted by FCM (`sent_at`, no
error) and appeared as an Android notification. A real tap opened LETSCUBE
and rendered that exact message in the chat. With the app in the foreground,
the next QA message appeared in the open conversation. For process-death QA,
the background debug app process was killed under its own UID via `run-as`
without setting Android's force-stopped state. A new message produced an OS
notification; FCM respawned the process, and the card tap opened the target
message. This does not claim delivery after Android force-stop, which has
different platform semantics.

The production-configured **debug** APK was rebuilt with the client parser
change and installed over the QA app without clearing data or notification
permission. Firebase instrumentation passed 2/2 again. A final background
message on this rebuilt APK produced an error-free FCM send, Android card,
and exact message navigation. The debug build completed with existing Vite
sourcemap and Gradle deprecation warnings. No release signing, AAB, production
APK publication, or broad device-matrix claim was made.

## Remaining proof

1. Compare on an official-GMS Android device. One microG Realme passing these
   QA flows cannot establish device-matrix reliability.
2. Build, sign, and publish a separately authorized Android release candidate;
   verify the installed signed APK, not only this production-configured debug APK.
3. Keep killed-process delivery distinct from Android force-stop, and repeat
   longer offline/Doze/reconnect tests before claiming sustained reliability.

Reference: [microG installation and background-service requirements](https://github.com/microg/GmsCore/wiki/Installation),
[microG check-in guidance](https://github.com/microg/GmsCore/wiki/Helpful-Information),
[official GmsCore release](https://github.com/microg/GmsCore/releases/tag/v0.3.16.252432),
[microG Cloud Messaging network roles](https://github.com/microg/GmsCore/wiki/Google-Network-Connections).

## GMS emulator and idle/reconnect follow-up (2026-09-23)

A separate Android 13/API 33 Google Play AVD was created for this test; the
pre-existing API 34 AVD had an APK signed by a different key and was not
modified. The fresh AVD has Google's GmsCore and Play Store, accepted the
production-configured debug APK and instrumentation APK, and passed both
`FcmRegistrationSmokeTest` cases (Play Services availability and token
acquisition). This extends registration coverage to an official-GMS stack,
but is not a second physical handset or end-to-end delivery on that stack.

The FCM payload previously set `NORMAL` for chat messages. Firebase documents
that normal-priority delivery can wait in Doze and recommends `HIGH` for
user-visible chat notifications. A red/green test now requires `HIGH` for
message and task categories and retains `NORMAL` for routine system events.
Only `fcm.ts` was copied to the mounted Edge Function after an exact backup;
the container returned to healthy. No web/PWA push code or schema changed.
[Firebase priority guidance](https://firebase.google.com/docs/cloud-messaging/android-message-priority).

On the Realme, a QA message under forced deep idle produced a newer native
notification at the 30-second poll before the priority change. The same test
after the change produced a newer card at the 50-second poll. Both runs
restored `deviceidle=ACTIVE` and the original battery state. These samples
prove delivery while forced idle, **not** a latency improvement: the server
outbox is scheduled once per minute, so dispatch phase dominates this small
sample. Raw device tokens and message bodies were not logged.

An offline/reconnect test disabled only the Realme's Wi-Fi (mobile data was
already off), sent one QA message, and found no new card offline as expected.
Wi-Fi was restored and Internet connectivity verified, but no newer card
appeared in 150 seconds. The QA recipient's native outbox row had `sent_at`
and no error. A later QA message sent while online produced a new card after
90 seconds. The missing offline card remains **unresolved**: FCM acceptance
does not prove handset delivery, and microG reconnect/queue behavior versus
per-chat collapse cannot be separated by this probe. The app's in-app
notifications remain the source of truth. Do not claim reliable offline queue
delivery on microG or promote this debug APK to Android Stable on this evidence.

Validation in this continuation: focused push/projection/Web Push tests 21/21;
Kub typecheck exit 0; unit suite 4077 passed, 1 skipped; server suite 334/334;
API build exit 0; web production build generated `sw.js` and completed in
22.11 seconds. A first Playwright run had 11 fixture-guard failures because
the dev server used a real backend URL; with the required local mock URL,
Android bottom navigation passed 3/3 and support layout 8/8. The first run's
other 24 cases passed, with three desktop-only bottom-nav skips.
