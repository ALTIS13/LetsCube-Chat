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

- `pnpm.cmd windows:test` passes shell security and distribution contracts.
- `pnpm.cmd windows:build:internal` creates the expected x64 NSIS installer.
- Packaged ASAR contains only the desktop main/preload/security files and icon.
- Electron fuses disable RunAsNode, Node options/inspect and extra file-protocol privileges.
- Fresh packaged runtime opens only `https://app.letscube.ru`.
- Preload exposes no `require`, tokens, filesystem or arbitrary IPC surface.
- Camera, microphone and geolocation prompts work through the packaged session.
- Browser PWA install and Browser Web Push controls are absent in the EXE.
- Install, uninstall and upgrade are tested before a public release.
- Authenticode signature and SmartScreen reputation are required before public distribution.
