# Windows Secure Startup And Signed Updater Design

Date: 2026-07-13
Status: approved visual direction, implementation pending

## Goal

Replace the separate Tauri splash window with one visible LETSCUBE main window that:

1. shows a polished secure-connection startup scene;
2. advances only from real runtime state;
3. opens the already loading production messenger in the same window;
4. checks the selected signed release channel;
5. offers non-blocking install controls for normal updates;
6. blocks normal use only for a critical stable update.

The approved visual is the `fingerprint handshake` direction: computer and secure server rack, two progress halves meeting at the center, animated HEX groups that converge, and a green seal only after both sides succeed.

## Product Decisions

- Windows uses one taskbar/main window from process start. The existing separate `splash` window is removed.
- The default update channel is `stable`.
- `test` is opt-in from LETSCUBE settings and never selected automatically.
- A normal update is never installed automatically. A compact corner control lets the user start download and install.
- A critical `stable` update blocks messenger use until the user starts installation. It still explains the action and does not silently execute an installer.
- A test-channel failure always falls back to the installed version, not to a forced update.
- The in-app release state and updater state share one typed state machine; separate ad hoc banners are not allowed.

## Visual Contract

### Startup scene

The visible main window first renders a bundled local startup document. It contains:

- LETSCUBE mark and title;
- a user-computer endpoint;
- a solid server-rack endpoint named `LETSCUBE Secure Node`;
- four short HEX groups above each endpoint;
- independent left and right progress halves, each physically capped at the center;
- a center seal that remains neutral until both halves are complete;
- stages: network, certificate, version, workspace;
- a compact version status pill in the upper-right corner.

During connection, the two HEX sequences cycle independently. When the real checks complete, both animations settle on the same display sequence and the halves meet. The center seal then animates green.

The HEX sequence is an illustrative session-verification animation. It must not be labelled or logged as an actual private key, TLS secret, certificate fingerprint, or cryptographic proof. The real success condition comes from trusted HTTPS and exact-origin checks.

### Transition to messenger

After the production page finishes loading in the same main WebView, the startup layer fades out in 250-400 ms. It must not create a second window, taskbar entry, focus jump, or white flash.

The startup layer stays available for retry/error states but is removed from the accessibility tree after success.

### Compact update control

The update control is a small status pill anchored to a non-obstructive top-right corner of the Windows shell:

- checking: spinner plus `Проверяем версию`;
- current: green dot plus `Stable 0.2.0 актуальна`, then auto-collapses;
- available: version plus small `Установить` action;
- downloading: determinate byte progress when total size is known;
- verifying/installing: signed-package verification and installation labels;
- restart required: `Перезапустить`;
- failed: concise retry action and a sanitized message.

The pill cannot cover chat headers, composer, notification center, dialogs, or mobile/browser UI. It is rendered only in the Windows desktop runtime.

## Runtime Architecture

### Single-window startup controller

`windows-tauri` owns a bounded startup state machine:

```text
boot
  -> network_check
  -> tls_origin_check
  -> update_check
  -> production_navigation
  -> workspace_ready
  -> complete

failure at any preflight stage -> recoverable_error -> retry
critical stable update -> critical_update_required -> install -> relaunch
```

The main window is visible immediately with local bundled startup HTML/CSS/JS. Rust performs preflight work asynchronously and emits typed state events to that local page. It then navigates the same `main` WebView to `https://app.letscube.ru/`. Navigation remains restricted to the exact production origin.

The production React app receives only a narrow desktop bridge. Arbitrary HTTP, filesystem, shell, process, updater endpoint, and generic invoke access remain unavailable.

### Real connection state

The green seal requires all of the following:

1. HTTPS request to the exact production origin succeeds with the operating system/Rust TLS trust chain;
2. redirects do not escape `https://app.letscube.ru`;
3. the selected release manifest request completes or fails into an explicitly handled non-critical state;
4. the production WebView reaches `PageLoadEvent::Finished` at the exact allowed origin.

No elapsed-time-only timer may mark a stage successful. Animation timing can smooth transitions but cannot advance the state machine.

The existing 15-second timeout becomes state-aware. It exposes retry and an offline-friendly explanation in the same main window rather than signalling another splash window.

## Update Channels

### Stable

- Default for every installation.
- Reads only the stable updater endpoint under `https://api.letscube.ru/releases/`.
- Receives normal and critical releases.
- Critical behavior is controlled by signed update metadata and the existing release catalog's `mandatory` / minimum-supported-version contract.

### Test

- Explicit local opt-in from Settings.
- Uses a separately published and signed test manifest/artifact path.
- Displays a persistent `Test channel` marker in update settings.
- Never changes server-side account roles or notification preferences.
- Can return to stable at any time. If the installed test version is newer than stable, switching channel does not downgrade automatically.

