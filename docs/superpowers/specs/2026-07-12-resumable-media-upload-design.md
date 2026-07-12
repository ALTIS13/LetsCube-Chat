# Resumable Media Upload Design

## Scope

Add reliable progress, retry and reconnect recovery to staged chat attachments without changing message schema, Storage RLS, media variants, or optimistic message semantics. The implementation covers chat images, files, audio, regular video, voice and video-circle. Avatar uploads remain on the existing small-file path because prepared avatars are capped at 2 MB.

## Chosen Approach

Use a hybrid uploader:

- files up to 6 MiB keep the existing Supabase standard upload;
- files larger than 6 MiB use `tus-js-client@4.3.1` against the deployment-derived `/storage/v1/upload/resumable` endpoint;
- TUS chunks are exactly 6 MiB, with retry delays `0, 3000, 5000, 10000, 20000` ms;
- interrupted uploads resume while the staged `File` remains in the current app session;
- no 250 MB blobs are copied into IndexedDB, so browser reload/app restart recovery is intentionally out of scope;
- user cancellation and chat switching terminate active partial TUS uploads.

Supabase recommends TUS for uploads above 6 MB and unstable networks. The production self-hosted Storage API `v1.60.4` exposes TUS creation, PATCH, HEAD, termination and expiration with a 250 MiB maximum.

## Architecture

`src/lib/resumableStorageUpload.ts` owns endpoint construction, the 6 MiB threshold/chunk contract, access-token forwarding, retry/resume and abort. It returns an upload handle with a promise and an abort method; raw tokens and upload URLs are never logged.

`ChatWindow` remains the workflow owner. It uses stable object paths based on the existing attachment UUID, stores progress in `StagedAttachment.progress`, keeps uploaded-but-unsent objects for message retry, and owns active upload handles by attachment ID. Switching chats or removing an active attachment aborts its handle before clearing staged state.

`MessageInput` renders a determinate progress bar and percentage while bytes are uploading, then keeps the existing sending/failed/retry states. Small standard uploads may move directly from 0 to 100 because they do not expose byte progress.

## Safety Rules

- Capture the source chat ID for each send attempt and refuse message creation if the active chat changed.
- Object paths are deterministic per staged attachment; retries never create a second path.
- TUS uses `upsert: false` semantics and existing authenticated Storage RLS.
- Cancellation removes partial remote state when the server supports TUS termination.
- Browser/PWA/Capacitor use the same public Supabase URL; no LETSCUBE domain is hardcoded.
- No service-role key, raw access token, TUS URL or media URL is logged.
- No SQL or RLS change is required.

## Error Handling

- Automatic TUS retries handle transient connection loss.
- Exhausted retries keep the attachment staged with friendly retry UI.
- A manual retry reuses the same object path and TUS fingerprint.
- Authentication, payload-too-large, permission and generic failures use sanitized Russian copy.
- `video_message` uses the same 250 MB limit copy as regular video.

## Verification

- Pure contract tests cover threshold selection, endpoint normalization, stable paths and progress normalization.
- Adapter tests cover previous-upload resume, progress callbacks, success, final failure and termination.
- UI tests cover determinate progress, retry and cancellation controls at all configured desktop/mobile viewports.
- A production smoke uses a disposable authenticated QA object larger than 6 MiB, verifies TUS completion and deletes the object afterward.
- Existing camera, voice, video-circle, media quality, chat sync, PWA and RLS checks remain regression gates.

