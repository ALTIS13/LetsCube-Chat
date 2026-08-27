# Android Capacitor Plan

Target: maintain a verified signed Android production candidate without
changing KUB web behavior or publishing before the external release gates pass.

## Phase 0: prerequisites

- Stable web build:
  - `pnpm.cmd --filter @workspace/kub run typecheck`
  - `PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build`
  - `pnpm.cmd e2e:smoke`
- Android Studio installed on a packaging workstation.
- Supported JDK and Android SDK installed. `JAVA_HOME` must point to a JDK
  with `javac`, not a JRE-only install.
- Production-like HTTPS domain, for example `https://kub.example.com`.
- Supabase Auth redirect URLs configured for web and future Android deep links.
- LETSCUBE icon and splash resources generated from the official club mark.

## Phase 1: current MVP groundwork

Current repository groundwork:

- Capacitor config: `capacitor.config.ts`
- Android project: `android/`
- App id: `com.kub.messenger`
- App name: `LETSCUBE`
- Web assets directory: `artifacts/kub/dist/public`
- Android version: `versionCode 3`, `versionName 0.1.2`
- Reproducible icon/splash source: `assets/logo.svg`
- Android asset generation script: `pnpm.cmd android:assets`
- Android sync script: `pnpm.cmd android:sync`
- Android Studio open script: `pnpm.cmd android:open`
- Debug build script: `pnpm.cmd android:build:debug`
- Signed production build script: `pnpm.cmd android:build:production:release`
- Signed APK verifier: `pnpm.cmd android:verify:release -- <apk>`

The asset/build sync flow is:

```powershell
pnpm.cmd android:assets
cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"
pnpm.cmd android:sync
```

Use Android Studio for emulator/device runs and debug APK inspection. Signed
production builds must load signing inputs only through the ignored
operator-owned wrapper; never place signing material in the repository.

## Web asset model

The Android wrapper should load the built Vite app from the packaged web
assets first. Remote loading can be considered later only after security,
offline, and store-review implications are reviewed.

## Deep links and auth

The canonical Android callback is the exact HTTPS route
`https://app.letscube.ru/auth/callback`. The manifest accepts that host and
path only. Explicit-component callback tests run before production domain
verification so an undeployed `assetlinks.json` cannot be mistaken for a
verified public App Link.

Supabase Auth URL configuration must include the chosen callback URLs. The
frontend must continue to use dynamic origin where possible and must not
hardcode a temporary domain.

## Permissions

The Android phone activity is locked to portrait orientation so the packaged
messenger does not inherit a landscape sensor state at launch. Responsive
desktop and tablet layouts remain available through the web/PWA client.

Map existing web permissions to Android:

- `android.permission.INTERNET` for Supabase/API/web asset runtime access;
- `android.permission.ACCESS_NETWORK_STATE` for network-aware WebView behavior;
- camera for photos, regular video, and video-circle recording;
- microphone for voice and video-circle audio;
- notification runtime permission on Android 13+;
- media read permissions for image/video/audio selection on Android versions
  where the WebView/file picker path requires them;
- legacy read external storage with `maxSdkVersion=32` for older compatibility.

Permission copy must be user-facing and product-specific. Do not request
permissions on app launch; request them when the user starts the feature.

## Push

Browser Web Push does not become native Android push automatically. Android
now has a Capacitor Push Notifications client, applied device registration
schema and trusted FCM HTTP v1 delivery foundation. Firebase client and Admin
configuration remain local/server-only and are not committed. See
[Native push plan](./NATIVE_PUSH_PLAN.md).

## Release signing

The self-hosted release catalog is active at
`https://api.letscube.ru/releases/v1/android/stable.json` and publishes the
signed production APK `0.1.2` build `3`. The public immutable artifact is
6,513,250 bytes with SHA-256
`d414fb7a818beb86a5bfbd06dc9cdc657e8aa82fa07acc32927b15ab2748af99`.
The matching AAB remains local and unpublished; no Play Console upload occurred.

- App id: `com.kub.messenger`.
- Signing owner: `ООО "КУБ"`.
- Identity creation/final rotation date: 2026-08-26; organization `ООО КУБ`
  and country `RU`.
- Exact certificate expiry: 2051-08-26. The controller verified the PKCS12
  validity is at least 25 years without exposing certificate details.
- The encrypted local backup opens and byte-matches the primary identity. The
  private directory ACL is protected and limited to the current owner plus
  `SYSTEM`; an external off-device backup remains pending.
- The established PKCS12 same-password compatibility ruling remains in force;
  the tracked build contract still consumes separate store/key variables and
  no password value is recorded in Git.
- Keystore, passwords, Firebase client input and any backup remain ignored and
  outside Git. Tracked-file guards found no keystore, signing env,
  `google-services.json`, private-key payload, service-role JWT or raw FCM
  token.
- The old debug signature cannot upgrade to the release identity. Existing
  debug users require one clean reinstall to enter the permanent release
  signing chain.

Preserved ignored artifacts:

- baseline `0.1.1` build `2`: `.local/release-baseline/letscube-0.1.1-build-2.apk`
  (6,513,186 bytes, SHA-256
  `b1f21189c62d259a8f105bab33cc613f47a9424a23cb6abf38016f38249f2442`)
  and `.local/release-baseline/letscube-0.1.1-build-2.aab` (6,150,057 bytes,
  SHA-256
  `431eaac6d25e4cc1539354e274fccddb56c526ccd0a972b63e5e8a4da06f7a95`);