The channel preference is stored in the Tauri application data directory through a narrow Rust command. It is not stored in public web localStorage and does not affect browser/PWA/Android clients.

## Signed Updater

Use the official Tauri 2 updater plugin. Update artifacts must be generated with updater artifacts enabled and signed with a dedicated Tauri updater private key. Signature verification cannot be disabled.

- Public updater verification key is embedded in Tauri configuration.
- Private updater key and its password remain outside git and are supplied only to the controlled Windows release build environment.
- Stable and test artifacts use the same trusted updater identity unless a future key-rotation design explicitly changes it.
- Rust builds the updater dynamically with the selected exact HTTPS endpoint.
- Download/install progress is emitted to the React desktop update pill.
- Windows updater install mode is `passive` for visible bounded progress.
- The app closes only after the downloaded signature is verified and installer handoff begins.
- A successful installation relaunches LETSCUBE into the same production profile.

Authenticode and Tauri updater signatures are separate controls. The updater signature protects update authenticity; Authenticode/SmartScreen remains a Windows public-release requirement.

Official references:

- <https://v2.tauri.app/plugin/updater/>
- <https://v2.tauri.app/reference/javascript/updater/>
- <https://docs.rs/tauri-plugin-updater/latest/tauri_plugin_updater/struct.UpdaterBuilder.html>

## Frontend Integration

The production React application adds one Windows-only desktop update controller and one compact presentation component.

The bridge exposes typed operations only:

- get startup/update state;
- get/set update channel;
- check selected channel;
- start signed download/install;
- request relaunch when applicable.

The web release catalog remains the shared metadata parser where its contract fits, but installation is delegated to the native updater. Browser/PWA and Android release behavior remains unchanged.

## Error Handling

- Offline/network failure: same-window retry; no false green seal.
- TLS or escaped redirect failure: block production navigation and show a security-specific retry state.
- Stable manifest unavailable: allow installed non-critical version to open and show a quiet degraded status.
- Test manifest unavailable: open installed app and mark test update check unavailable.
- Invalid/missing updater signature: never install; show sanitized verification failure.
- Interrupted download: return to available/retry state; do not run a partial installer.
- Installer failure: preserve installed version/profile and provide retry after restart.
- Malformed state event: ignore safely and retain last valid state.

No UI error contains raw updater JSON, local paths, tokens, private keys, stack traces, or certificate internals.

## Security Boundaries

- Exact production and release origins are constants in the native shell.
- HTTPS only; no invalid-certificate or invalid-hostname switches.
- Test-channel selection cannot inject a custom endpoint.
- Update metadata and artifacts are signed and schema validated.
- The updater private key never enters frontend code, public bundle, repository, Coolify public env, logs, or docs.
- The local startup capability has only the commands/events it needs and is not inherited by the remote production origin.
- Existing notification-only production capability remains the default remote surface, extended only with narrow update methods.

## Test Plan

### Unit and Rust

- startup state transitions and illegal transition rejection;
- exact-origin and redirect validation;
- stable default and test opt-in persistence;
- critical stable gate rules;
- no automatic downgrade from test to stable;
- updater endpoints cannot be user supplied;
- release build contains no debug CDP hook;
- local startup and remote production capabilities remain separated.

### Playwright / physical WebView2

- one native window/taskbar entry throughout startup;
- HEX groups cycle and converge only after successful states;
- left/right progress never crosses the center;
- status text does not overlap progress, stages, or version pill;
- successful fade opens the authenticated production app;
- retry works after simulated offline/catalog failures;
- normal update pill does not block chat, notifications, settings, or composer;
- critical stable state blocks use with a clear install action;
- test opt-in is explicit and reversible.

### Signed upgrade matrix

- clean install current stable;
- stable `0.2.0 -> 0.2.1` normal update;
- critical stable update gate;
- test opt-in update and return to stable without downgrade;
- interrupted download and retry;
- invalid signature rejection;
- profile/session preservation after successful update;
- uninstall/reinstall regression;
- Windows 10 and Windows 11 checks before public release.

## Out Of Scope

- Android APK updates;
- iOS PWA updates;
- external deep links/app links;
- native push changes;
- SMS provider work;
- database/RLS/schema changes;
- silent background installation of non-critical updates.

## Delivery Gates

Implementation can begin without signing secrets, but OTA installation cannot be declared complete until:

1. a dedicated Tauri updater signing key is generated and backed up;
2. its public key is configured in the client;
3. private key/password are available only to the controlled release build;
4. stable and test signed manifests are published atomically;
5. a real signed cross-version update passes physical Windows QA;
6. Authenticode/SmartScreen requirements are separately resolved for public distribution.
