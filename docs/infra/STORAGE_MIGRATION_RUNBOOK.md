# Storage Migration Runbook

KUB uses Supabase Storage for avatars and chat media. Storage migration must
preserve bucket names, object paths, MIME types, and access policies.

## Inventory

- Buckets used by the app.
- Public/private status for each bucket.
- RLS/storage policies.
- Object path conventions.
- Maximum expected media size.
- Signed URL behavior.

## Migration steps

1. Export bucket/object list.
2. Copy objects to the self-hosted Storage backend.
3. Preserve paths exactly.
4. Recreate buckets before restoring objects.
5. Apply storage policies.
6. Verify app-facing URLs and signed URL generation.

## QA

- Avatar upload/view.
- File attachment upload/view.
- Image preview.
- Regular video playback.
- Voice playback.
- Video-circle playback.
- Media viewer.
- Access denied for users outside the chat.

## Safety

- Do not include raw signed URLs in docs, logs, notifications, or monitoring.
- Do not expose private media buckets as public to fix a migration issue.
- Do not delete Cloud storage until restore QA passes.
