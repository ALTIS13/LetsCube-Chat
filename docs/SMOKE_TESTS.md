# KUB Smoke Test Checklist

Use this checklist after every production-like deployment. It is intentionally practical and does not require test secrets in the repository.

## Auth And Session

- Register a new user.
- Login with an existing user.
- Refresh the page and confirm session restore.
- Logout and confirm protected routes redirect to login.
- Open `/admin` directly as a non-staff user and confirm access is blocked.

## Roles And Admin

- Verify admin, manager, and user access boundaries.
- Admin can open the dashboard, users tab, bans/mutes tab, audit tab.
- Manager cannot manage admins.
- Last admin protection still works.
- Ban and mute restrictions are visible to affected users.

## Chats

- Open or create a private chat through the UI.
- Confirm private chat creation uses the existing flow and does not create duplicates.
- Create a group chat.
- Send, edit, delete, pin, forward, and react to a message.
- Switch chats at least 10 times and watch Network/Console for request storms.
- Confirm unread badges update and reset after opening a chat.
- Confirm last chat owner protection still works.

## Media And Voice

- Send an image/file attachment.
- Record and send a voice message over HTTPS.
- Confirm microphone permission prompt works.
- Confirm failed uploads do not leave broken UI state.

## Folders

- Create, rename, and delete a personal folder.
- Add and remove chats from a folder.
- Verify shared folders are visible only to users who should see them.

## Tasks

- Create a task.
- Assign a task.
- Accept, start, send for confirmation, confirm, reject, cancel, comment, return to work, and update a task.
- Open task detail and verify event history.
- Refresh `/tasks` directly.

## Notifications And Audit

- Trigger an in-app notification and mark it read.
- Mark all notifications read.
- Open audit log as admin.
- Confirm audit log is not visible to regular users.

## Phone Privacy

- Update phone privacy settings.
- Verify contacts/phone fields do not appear to users who should not see them.

## Themes And Layouts

- Test light, dark, and system themes.
- Test mobile width, tablet width, and desktop width.
- Check sidebar/header, chat list, message input, task modals, admin tables, notification bell, and folder modals for overflow or clipped controls.

## Production Network Checks

- Idle for 2 minutes after login.
- Expected heartbeat PATCH rate: at most once every 60 seconds.
- Realtime channel count must not grow while idle or while switching chats.
- No `net::ERR_INSUFFICIENT_RESOURCES`.
- No repeated `GET /chat_members`, `HEAD /messages`, `GET /chats`, or `PATCH /profiles` loops.
- No noisy repeating console logs.
- Service worker registers without blocking the app.
- The frontend bundle must not contain `SUPABASE_SERVICE_ROLE_KEY` or private VAPID values.
