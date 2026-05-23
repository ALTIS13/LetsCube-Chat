# iOS Capacitor Plan

Target: produce an iOS TestFlight build after Android packaging proves the
core permission and deep-link model.

## Prerequisites

- macOS packaging machine.
- Current Xcode.
- Apple Developer account.
- Bundle id chosen for production.
- App icons and launch screen assets.
- Supabase Auth redirect URLs planned before first TestFlight build.
- Push provider decision made: APNs directly or via an abstraction layer.

## Future wrapper steps

Do not run these in the current documentation stage:

```powershell
pnpm.cmd --filter @workspace/kub run build
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init KUB com.example.kub
npx cap add ios
npx cap sync ios
```

Use the real production bundle id before TestFlight.

## Auth and deep links

Plan both universal links and optional custom scheme fallback:

- `https://kub.example.com/auth/callback`
- `kub://auth/callback`

Supabase Auth redirect URLs must match the final callback URLs. Password
recovery, email verification, and OAuth/magic-link flows must be tested on a
real device.

## Permissions

Add clear `Info.plist` usage descriptions for:

- camera;
- microphone;
- photo library/media picker if used;
- notifications.

Do not request permissions on launch. Request them from the feature that needs
the permission.

## Push

Safari/Web Push behavior is not a replacement for native APNs inside a
Capacitor shell. Native iOS push requires APNs credentials, device tokens, and
server-side delivery logic. See [Native push plan](./NATIVE_PUSH_PLAN.md).

## Signing and release

- Use Apple-managed signing for early internal builds if acceptable.
- Store certificates, profiles, and App Store Connect access outside the repo.
- Use TestFlight for real-device QA.
- Prepare privacy labels before public release.

## iOS QA

- Login/session restore after app restart.
- Auth callback and password recovery from Mail/Safari.
- Camera/microphone prompts and denial states.
- Video-circle recording and playback.
- Push delivery and click routing.
- Background/foreground realtime reconciliation.
- Offline/reconnect banner.
- Safe area handling on small and large iPhones.
