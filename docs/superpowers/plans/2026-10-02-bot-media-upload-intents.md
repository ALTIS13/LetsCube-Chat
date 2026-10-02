# Bot Media Upload Intents Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the SQL slice and independent review. The coordinator implements its separate runtime slice. Update checkboxes as evidence is collected.

**Goal:** Persist an inline-media PUT attempt before external I/O and preserve an unresolved outcome across crashes, lease rotation and token revocation.

**Architecture:** Add a private, append-preserved attempt ledger next to the existing charged admissions. New service-only RPCs begin and finish an attempt; the repository surrounds its existing insert-only upload/duplicate-byte verification with them. This is the non-destructive source/restore rehearsal required by the lifecycle contract, not a reclaimer or a complete object-generation fence.

**Tech Stack:** PostgreSQL PL/pgSQL, TypeScript, node:test, existing PostgreSQL fixture.

**Spec:** `docs/operations/2026-10-02-bot-media-lifecycle.md`, plus the bounded contract below.

## Global Constraints

- No deletion, quota release, object-path change, background reconciliation, native build/install or production apply in this slice. The current production runtime is unchanged until a separate fresh-backup/full-restore rollout gate passes.
- Keep charged admission time, bytes, reserved/complete state and completed result unchanged. Never infer provider terminality from age, lease expiry or a later successful retry.
- Read no personal rows and expose no secrets, paths, request bodies or provider diagnostics in logs/reports.
- `private.bot_media_upload_attempts`: owned by postgres, RLS enabled, no direct client/service-role table access; only service-role RPC execution. No cascading FK or automatic pruning.
- One attempt per admission lease. The lease UUID is the attempt ID, not a Storage object generation. At most 64 attempts per receipt; all count, including acknowledged ones. This bounds retained metadata without discarding unresolved attempts.
- States: pending, acknowledged, unknown. Pending survives a process crash; unknown survives any upload/download/transport error. Neither is eligible for deletion. Acknowledged is a trusted runtime observation of this attempt only, not exhaustive object-reference/legacy-I/O proof.
- Finish is idempotent for the same outcome; conflicting outcomes fail. No unknown-to-acknowledged transition. A late pending attempt can be acknowledged after token revocation/lease rotation, but cannot commit using the stale lease.
- Begin locks the existing operation identity, validates active token/bot/membership/current unexpired reservation, and compares chat/path/MIME/size/actual bytes SHA256/fingerprint. Finish takes that same lock; it authenticates the stored attempt identity, not the now-current token/lease. No transaction crosses network I/O.
- Preserve all existing reserve/commit and Storage policies/functions byte-for-byte. Existing objects without attempt coverage remain untracked holds for future cleanup. Additive RPCs do not fence other writers or D-103 purge.

## Review Focus

- Begin response lost: no external upload; any persisted pending attempt remains a hold.
- Successful PUT but finish response lost: no message commit; preserve the recorded acknowledgement or pending hold without asserting deletion safety.
- Duplicate 409 with wrong/short/oversized/broken bytes: never acknowledge; retain the attempt and do not delete.
- Old worker after lease transfer/token revoke: may record its own observed outcome, never alter another attempt or the charged receipt.
- Attempt exhaustion and ordinary concurrent sends: enforce the literal 64 cap under the shared operation lock without a quota-lock inversion or cross-receipt contamination.

### Task 1: Durable SQL Attempt Ledger

**Files:**
- Modify: CLI-created `supabase/migrations/20261002155123_bot_media_upload_intents.sql`
- Create: matching `.rollback.sql`, byte-identical copies in `.migration-backup/supabase/migrations/`
- Create: `tests/server/bot-media-upload-intents.test.mjs`

**Interfaces:**
- `bot_media_upload_begin_internal(p_bot_id uuid,p_token_id uuid,p_chat_id uuid,p_idempotency_key text,p_request_fingerprint text,p_lease_id uuid,p_object_path text,p_content_type text,p_byte_size bigint,p_content_sha256 text) -> {attempt_id: uuid,state:"pending"}`.
- `bot_media_upload_finish_internal(p_bot_id uuid,p_idempotency_key text,p_attempt_id uuid,p_outcome text) -> {attempt_id:uuid,state:"acknowledged"|"unknown"}`.
- Ledger identity `(bot_id,idempotency_key,attempt_id)` and globally unique attempt_id, snapshot object_path/content_type/byte_size/content_sha256/owner_token_id/chat_id/request_fingerprint, started_at and observed_at (null only pending).
- Rollback disables both RPCs and retains all ledger rows/RLS/ACL; reapply over the retained table refuses loudly.

