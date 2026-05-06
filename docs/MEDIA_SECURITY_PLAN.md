# Media Security Plan

Status: base migration applied manually on 2026-05-06.

## Current Finding

- Supabase Storage bucket `media` is still public for avatars and legacy public URLs.
- Supabase Storage bucket `chat-media` is private and intended for new private/group message media.
- Storage RLS policies exist for authenticated scoped read/write, but public bucket URLs are still directly readable.
- User avatars and group avatars currently share the same bucket with chat message media.
- `messages` now has `media_bucket` and `media_path` columns for private signed URL access.

Compatibility gap: legacy `messages.media_url` public links still exist until old media is backfilled/moved and frontend upload/read paths are fully switched to `chat-media` signed URLs.

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
