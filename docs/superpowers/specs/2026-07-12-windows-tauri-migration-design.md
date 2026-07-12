# Windows Tauri Migration Design

## Goal

Replace the retired Electron package with a compact Tauri 2 Windows client that
loads the production LETSCUBE web application, starts with a clean production
profile, minimizes to tray, presents a branded animated startup surface and
preserves the existing browser/PWA/Android behavior.

## Root Cause Being Removed

Electron QA and the installed package shared `%APPDATA%/letscube-desktop`.
Playwright authenticated that profile, so a later installer launch reused the
QA session. The installer did not contain credentials: its ASAR had seven shell
files, and a temporary clean profile opened the unauthenticated login form.

Tauri uses a stable production WebView2 data directory that is never used by
automated tests. Every automated Tauri launch receives a unique temporary data
directory. No migration from the Electron profile is performed.

## Architecture

- `windows-tauri/` is a standalone pnpm package with its own lockfile. Tauri and
  Rust dependencies never enter the root workspace or Coolify web/worker build.
- The Rust shell creates a hidden main WebView2 window for the exact origin
  `https://app.letscube.ru` and a bundled local splash window.
- The splash uses the existing LETSCUBE mark and restrained CSS motion. It closes
  only after the production page is ready; connection failure changes it into a
  retry screen rather than exposing a blank WebView error.
- The production WebView uses an explicit data directory under the Tauri app data
  directory. Tests override this path with a temporary directory.
- Navigation stays inside the exact production origin. HTTP/HTTPS/mail links are
  handed to the default Windows application. Redirects to other origins are not
  loaded in the LETSCUBE window.
- A tray icon provides `Открыть LETSCUBE` and `Выйти`. Closing the main window
  hides it to tray; the explicit tray exit terminates the process.
- Tauri capabilities grant remote IPC only to `https://app.letscube.ru` and only
  for the minimal app/version, event and notification operations required by the
  client. Filesystem, arbitrary shell and process execution are not exposed.
- The frontend detects Tauri through the official API, reports
  `windows_native`, reads installed version/build and never enters browser PWA,
  Service Worker or Browser Push paths.
- Native toast notifications are emitted while the tray process is running.
  Killed-process delivery and Windows Push Notification Services are not claimed.

## Distribution And Updates

- Initial target: x64 NSIS using the installed Microsoft Edge WebView2 runtime.
- Target installer size: under 25 MiB. An offline WebView2 runtime is not bundled.
- Stable package identity remains LETSCUBE; Electron artifacts remain retired.
- The existing `api.letscube.ru` release catalog publishes the Tauri EXE only
  after clean-profile, tray, media and installed-package QA pass.
- Signed automatic updates are a public-release gate. Internal builds remain
  manual downloads until an Authenticode certificate and Tauri updater signing
  key are configured outside Git.

## Motion And UX

- The native shell adds an animated branded splash, connection status transition
  and smooth main-window reveal.
- Tray restore focuses the existing window instead of opening duplicates.
- Product interaction animation remains a separate React motion pass. Tauri can
  improve startup weight and window behavior but does not automatically animate
  chat, settings or navigation components.
- Motion respects `prefers-reduced-motion`.

## QA Gates

- A clean install always opens the login page with no stored Supabase auth key.
- Upgrade preserves a legitimate production session only within the new Tauri
  profile.
- Exact-origin navigation and remote capabilities are covered by unit tests.
- Tray open/hide/exit and single-instance behavior are exercised on Windows.
- Login, private/group/topic chats, realtime, clipboard, fullscreen, camera,
  microphone, voice, video-circle, regular video, geolocation and media playback
  pass on the packaged WebView2 client.
- Browser/PWA, iOS PWA and Android builds retain their existing behavior.
- No SQL, service-role frontend usage, Firebase config, keystore or signing key is
  added for this migration.

## Explicit Non-Goals

- Windows push delivery while the app process is not running.
- Public Authenticode signing or Microsoft Store publication.
- Deep links/app links.
- Broad React redesign during the shell migration.

