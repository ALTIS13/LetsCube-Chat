# Windows Packaging Plan

LETSCUBE now has an internal Windows Electron package. Version `0.1.0`, build
`1`, is produced as an unsigned x64 NSIS installer. The shell loads only
`https://app.letscube.ru` and keeps the production web application as the
shared product surface.

## Technology comparison

| Option | Pros | Cons | Best fit |
| --- | --- | --- | --- |
| Tauri | Smaller bundles, native window shell, lower idle footprint | Requires Rust toolchain and Tauri-specific update/signing work | Production desktop client when footprint matters |
| Electron | Mature ecosystem, broad plugin support, easier web-to-desktop bridge | Larger bundles and higher memory use | Fastest path if team needs desktop APIs quickly |

Approved direction: Electron was selected for the first Windows package because
LETSCUBE depends on Chromium camera, microphone, MediaRecorder, realtime and
media playback behavior. Tauri remains a later footprint comparison.

## Current internal package

- Application ID: `ru.letscube.messenger`.
- Product/executable name: `LETSCUBE`.
- Runtime: Electron `43.1.0`, x64.
- Installer: assisted per-user NSIS setup.
- Source: `desktop/`; config: `electron-builder.yml`.
- Build: `pnpm.cmd windows:build:internal`.
- Output: `dist/windows/LETSCUBE-0.1.0-x64-setup.exe`.
- Renderer isolation: sandbox and context isolation enabled, Node integration disabled.
- Navigation and permissions are restricted to the exact production app origin.
- The preload exposes only validated platform/version/build metadata.
- Browser Service Worker, PWA installation and Browser Web Push are disabled in
  the Electron runtime. Native Windows notifications remain a separate stage.

The internal installer is intentionally unsigned. Windows SmartScreen can warn
until a trusted code-signing certificate and release signing pipeline are added.

## Shared requirements

- Windows code signing certificate.
- Decide whether public distribution remains NSIS or later moves to MSIX/MSI.
- Auto-update channel policy.
- Crash/error reporting decision; Sentry self-host can be added later.
- Native notification bridge.
- Camera/microphone/file permission behavior tested on Windows 10/11.

## Deep links

Future protocol handler candidate:

```text
letscube://auth/callback
```

Also keep the HTTPS route:

```text
https://app.letscube.ru/auth/callback
```

Supabase Auth redirect URLs must include the chosen desktop callback model.

## Push and notifications

Desktop browser Web Push does not become native Windows push automatically.
The Windows browser remains usable but is not offered PWA installation.
Electron must provide native desktop notifications through a restricted
preload bridge; backend delivery changes are added only if a concrete Windows
token model is required.

## Release catalog

`https://api.letscube.ru/releases/v1/windows/stable.json` is active with
`available: false` until an EXE exists. Future NSIS artifacts and updater
metadata use immutable versioned paths under
`https://api.letscube.ru/releases/files/windows/`.

## Packaging QA

- Install, uninstall, and upgrade.
- Auto-update prompt does not force reload during active work.
- Login/session restore.
- Deep link opens existing window.
- Notifications route to chat/task/invite.
- Camera/microphone/file picker.
- Offline/reconnect banner and long-session sync.
