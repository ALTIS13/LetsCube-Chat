# Media Security Plan

Status: proposal required. Do not apply SQL from the application.

## Current Finding

- Supabase Storage bucket `media` is public.
- Storage RLS policies exist for authenticated scoped read/write, but public bucket URLs are still directly readable.
- User avatars and group avatars currently share the same bucket with chat message media.
- `messages` stores `media_url` as a URL; there is no dedicated `media_bucket` / `media_path` field for private signed URL access.

Impact: private and group chat media can be opened by anyone who obtains a direct public Storage URL. This is not acceptable for message attachments.

## Target Model

1. Keep avatars public, or move avatars to a dedicated public bucket later.
2. Store message attachments in a private `chat-media` bucket.
3. Store private message media paths in `messages.media_bucket` and `messages.media_path`.
4. Use paths that include `chat_id`, for example:
   - `{chat_id}/{message_id}/{filename}`
   - `{chat_id}/{sender_user_id}/{client_file_id}`
5. Storage SELECT policy must allow reads only when `auth.uid()` is a member of that `chat_id`.
6. Frontend must use signed URLs for message media from the private bucket.
7. Frontend must not use `service_role`.

## Compatibility

Legacy `messages.media_url` public links cannot be made private safely while avatars and old message media share the same public bucket. Migration should be phased:

1. Add private `chat-media` bucket and path columns.
2. Update frontend upload/read path for new message media.
3. Keep legacy `media_url` readable during transition.
4. Backfill/move old chat media into `chat-media` with an admin-controlled script outside the frontend.
5. After old message media is migrated, remove public message URLs and keep only avatars public.

## Manual QA After Migration

- User A uploads image/video/file in private chat.
- User B, as chat member, can view it in the app.
- User C, not a chat member, cannot read the private Storage object or create a signed URL.
- Existing avatars still render.
- Existing legacy media remains visible until backfill is complete.
