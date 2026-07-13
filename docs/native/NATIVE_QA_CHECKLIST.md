# Native QA Checklist

Run this after a packaged-client change. Android and the internal Windows
Electron wrapper exist; iOS remains PWA-only.

## Baseline

- Fresh install.
- Upgrade from previous build.
- Android Gradle sync succeeds.
- Android debug APK builds.
- Logout/login.
- Session restore after app kill.
- Phone activity remains portrait during normal messenger use.
- App resumes after long background period.
- No console/runtime errors in debug build.

## Messaging

- Private chat send/receive.
- Group chat send/receive.
- Incoming message appears without refresh.
- Message ordering follows server `created_at`.
- Message push click opens chat and highlights message when available.
- Cold-start push click waits for auth restore and does not show a false unavailable-chat dialog.
- Opening the pushed chat marks its message notification read server-side even before the bell list loads.

## Media

- Camera photo.
- Regular rectangular video.
- Voice recording.
- Video-circle recording.
- Staged preview before send.
- Media playback controller.
- Media viewer.

## Tasks and operations

- Owner/tech admin role controls.
- Location admin task controls.
- Location staff can claim staff-pool tasks.
- Client has no task/admin controls.
- Recurring task occurrences appear and preserve routing fields.

## Push

- Permission prompt is user-triggered.
- Message push.
- Task push.
- Invite push.
- Muted chat suppression.
- Same-chat message grouping where the platform supports it.
- Killed-process delivery (distinct from Android force-stop, which intentionally suppresses app delivery).
- Task-channel tap opens an assigned task for a location-staff account.

## Platform release

- LETSCUBE launcher icon is not clipped by circle/squircle masks.
- Dark LETSCUBE splash has no white flash in light or dark system theme.
- Package metadata reports `com.kub.messenger`, label `LETSCUBE` and the expected version code/name.
- Android debug build first.
- Android signed internal build later.
- iOS TestFlight build.
- Windows signed installer.
- Store metadata, privacy labels, and screenshots reviewed.
- Rollback plan documented.

## Windows internal gate

- `pnpm.cmd windows:tauri:test` passes shell security and distribution contracts.
- `pnpm.cmd windows:tauri:qa` builds a debug shell, creates an isolated temporary WebView2 profile and runs the production-origin Tauri smoke through a loopback-only CDP endpoint.
- Tauri QA exercises `success`, `offline`, `catalog_failure`, `normal_update` and `critical_update` in separate fresh profiles, retaining screenshots per scenario.
- Startup geometry passes at `1920x1080`, `1440x900` and the `960x640` minimum: one WebView, converged fingerprints, center-bounded rails and no endpoint/status/fingerprint overlap.
- Offline mode presents Retry and then performs one exact-origin handoff; normal-update pill, critical gate and explicit reversible Test-channel opt-in are covered by the native-shell suite.
- QA cleanup removes every owned client/test process tree and its temporary WebView2 profile on pass, failure or signal.
- `pnpm.cmd windows:tauri:build:internal` creates the expected x64 NSIS installer.
- Release builds ignore both `LETSCUBE_WEBVIEW2_DATA_DIR` and `LETSCUBE_WEBVIEW2_DEBUG_PORT`; the QA port exists only in debug builds and never allows wildcard origins.
- A release executable scan finds no startup-mode env/string, WebView2 debug/CDP hook, service-role secret name or PEM private-key marker.
- Fresh packaged runtime opens only `https://app.letscube.ru`.
- The remote production capability exposes notification methods only, with no filesystem, shell, process, updater, generic opener or arbitrary IPC surface.
- Camera, microphone and geolocation prompts work through the packaged session.
- Browser PWA install and Browser Web Push controls are absent in the EXE.
- Install, uninstall and upgrade are tested before a public release.
- Authenticode signature and SmartScreen reputation are required before public distribution.
