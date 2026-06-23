# Media And Geo Plan

Current media UX state as of 2026-06-22:

- Chat images, GIFs and videos open inside the messenger via `MediaViewer`.
- The chat info media gallery is paged. Static image items use lazy real previews for the current page only; GIF/video items use lightweight placeholder tiles to avoid eager full-file downloads.
- When server-generated variants are ready, chat info media tiles use image thumbnails/previews and video posters instead of original media files.
- GIFs are not animated in the gallery; the full GIF loads only in the viewer.
- Videos are represented by a play tile in the gallery and load only in the viewer.
- New chat image uploads are client-optimized to bounded WebP before upload when the browser/WebView can do it.
- New avatar uploads are client-optimized to bounded WebP before upload when possible.
- New image/video attachments store lightweight `media_metadata` dimensions and size fields so chat bubbles can reserve stable layout before the media file finishes loading.
- Regular video attachments are allowed up to the current product limit. Server-side poster generation is implemented; full video transcoding remains pending.

Future media pipeline work:

- Apply `.migration-backup/supabase/migrations/20260622_media_variants_pipeline.sql` after review to introduce a `media_variants` table for server-generated previews.
- Build a trusted backend worker for server-side variants:
  - chat image preview: max 1280px WebP;
  - chat image thumbnail: max 360px WebP;
  - video poster: max 720px WebP;
  - avatar previews: 128px and 256px WebP;
- Add future video transcodes such as 720p MP4/WebM after production CPU/runtime sizing.
- Store variant bucket/path, dimensions and byte size separately from original media paths.
- Keep original chat media in private Storage with chat-member access checks.
- Add file upload progress and retry UI.
- Add optional video quality selection before upload once a transcoding path exists.
- Add album/grouped media support.

Future geo messages:

- Add explicit location sharing UI.
- Store coordinates in structured fields rather than only text links.
- Add permission-aware map previews.
- Preserve chat RLS and per-user clear/hide semantics for geo messages.
