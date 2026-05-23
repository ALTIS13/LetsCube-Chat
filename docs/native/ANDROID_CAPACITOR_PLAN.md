# Android Capacitor Plan

Target: produce an Android debug APK first, then an internal-test AAB/APK,
without changing KUB web behavior.

## Phase 0: prerequisites

- Stable web build:
  - `pnpm.cmd --filter @workspace/kub run typecheck`
  - `PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build`
  - `pnpm.cmd e2e:smoke`
- Android Studio installed on a packaging workstation.
- Supported JDK and Android SDK installed.
- Production-like HTTPS domain, for example `https://kub.example.com`.
- Supabase Auth redirect URLs configured for web and future Android deep links.
- Real app icons and splash assets prepared.

## Phase 1: add wrapper, later

Future commands, not for this stage:

```powershell
pnpm.cmd --filter @workspace/kub run build
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init KUB com.example.kub
npx cap add android
npx cap sync android
```

Use the actual package id chosen for production. Do not use
`com.example.kub` in a release build.

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

- camera for photos, regular video, and video-circle recording;
- microphone for voice and video-circle audio;
- notification runtime permission on Android 13+;
- file/media picker permissions according to Android version;
- network access.

Permission copy must be user-facing and product-specific. Do not request
permissions on app launch; request them when the user starts the feature.

## Push

Browser Web Push does not become native Android push automatically. Native
Android push should use FCM through a native plugin or Capacitor-compatible
push bridge. See [Native push plan](./NATIVE_PUSH_PLAN.md).

## Release signing

- Create a release keystore outside the repo.
- Store keystore and passwords in a password manager or CI secret store.
- Build an internal release before any Play Store submission.
- Document the app id, signing owner, keystore backup location, and rotation
  plan without committing values.

## Android QA

- Fresh install, login, logout, session restore.
- Password recovery and auth callback.
- Camera photo, regular video, voice, video-circle.
- Push permission, delivery, click routing.
- Offline/reconnect banner.
- PWA update banner should not force reload inside the wrapper.
- Tasks, roles, search, notifications, and media viewer.
