# Post-Migration QA Checklist

Run this after self-host rehearsal and again after production cutover.

## Auth

- Login/logout.
- Session restore.
- Email confirmation.
- Password recovery.
- Auth callback route.
- Phone verification fallback or real SMS flow.

## Chat

- Private chat send/receive.
- Group chat send/receive.
- Incoming messages appear without refresh.
- Ordering follows server `created_at`.
- Read/delivery behavior remains stable.

## Media

- File upload.
- Image preview.
- Regular video.
- Voice recording/playback.
- Video-circle recording/playback.
- Media viewer.

## Push and notifications

- Notification bell loads.
- Message notification row created.
- Push outbox row created when enabled.
- Push dispatcher sends.
- Same-chat push grouping works where browser supports it.
- Task and invite notifications still work.

## Tasks, roles, locations

- Owner/tech admin controls.
- Location admin controls.
- Location staff sees own-location tasks.
- Location staff claims staff-pool tasks.
- Client has no task/admin controls.
- Recurring occurrences keep routing fields.

## Search

- Sidebar/global search.
- In-chat full-history search.
- Message jump/highlight.

## Platform

- Direct refresh `/tasks`.
- Direct refresh `/admin`.
- Service worker update flow.
- Offline/reconnect banner.
- No unexpected console errors.
- No unexpected failed network requests.
