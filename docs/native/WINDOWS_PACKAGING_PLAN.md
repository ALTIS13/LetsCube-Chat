# Windows Packaging Plan

KUB can be packaged for Windows after web/PWA and self-host readiness are
stable. Do not add desktop dependencies until a packaging technology is chosen.

## Technology comparison

| Option | Pros | Cons | Best fit |
| --- | --- | --- | --- |
| Tauri | Smaller bundles, native window shell, lower idle footprint | Requires Rust toolchain and Tauri-specific update/signing work | Production desktop client when footprint matters |
| Electron | Mature ecosystem, broad plugin support, easier web-to-desktop bridge | Larger bundles and higher memory use | Fastest path if team needs desktop APIs quickly |

Initial recommendation: evaluate Tauri first on the target Windows machines.
Use Electron only if a required desktop capability is substantially easier
there.

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
Options:

- keep browser/PWA push for installed PWA users;
- implement native desktop notifications through the chosen wrapper;
- add a backend delivery adapter later if Windows push tokens are used.

## Packaging QA

- Install, uninstall, and upgrade.
- Auto-update prompt does not force reload during active work.
- Login/session restore.
- Deep link opens existing window.
- Notifications route to chat/task/invite.
- Camera/microphone/file picker.
- Offline/reconnect banner and long-session sync.
