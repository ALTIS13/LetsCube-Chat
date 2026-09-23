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

## D-307: frequent authenticated-state fallbacks

Source audit found the same opaque fallback in generated Tailwind backgrounds
for the selected/dragged chat row, message jump highlight, reaction picker,
composer recording state, notification tab/error and settings selection/error.
Their translucent accent backgrounds now use the D-306 theme RGB channel tokens.
This preserves the chat accent override and avoids changing iOS PWA routing or
notification/read logic. The broader `color-mix()` inventory is not closed;
less frequent surfaces still require a separate authenticated old-WebView audit.

- `node --test tests/unit/webview-color-fallback.test.mjs`: 4/4 pass after a
  pre-fix failure on `ChatListItem.tsx`.
- `pnpm.cmd --filter @workspace/kub typecheck`: exit 0.
- `pnpm.cmd android:build:production:debug`: exit 0. A bare `pnpm.cmd --filter
  @workspace/kub build` first stopped on missing `PORT`; the approved Android
  wrapper supplied the required public settings and built/synced the APK.
- Compiled `index-*.css` inspection confirmed `background-color:rgb(var(--kub-*-rgb)/.NN)`
  for the edited utilities, with no opaque companion declaration for them.
- Focused shell/contrast/color unit suite: 121/121 pass.
- Desktop fixture selected chat row: at-rest alpha 0.14 and hover alpha 0.18,
  Playwright 1/1 pass. An initial immediate assertion saw the old hover alpha
  during `transition-colors`; the test now waits for the settled style.
- Mobile 390px preview fixture: composer and reaction touch checks 4/4 pass.
  An initial run without its required preview flag was stopped and not counted.
- Owned offline Android 13 full Capacitor debug APK: cold/resume and after
  force-stop both passed; all packaged web files matched the bundle; owned AVD
  removed. `run-20260923-074414-8009c2/guest-screen.png` was inspected, but
  the guest screen cannot prove the changed authenticated states.

No signed release, production deploy, physical install or FCM delivery was
performed in this follow-up.
