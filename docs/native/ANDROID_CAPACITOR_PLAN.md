# Android Capacitor Plan

Target: produce an Android debug APK first, then an internal-test AAB/APK,
without changing KUB web behavior.

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
- Real app icons and splash assets prepared.

## Phase 1: current MVP groundwork

Current repository groundwork:

- Capacitor config: `capacitor.config.ts`
- Android project: `android/`
- App id: `com.kub.messenger`
- App name: `KUB Messenger`
- Web assets directory: `artifacts/kub/dist/public`
- Android sync script: `pnpm.cmd android:sync`
- Android Studio open script: `pnpm.cmd android:open`
- Debug build script: `pnpm.cmd android:build:debug`

The sync flow is:

```powershell
cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"
pnpm.cmd android:sync
```

Use Android Studio for emulator/device runs and debug APK inspection. Release
signing is intentionally not configured in this stage.

## Web asset model

The Android wrapper should load the built Vite app from the packaged web
assets first. Remote loading can be considered later only after security,
offline, and store-review implications are reviewed.

## Deep links and auth

Configure both:

- HTTPS app links, for example `https://kub.example.com/auth/callback`;
- optional custom scheme fallback, for example `kub://auth/callback`.

Supabase Auth URL configuration must include the chosen callback URLs. The
frontend must continue to use dynamic origin where possible and must not
hardcode a temporary domain.

## Permissions

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
now has a Capacitor Push Notifications client foundation, but production FCM
delivery still requires local `android/app/google-services.json`, the
`user_push_devices` SQL/RPC proposal, and trusted backend FCM credentials. See
[Native push plan](./NATIVE_PUSH_PLAN.md).

## Release signing

- Create a release keystore outside the repo.
- Store keystore and passwords in a password manager or CI secret store.
- Build an internal release before any Play Store submission.
- Document the app id, signing owner, keystore backup location, and rotation
  plan without committing values.
- The repo-level Android ignore rules exclude local keystore and
  `google-services.json` files from accidental commits.

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

## Known MVP limitations

- Native push/FCM client foundation exists, but physical delivery is pending
  Firebase/backend setup and QA.
- Android app links/custom scheme are not finalized.
- Release signing/AAB is not configured.
- Final app icon/splash/club visual branding is still pending.

## Android QA

- Fresh install, login, logout, session restore.
- Password recovery and auth callback.
- Camera photo, regular video, voice, video-circle.
- Push permission, delivery, click routing.
- Offline/reconnect banner.
- PWA update banner should not force reload inside the wrapper.
- Tasks, roles, search, notifications, and media viewer.
