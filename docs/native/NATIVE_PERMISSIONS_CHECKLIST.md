# Native Permissions Checklist

Use this checklist before adding native wrappers and again before each store
submission.

## Camera

- Photo capture works.
- Regular video recording works.
- Video-circle recording works.
- Camera switching works.
- Permission denied state is friendly.
- Permission is requested only when starting camera functionality.

## Microphone

- Voice recording works.
- Video-circle audio works.
- Permission denied state is friendly.
- System volume is not modified by the app.

## Notifications

- Permission is requested from an explicit user action.
- Push preferences are visible.
- Message, task, and invite toggles work.
- Muted chats suppress message push.
- Click routing opens the right chat/task/invite.

## Files and media

- File picker works.
- Media upload uses existing storage paths.
- Media viewer works.
- Raw storage URLs are not exposed in notifications.

## Auth and deep links

- Login works.
- Logout works.
- Session restore works.
- Email confirmation works.
- Password recovery works.
- `https://kub.example.com/auth/callback` works.
- Native fallback scheme works only after explicit configuration.

## Network and offline

- App loads over HTTPS.
- Supabase Auth, Postgres REST/RPC, Realtime, Storage, and Edge Functions are
  reachable.
- Offline banner appears.
- Reconnect state recovers without page reload.
- Draft and staged media state are not lost by reconnect UI.
