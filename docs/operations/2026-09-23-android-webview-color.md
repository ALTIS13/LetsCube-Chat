# Android WebView Color and Debug Matrix, 2026-09-23

Owner: Codex. Scope: local source and debug QA only. No account login, physical-device
install, production deploy, native release signing, FCM send or schema change.

## Finding and repair

The same pre-fix debug APK rendered the guest auth screen normally on Android 14
but with opaque blue grid/panel layers and a solid red offline banner on Android
13. The baseline Android 13 image is in
`output/native-boot-android/run-20260923-071224-690f54/guest-screen.png`.
The built CSS lowered `color-mix()` to an opaque accent color outside an
`@supports` block. The Android 13 WebView used that fallback. This is a visual
failure even though the React-ready instrumentation passed.

Auth grid, subtle grid, panel sheen, auth glow and connection banner now use
theme-specific RGB channel tokens with explicit alpha. The rebuilt CSS retains
the alpha expressions without an opaque fallback. The banner still uses the
surface color beneath its translucent tint. Chat and own-message accent overrides
carry matching RGB tokens, preserving their previous hue. Web/PWA behavior was
tested separately.

## Verification

- `pnpm.cmd --filter @workspace/kub run typecheck`: exit 0.
- `pnpm.cmd android:build:production:debug`: exit 0; Vite printed a build id,
  Capacitor synced, Gradle assembled the debug APK. Existing sourcemap,
  mixed-import, large-chunk, flatDir and Gradle-deprecation warnings remain.
- Focused color/lattice/backdrop/cascade and adjacent entry/shell-glass unit
  tests: 129/129 pass after the chat-token follow-up.
- Fixture browser auth/PWA tests at 1440 desktop and 390 mobile: 25 pass,
  one intentional duplicate mobile theme-asset skip.
- Synthetic native-Android navigation at 360/390/412: 9/9 pass in dark/light
  where applicable (run before the color repair; navigation code unchanged).
- Full debug APK on owned offline Android 13/API 33 AVD: light and system-dark
  runs both passed cold launch, background/resume and force-stop restart. Their
  guest screenshots are in `run-20260923-071909-472fff` and
  `run-20260923-072804-86851f`. Both were inspected: the opaque fallback is gone.
- Full debug APK on owned offline Android 14/API 34 AVD: final run
  `run-20260923-072411-4c766a` passed the same lifecycle checks, and its
  screenshot was inspected. An earlier run `run-20260923-072128-d0c38e`
  failed its first Activity-focus wait *before* backgrounding, despite React
  readiness; it is retained as an intermittent QA/device result, not silently
  counted as a pass or attributed to the CSS change.
- Successful runs checked byte hashes for all 33 packaged web files and removed
  their owned AVDs. The connected Realme was not targeted. Final debug APK
  included all six named Firebase initialization resources; names were checked
  without exposing resource values.

The debug APK still does not prove signed-release parity, Android 15/OEM layout,
FCM registration/delivery, authenticated chat UI or physical notification taps.
Do not promote a release on this evidence alone.
