# Windows Packaging Plan

LETSCUBE has migrated from the retired Electron experiment to a Tauri 2
Windows client. The verified internal `0.2.0` build `4` installer is published
through the Windows stable release catalog. The shell loads only
`https://app.letscube.ru` and keeps the production web application as the
shared product surface.

## Technology decision

| Option | Pros | Cons | Decision |
| --- | --- | --- | --- |
| Tauri | Small installer, native window/tray shell, lower idle footprint | Requires Rust/MSVC and separate update/signing work | Selected production direction |
| Electron | Mature ecosystem and bundled Chromium | Large installer/runtime and unsafe shared QA profile in the experiment | Retired; no longer distributed or tested |

Camera, microphone, MediaRecorder, realtime, geolocation, file selection and
media playback remain WebView features. They require installed-package QA on
Windows 10/11 before the public release catalog is opened.

## Current Tauri groundwork

- Application ID: `ru.letscube.messenger`.
- Product/executable name: `LETSCUBE`.
- Runtime: Tauri 2 + installed Microsoft WebView2 Runtime, x64.
- Installer: per-user NSIS setup, initially unsigned.
- Source/config: `windows-tauri/`, outside the root pnpm workspace.
- Production URL: `https://app.letscube.ru/`.
- Production WebView profile: `webview-production-v1`.
- Prepare: `pnpm.cmd windows:tauri:prepare`.
- Run: `pnpm.cmd windows:tauri:run`.
- Contract tests: `pnpm.cmd windows:tauri:test`.
- Build: `pnpm.cmd windows:tauri:build:internal`.
- Output: `windows-tauri/src-tauri/target/release/bundle/nsis/`.

Automated native QA must set a unique temporary data directory and must never
reuse the stable production profile. Release builds ignore the QA override and
never import the old Electron profile.

## Verified local toolchain

- Rust `1.97.0`, target `stable-x86_64-pc-windows-msvc`.
- Cargo `1.97.0`.
- Visual Studio Build Tools 2022 MSVC `14.44.35207`.
- Microsoft Edge WebView2 Runtime `150.0.4078.65`.
- Java/JDK and Android SDK configuration were not changed.

## Security boundary

- Main navigation accepts only the exact HTTPS origin `app.letscube.ru`.
- The production remote capability grants only the Tauri notification methods
  needed by that exact origin.
- No filesystem, shell, process, generic opener, updater or wildcard HTTP
  capability is exposed to remote content.
- The synchronous initialization bridge exposes only validated
  platform/version/build metadata.
- The shell contains no Supabase credentials or service-role key.

## Tray and startup

- A bundled animated splash is shown while the production page loads.
- Closing the main window hides it; the tray menu can reopen it or exit.
- A second launch focuses the existing process through the single-instance
  plugin.
- Reduced-motion preferences disable splash animation.

## Signing and update boundary

The internal installer is unsigned. Windows SmartScreen can warn until a
trusted Authenticode certificate is configured. Public auto-update remains a
later gate because it also needs a separate Tauri updater key, signed updater
artifacts and compatible signed metadata. Neither signing secret belongs in
Git or in the remote web bundle.

## Deep links

Deep links are not implemented in this stage. Future candidates are:

```text
letscube://auth/callback
https://app.letscube.ru/auth/callback
```

Supabase Auth redirect URLs must be reviewed when that stage starts.

## Push and notifications

Browser Web Push does not become killed-process Windows push automatically.
While the Tauri process/tray is running, foreground realtime events can use the
restricted native notification plugin. Killed-process delivery needs a
separate Windows push token/backend design and is not claimed.

## Release catalog

`https://api.letscube.ru/releases/v1/windows/stable.json` exposes the verified
internal `0.2.0` build `4` Tauri NSIS artifact. Artifacts remain immutable under
`https://api.letscube.ru/releases/files/windows/`.

## Packaging QA

- Clean-profile launch shows login and contains no existing auth state.
- Install, uninstall and upgrade.
- Splash, retry state, tray close-to-hide and single instance.
- Login/session restore without using a QA profile.
- Notifications route to chat/task/invite while the process is running.
- Camera/microphone/file picker/video/voice/geolocation/clipboard/fullscreen.
- Realtime and notifications after the window stays hidden for five minutes.
- Offline/reconnect banner and long-session sync.
- Installer size and SHA-256 are recorded before publication.
