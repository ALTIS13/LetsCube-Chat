# Resumable Media Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visible upload progress, automatic retry/resume and real cancellation for large staged chat media while preventing cross-chat sends.

**Architecture:** A focused TUS adapter handles files above 6 MiB and preserves the standard Supabase upload for smaller files. `ChatWindow` owns upload handles and workflow state; `MessageInput` only renders progress and actions.

**Tech Stack:** React, TypeScript, Supabase Storage, `tus-js-client@4.3.1`, Playwright, pnpm.

## Global Constraints

- No SQL, RLS or schema changes.
- No service-role key or trusted credentials in frontend code.
- TUS threshold and chunk size are exactly `6 * 1024 * 1024` bytes.
- Retry delays are exactly `[0, 3000, 5000, 10000, 20000]` ms.
- Upload paths are stable across retries and keep the authenticated user ID as the first path segment.
- Chat switching and explicit cancellation must abort active upload handles before staged state is cleared.
- Files are not persisted in IndexedDB; resume is limited to the current staged session.
- Existing originals, media variants, optimistic message IDs and browser/PWA behavior remain unchanged.

---

### Task 1: TUS Storage Adapter And Stable Paths

**Files:**
- Create: `artifacts/kub/src/lib/resumableStorageUpload.ts`
- Modify: `artifacts/kub/src/lib/stagedAttachments.ts`
- Modify: `artifacts/kub/src/lib/supabase/client.ts`
- Modify: `artifacts/kub/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `tests/e2e/resumable-media-upload.spec.ts`

**Interfaces:**
- Produce `shouldUseResumableUpload(fileSize: number): boolean`.
- Produce `buildResumableUploadEndpoint(supabaseUrl: string): string`.
- Produce `startResumableStorageUpload(options): { result: Promise<{ path: string }>; abort(terminate?: boolean): Promise<void> }`.
- Change `chatAttachmentUploadPath` to return the same path for repeated calls with the same chat, user and attachment.

- [ ] Write failing tests for the 6 MiB boundary, URL normalization, stable path, 0-100 progress clamping, previous-upload resume and abort termination.
- [ ] Run `pnpm.cmd exec playwright test tests/e2e/resumable-media-upload.spec.ts --project=chromium-desktop-1440` and confirm failures are caused by missing interfaces.
- [ ] Install exactly `tus-js-client@4.3.1` with `pnpm.cmd --filter @workspace/kub add tus-js-client@4.3.1`.
- [ ] Implement the minimal adapter with 6 MiB chunks, the specified retry delays, authenticated session token, `uploadDataDuringCreation`, `removeFingerprintOnSuccess`, `findPreviousUploads` and sanitized errors.
- [ ] Run the focused test and KUB typecheck until green.
- [ ] Commit with message `feat: add resumable storage upload adapter`.

### Task 2: Chat Workflow, Progress UI And Cross-Chat Safety

**Files:**
- Modify: `artifacts/kub/src/components/chat/ChatWindow.tsx`
- Modify: `artifacts/kub/src/components/chat/MessageInput.tsx`
- Modify: `artifacts/kub/src/lib/stagedAttachments.ts`
- Test: `tests/e2e/resumable-media-upload.spec.ts`
- Test: `tests/e2e/video-message.spec.ts`

**Interfaces:**
- Consume Task 1 upload handle.
- Store upload progress as an integer percentage in `StagedAttachment.progress`.
- Keep one active handle per attachment ID and abort it on removal/chat change/unmount.

- [ ] Add failing tests for determinate progress copy/bar, failed retry, active cancellation, source-chat guard and the 250 MB video-circle error label.
- [ ] Run the focused test and confirm each new assertion fails for the intended missing behavior.
- [ ] Route files above 6 MiB through the TUS adapter and smaller files through the existing standard upload.
- [ ] Capture the source chat ID and stop before `sendMediaMessage` when the selected chat changed.
- [ ] Abort and remove active handles on cancellation, removal, chat change and unmount.
- [ ] Render progress percentage and a determinate bar without resizing the attachment tray.
- [ ] Run focused upload/video tests and KUB typecheck until green.
- [ ] Commit with message `feat: add staged upload progress and cancellation`.

### Task 3: Integrated QA, Production Smoke And Documentation

**Files:**
- Modify: `docs/PRODUCTION_PRIORITY_TRACKER.md`
- Modify: `docs/QA_RESULTS.md`

- [ ] Run `git diff --check`.
- [ ] Run `pnpm.cmd --filter @workspace/kub run typecheck`.
- [ ] Run `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`.
- [ ] Run focused Playwright on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915.
- [ ] Run `pnpm.cmd e2e:smoke`, `pnpm.cmd db:types:check` and `pnpm.cmd rls:smoke`.
- [ ] Push `main`, verify the exact Coolify deployment and `running:healthy` state.
- [ ] Upload and delete a disposable authenticated QA object above 6 MiB through production TUS; do not print credentials, upload URLs or object paths.
- [ ] Record exact results and remaining limitations in the tracker and QA report.
- [ ] Commit with message `Document resumable media upload rollout` and push `main`.

