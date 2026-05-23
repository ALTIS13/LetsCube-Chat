# Native QA Checklist

Run this after a native wrapper is introduced. Android MVP groundwork exists in
`android/`; iOS and Windows are still planning-only.

## Baseline

- Fresh install.
- Upgrade from previous build.
- Android Gradle sync succeeds.
- Android debug APK builds.
- Logout/login.
- Session restore after app kill.
- App resumes after long background period.
- No console/runtime errors in debug build.

## Messaging

- Private chat send/receive.
- Group chat send/receive.
- Incoming message appears without refresh.
- Message ordering follows server `created_at`.
- Message push click opens chat and highlights message when available.

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

## Platform release

- Android debug build first.
- Android signed internal build later.
- iOS TestFlight build.
- Windows signed installer.
- Store metadata, privacy labels, and screenshots reviewed.
- Rollback plan documented.