- final `0.1.2` build `3`: `.local/release-final/letscube-0.1.2-build-3.apk`
  (6,513,250 bytes, SHA-256
  `d414fb7a818beb86a5bfbd06dc9cdc657e8aa82fa07acc32927b15ab2748af99`)
  and `.local/release-final/letscube-0.1.2-build-3.aab` (6,150,126 bytes,
  SHA-256
  `8c3be79e742e8771ed679ed9750e7fd530018c4de9ef69da0978df0c2f4430f4`).

The final canonical files are the current outputs of the restored tracked
production source. Signed APK/AAB ZIP serialization is not treated as
byte-reproducible across independent rebuilds; package/version, nondebuggable
state, signer/Asset Links parity and strict APK/AAB validation establish source
and release identity for this closeout.

Release child processes use a closed platform/tool environment allowlist.
Approved public Vite values are added explicitly, and signing inputs are restored
only for the Gradle release process; Git, Capacitor and APK inspection children
cannot inherit arbitrary credentials from the controller shell.
The scoped final re-review marked environment isolation and strict duplicate-v2
parsing addressed with no new Critical, Important or Minor regressions. Final
Android/auth units passed 54/54 after the callback-priority regression fix,
typecheck passed and the canonical APK passed strict verification.

The baseline and final APKs generated byte-identical Digital Asset Links JSON.
The final-review rebuild additionally binds recovery to callback-owned session
credentials, scrubs callback secrets from browser history and requires APK
Signature Scheme v2 at the publication gate.
The tracked document SHA-256 is
`b36206f44ae852f458ba1077d8ec8105b3906baa0341a0deec7b1a05da879777`;
the certificate value itself is intentionally not duplicated in this plan.

## Manual Android Studio steps

1. Install Android Studio and the Android SDK on the packaging machine.
2. Install a JDK supported by the selected Android Gradle plugin and point
   `JAVA_HOME` to the JDK directory.
3. From the repo root run:

```powershell
cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"
pnpm.cmd android:sync
pnpm.cmd android:open
```

4. In Android Studio, let Gradle sync.
5. Select an emulator or USB device.
6. Run the `app` debug configuration.
7. For a debug APK, run `pnpm.cmd android:build:debug` from the repo root or
   `gradlew.bat assembleDebug` from `android/`.
8. Test camera, microphone, file picker, auth, Realtime, and media playback on
   a real device before considering release work.

## Signed candidate QA status

- Google Play emulators on Android 13, 14 and 16 passed fresh signed install,
  version, notification permission, portrait, foreground/background,
  force-stop/relaunch, offline/reconnect and explicit-component callback
  routing. Each emulator ran headless and was shut down before the next boot.
- Separately, the Android 15 Nothing A063 with official Google Play Services
  passed clean baseline install, same-key `adb install -r`, package-data
  sentinel retention, notification permission, portrait and warm/cold/killed
  callback routing. Malformed paths and foreign hosts did not navigate or crash.
- Fix round 3 established authenticated session/chat/native-registration
  retention on Nothing and passed signed-final background/killed grouped cards,
  exact-chat taps and coherent delivered/read synchronization.
- Fix round 4 additionally passed independent foreground FCM transport,
  authenticated CDP offline/reconnect, first-unread anchoring and bounded
  geolocation. The temporary debuggable QA overlay was replaced by exact final
  nondebuggable `0.1.2/3`; the authenticated shell survived and no debug socket
  remained.
- Fix round 5 passed an explicit physical logout, bounded helper login and cold
  authenticated session restore. It also passed fully-read/no-unread initial
  bottom anchoring, fast upward reading without a bottom/top jump, older-history
  prepend anchoring and sampled footer/timestamp stability in a large QA chat.
- Controller closeout used a strictly QA-only private chat and the product file
  chooser to upload a synthetic file larger than 6 MiB. TUS upload progress,
  message-send progress, completion, sent-message playback and product-side
  deletion all passed. A separate cleanup audit found zero active test rows and
  all four test objects removed or already absent.
- Camera/photo, regular video, video-circle and voice controls each passed the
  expected live/record/stop/cancel path. No captured environment was retained,
  copied or sent.
- Realme RMX3830 on Android 15 initially retained its existing `0.1.0/1` debug
  package and correctly rejected the first signed replacement. After the
  controller-approved clean install it now runs final nondebuggable `0.1.2/3`;
  its custom microG stack remains excluded from FCM acceptance.
- Production Asset Links is deployed with exact signer parity and the expected
  JSON/security/cache headers. The same certificate/manifest reached Android's
  `verified` state before the final frontend-only rebuild. Realme's OEM
  StatementService later became background-restricted and returned
  `legacy_failure`; temporary verifier exemptions did not make it deterministic,
  so the final routing run used `approved` state and is not represented as a
  fresh automatic verification.
- A physical post-deploy test exposed and fixed callback unmounting during the
  global user loading transition. Warm, cold and force-stopped recovery links
  now open the `Новый пароль` screen through an implicit HTTPS `VIEW` intent.
  Scoped review returned `READY`, and browser callback/history coverage passed
  5/5 across the configured desktop/mobile Playwright projects.
- Local physical Task 4 and post-deploy callback acceptance are complete.
  The latest web deployment passed live recovery callback/history QA, and the
  exact tested APK is published in Stable with public manifest, size and SHA-256
  download parity.
- Fresh automatic App Links verification on an official-GMS device remains a
  follow-up because Realme's OEM verifier is not authoritative. Play Console
  setup, the external off-device encrypted backup, store-listing artwork and
  final release screenshots remain pending. The AAB has not been published.

## Android QA

- Fresh install, login, logout, session restore.
- Password recovery and auth callback.
- Camera photo, regular video, voice, video-circle.
- Push permission, delivery, click routing.
- Offline/reconnect banner.
- PWA update banner should not force reload inside the wrapper.
- Tasks, roles, search, notifications, and media viewer.