- [x] Write behavior fixtures and show expected red before implementation: missing RPC; attempt exists before simulated PUT; current/stale/revoked/removed admission; wrong snapshot; same lease cannot admit another PUT; finish same/conflicting outcome; unknown never auto-clears; literal 64 accepted/65 refused; quota/result untouched; anon/authenticated/service-role direct table access denied; invalid input; catalog/body drift; rollback/reapply retention.
- [x] Implement one guarded transaction, raising prestate and self-check, pinned existing reserve/commit body and ACL guards, service-only grants, rollback header and archive.
- [x] Run actual PG tests including two-session begin/finish and lease-transfer ordering, late acknowledgement and stale commit refusal. Execute relevant source mutants with independent assertions. 13/13 PG18 cases; four behavior and three self-check guard mutants.
- [x] Commit only owned SQL/tests/archive; write the report in this plan's scratch directory. SQL commit `bb0bec42`.

### Task 2: Runtime Upload Envelope

**Files:**
- Modify: `artifacts/api-server/src/bot/repository.ts`, `artifacts/api-server/src/bot/methods/messages.ts`
- Create: `tests/unit/bot-media-upload-intents.test.mts`
- Create: `tests/server/bot-media-upload-runtime.test.mjs` (actual repository/handlers/RPCs; provider only simulated)
- Adapt: `tests/unit/bot-inline-media-storage.test.mts`, `tests/unit/bot-photo-upload.test.mts` where existing direct calls now require an admission identity.

**Interfaces:**
- `uploadInlineMedia`/compatibility `uploadPhoto` also require `tokenId`, `idempotencyKey`, `requestFingerprint`, `leaseId`. Compute SHA256 and byte count from the actual Buffer; never accept a caller-provided digest as proof.
- Consume Task 1 RPC signatures exactly. Validate their result identity/state before external I/O or returning success.

- [x] Write failing tests against shipped repository: begin precedes PUT; invalid/missing/malformed begin prevents PUT; ACK/verified duplicate precedes finish; failed/lost/malformed provider result records unknown; lost finish never proceeds to commit; provider/SQL details remain redacted; successful completed retry still skips PUT/intent; stale context does not bypass admission.
- [x] Add the narrow upload envelope, retain original streaming duplicate checks, and pass the reserved identity from sendMedia. No eager remove, no implicit retries and no optional bypass/default-off path.
- [x] Run focused runtime tests, actual SQL integration where feasible, typechecks/build and the unit suite. Prove source mutations for skipped admission, unknown wrongly acknowledged, skipped finish, wrong lease/digest.
- [x] Commit only owned runtime/tests; leave production publication held while the new RPC is unapplied. Runtime commit `9b41605d`.

### Task 3: Review, Restore And Checkpoint

**Files:**
- Create: `docs/operations/2026-10-02-bot-media-upload-intents.md`
- Modify: `docs/HANDOVER.md`, top resume of `docs/PRODUCTION_PRIORITY_TRACKER.md`, this plan.

- [x] Review the SQL/runtime diff for spec and quality, fix findings and re-review affected changes. Task 1, Task 2 and whole-wave APPROVE; no P1/P2 or requested source fixes.
- [x] Exercise migration/rollback/reapply and interleavings on isolated PostgreSQL; distinguish fixture proof from a full production restore. A full restore remains mandatory before production apply.
- [x] Record exact tests, source hashes, preserved unknown outcomes and remaining writer/generation/purge gates. Keep one current resume record, do not repeat closed stages.
- [x] Fetch and inspect outgoing candidate commits/aliases separately, commit and push the candidate branch only. Do not push this unapplied-RPC runtime to main. Leave no running tests/workers; keep main/runtime unchanged. Reviewed source `9b41605d`/`bb0bec42` pushed to `codex/bot-inline-media-20261002`.
