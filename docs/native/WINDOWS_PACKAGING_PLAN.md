# Windows Packaging Plan

LETSCUBE will be packaged for Windows after the Android release gate. The
approved first step is an Electron capability spike; do not add the desktop
runtime until that spike begins.

## Technology comparison

| Option | Pros | Cons | Best fit |
| --- | --- | --- | --- |
| Tauri | Smaller bundles, native window shell, lower idle footprint | Requires Rust toolchain and Tauri-specific update/signing work | Production desktop client when footprint matters |
| Electron | Mature ecosystem, broad plugin support, easier web-to-desktop bridge | Larger bundles and higher memory use | Fastest path if team needs desktop APIs quickly |

Approved direction: evaluate Electron first because LETSCUBE depends on
Chromium camera, microphone, MediaRecorder, realtime and media playback
behavior. Tauri remains a later footprint comparison, not the first packaging
implementation.

## Shared requirements

- Windows code signing certificate.
- Installer format decision: MSIX, MSI, or setup exe.
- Auto-update channel policy.
- Crash/error reporting decision; Sentry self-host can be added later.
- Native notification bridge.
- Camera/microphone/file permission behavior tested on Windows 10/11.

## Deep links

Register a protocol handler, for example:

```text
kub://auth/callback
```

Also keep the HTTPS route:

```text
https://kub.example.com/auth/callback
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
