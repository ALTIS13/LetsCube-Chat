# QA Checklist

Production-like URL сейчас: `https://kub.apollot.ru`. Это временный тестовый домен; не хардкодить его в source code.

## Auth

- Register.
- Email confirmation redirect ведёт на текущий origin `/auth/callback`.
- Expired/invalid confirmation link показывает дружелюбное сообщение, не raw Supabase JSON.
- Login.
- Logout.
- Session restore after refresh.
- Direct refresh `/admin`.
- Direct refresh `/tasks`.
- Friendly auth error messages.

## Sidebar/UI

- Sidebar does not overflow.
- Chat search visible.
- Icons near search stay inside sidebar.
- Notification bell visible.
- New chat/group actions visible.
- No horizontal scrollbar.
- Light theme.
- Dark theme.
- System theme.
- Responsive widths: 390px, 768px, 1280px.

## Chats/messages

- Private chat open/create.
- Group chat open/create.
- Send text message.
- Message appears realtime.
- Last message updates.
- Unread counters sane.
- Delete message if supported.
- No request storm.

## Voice messages

- Start recording.
- Timer moves normally.
- UI does not jump.
- Stop recording.
- Send voice message.
- Play voice message.
- System microphone volume is not unexpectedly changed.

## Folders

- Personal folders.
- Shared folders.
- Add chat to folder.
- Remove chat from folder.
- Folder visibility syncs after membership changes.

## Tasks

- Create task.
- Assign task.
- Accept.
- Start.
- Send for confirmation.
- Confirm as manager/admin.
- Reject with reason.
- Return rejected task to work.
- Edit task.
- Comment.
- Cancel.

## Admin

- Dashboard.
- Users search.
- Role changes.
- Ban.
- Mute.
- Bans/Mutes tab.
- Audit tab.

## Notifications

- NotificationBell opens.
- Unread count works.
- Mark one read.
- Mark all read.
- Realtime notification appears.
- Push worker is not required for in-app bell.

## Production/network

- Console has no repeated errors.
- Network has no `ERR_INSUFFICIENT_RESOURCES`.
- Heartbeat is not spamming.
- Realtime websocket connected.
- Service worker registered if expected.
