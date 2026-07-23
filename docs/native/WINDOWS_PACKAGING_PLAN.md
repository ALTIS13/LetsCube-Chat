# Windows Packaging Plan

LETSCUBE has migrated from the retired Electron experiment to a Tauri 2
Windows client. The verified `0.2.7` build `11` candidate has passed physical
notification grouping/action/read-cleanup QA, was verified in Test and was
promoted unchanged to Stable. The shell loads only
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
- The production remote capability grants only the exact Tauri notification
  methods and origin-guarded `desktop_show_main` command needed by that origin.
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
trusted Authenticode certificate is configured. Tauri updater signing is a
separate trust boundary: Tauri 2 release builds reuse the signed NSIS `.exe` installer and
its `.sig`, while the matching public verification key is embedded in the
desktop client. Neither the Tauri signing private key/password nor an
Authenticode secret belongs in Git, documentation, Coolify public variables or
the remote web bundle.

The publisher keeps the existing download-catalog interface intact:

```text
publish-native-release.sh PLATFORM CHANNEL VERSION BUILD ARTIFACT [NOTES]
```

Signed Windows updater publication uses an explicit channel and consumes only
already-built artifacts:

```text
publish-native-release.sh windows VERSION INSTALLER NOTES \
  --channel stable|test \
  --updater-artifact LETSCUBE_VERSION_x64-setup.exe \
  --signature-file LETSCUBE_VERSION_x64-setup.exe.sig
```

The script never signs a bundle and never reads the updater private key. It
copies the signed bundle and signature to the immutable version path, verifies
their exact bytes on later promotion, calculates SHA-256, then atomically
renames the selected channel manifest. Publish to `test` first; promote to
`stable` by running the same command with the same immutable bundle and
signature. Any byte difference for an existing version is rejected.

## Deep links

Deep links are not implemented in this stage. Future candidates are:

```text
letscube://auth/callback
https://app.letscube.ru/auth/callback
```

Supabase Auth redirect URLs must be reviewed when that stage starts.

## Push and notifications

Browser Web Push does not become killed-process Windows push automatically.
While the Tauri process/tray is running, the global in-app notification
Realtime stream presents native Windows notifications when the main window is
hidden or backgrounded. Native foreground state comes from the exact-origin
Rust bridge because WebView2 keeps `document.visibilityState` visible after
`window.hide()`. A window is foreground only while visible, focused and not
minimized. The
guarded `desktop_notify` command writes a bounded Windows toast with a stable
hashed tag per chat and separate `messages`, `tasks` and `system` groups. The
generic desktop backend of `@tauri-apps/plugin-notification` is not used because
it drops id/group/action data on Windows. Initial unread rows form a silent
baseline, while reconnect/online refresh presents only rows missed after that
baseline. Notification policy is checked before submission. Read-sync removes
the matching `tag/group` from native Windows history. A notification action
accepts only a relative same-app route, stores it in native state until the
frontend listener consumes it, restores the origin-guarded main window and
reuses the authenticated in-app navigation queue. Killed-process delivery still needs a separate WNS
device-token/backend design and is not claimed.

## Release catalog

`https://api.letscube.ru/releases/v1/windows/stable.json` and both Tauri updater
channels expose the physically tested `0.2.7` build `11` artifact. Test was
verified first, then the exact same immutable installer and adjacent updater
signature were promoted to Stable. The release adds one
Toast Header per chat, retains up to five unread cards, opens the exact message
from fresh and historical cards, removes only the opened chat's history after
reading and avoids duplicate sender text.
Artifacts remain immutable under
`https://api.letscube.ru/releases/files/windows/`.
Public Test, Stable updater and Stable download manifests resolve to the same
2,318,468-byte artifact with SHA-256
`408c238d0eae67471c6fb9b8ae95a1c9bb54640912883d86d7ae390a414d65e1`.
Manifest responses use `no-cache, no-store`; the versioned installer uses
`public, max-age=31536000, immutable`.

The signed native updater uses separate manifests and does not replace that
download catalog:

- `https://api.letscube.ru/releases/updater/v1/windows/stable.json` is the
  default production channel;
- `https://api.letscube.ru/releases/updater/v1/windows/test.json` is opt-in;
- updater bundles are immutable under
  `https://api.letscube.ru/releases/updater/files/windows/VERSION/`.

Channel manifests are served with `no-store`; immutable bundles use a one-year
cache lifetime. Only `GET` and `HEAD` are accepted. The release host blocks
directory listing, dotfiles, traversal forms and all unlisted updater paths.

## Packaging QA

- [x] Clean-profile launch shows login and contains no existing auth state.
- [x] Same-version repair, silent uninstall and clean reinstall preserve the user profile while removing/recreating the package and registry entry correctly.
- [x] Upgrade between two different signed versions.
- [x] Splash, tray close-to-hide and single instance.
- [x] Login through a temporary isolated profile without importing browser or Electron state.
- [x] Production-origin authenticated shell, chat composer, attachment menu, media quality selector, Notification Center and Windows notification settings.
- [x] WebView2 exposes camera/microphone MediaDevices, MediaRecorder, geolocation, clipboard and fullscreen APIs; the attachment menu exposes photo, camera, voice and video flows.
- [ ] Hardware capture/permission allow-deny matrix on Windows 10 and Windows 11 devices.
- [x] Realtime chat/task/system routing, native visibility, stable per-chat Windows Toast Headers, five-card unread retention, reconnect reconciliation and chat-scoped read cleanup are covered by unit/native lifecycle and physical QA. Fresh and historical cards open their exact message; cards from another chat remain independently actionable.
- [ ] Offline/reconnect banner and long-session sync.
- [x] Installer size and SHA-256 are recorded before publication.

Run repeatable native-shell QA with `pnpm.cmd windows:tauri:qa`. The wrapper
refuses to terminate an existing user-owned LETSCUBE process, owns only its
debug child process, uses a unique temporary profile and removes it after QA.
