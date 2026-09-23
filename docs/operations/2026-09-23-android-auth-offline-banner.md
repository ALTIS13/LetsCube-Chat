# Android Auth Offline Banner, 2026-09-23

Owner: Codex. Scope: Android guest auth UI and local debug validation. No
production deploy, physical-device install, release signing, account login or
schema change. iOS PWA layout and notification routing were not changed.

## Finding and change

The fixed bottom connection banner covered the registration and privacy links
on a short offline Android 13 auth viewport. The auth form could scroll, but
the fixed banner kept covering its lower region. The baseline is
`output/native-boot-android/run-20260923-074414-8009c2/guest-screen.png`.

On native Android auth only, the banner now becomes a compact top status and
the auth shell reserves space above the brand. Other routes and browser/PWA
retain the previous bottom placement and full detail text. The root layout
class is applied before paint and removed when the banner hides or unmounts.

## Verification

- The new overlap test reproduced the original failure at 390x690 before the
  change (~2982 CSS px2 overlap). Afterwards, all 8 native Android auth cases
  passed: 360/390px and desktop widths, light/dark, 0/24px bottom inset,
  registration footer after scroll, reconnect and browser isolation.
- `pnpm.cmd --filter @workspace/kub typecheck`: exit 0.
- `tests/e2e/pwa.spec.ts` manifest/offline test on Chromium and WebKit mobile:
  2/2 passed. Browser banner stayed at its previous bottom offset.
- `tests/e2e/letscube-brand-auth-layout.spec.ts` on desktop and mobile:
  21 passed, 1 intentional mobile skip of a desktop-only logo check.
- `pnpm.cmd android:build:production:debug`: exit 0; Vite sourcemap,
  mixed-import/large-chunk and Gradle deprecation warnings remain.
- Owned offline Android 13/API 33 AVD full-shell check: cold/resume and
  after-force-stop passed, 33 embedded web assets matched the built bundle,
  and the owned AVD was removed. The inspected screenshot at
  `output/native-boot-android/run-20260923-081428-30cbd9/guest-screen.png`
  shows the banner above the brand and the lower links visible.

The screenshot and lifecycle are from a debug APK with an unauthenticated
guest session. Physical OEM layouts, signed-release parity and authenticated
screens remain outside this check.
