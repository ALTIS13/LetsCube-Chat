# Media And Geo Plan

Current media UX state as of 2026-05-06:

- Chat images, GIFs and videos open inside the messenger via `MediaViewer`.
- The chat info media gallery is paged. Static image items use lazy real previews for the current page only; GIF/video items use lightweight placeholder tiles to avoid eager full-file downloads.
- GIFs are not animated in the gallery; the full GIF loads only in the viewer.
- Videos are represented by a play tile in the gallery and load only in the viewer.

Future media pipeline work:

- Generate server-side thumbnails/posters for images, GIFs and videos.
- Store thumbnail paths separately from original media paths.
- Keep original chat media in private Storage with chat-member access checks.
- Add file upload progress and retry UI.
- Add album/grouped media support.

Future geo messages:

- Add explicit location sharing UI.
- Store coordinates in structured fields rather than only text links.
- Add permission-aware map previews.
- Preserve chat RLS and per-user clear/hide semantics for geo messages.
