# Windows Toast Message Headers Design

## Goal

Show up to five unread Windows notification cards per chat under one visual Toast Header while preserving exact per-message navigation.

## Behavior

- Each message notification row has its own native toast tag.
- Messages from the same chat share one native group and one Toast Header ID.
- Clicking a message card opens its exact `chat` and `message` route.
- Clicking the header opens the chat without selecting an arbitrary message.
- Only the five newest unread native message cards per chat are retained.
- Reading a chat removes every corresponding native message card.
- Task and system cards remain isolated and do not join message headers.
- Browser/PWA notification collapse and the in-app grouped Notification Center remain unchanged.

## Security

Routes remain relative to `https://app.letscube.ru` and pass the existing Rust and frontend validators. Native tag/group/header identifiers are bounded ASCII values; titles and XML attributes are escaped. No message IDs, routes, or previews are written to diagnostics.

## Platform Limits

Windows controls how many cards are immediately visible and may prune Notification Center history. LETSCUBE guarantees its own per-chat limit and grouping request, but cannot force the operating system to display all five without expansion.

