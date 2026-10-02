# Bot Media Admission Foundation

Owner: Codex coordinator. Source/design assessment of `c2c3e46d`; the later
`c2455d80` closeout changes documentation only. Independent source review is
complete, not approval of a production migration or proof of safe reclamation.
The [D-103 whole-bucket hold](2026-10-02-bot-media-purge-hold.md) is already
applied/verified. Do not repeat its SQL, canary, restore or closed regressions.

## Implementation Order

1. **Logical identity and immutable bindings.** Private registry for ingest-owned
   `(bucket,path)` bound to `(bot_id,idempotency_key)`. A logical generation UUID
   identifies admission, not a verified physical Storage incarnation. Existing
   and future PUT attempts must retain that binding across lease takeover. Bind
   managed grants at issuance rather than resolving a later generation by path.
   No rotation/path reuse, receipt rewrite, charge reset or new client authority.
2. **Message reference resolver.** Return a set, not canonical/URL `COALESCE`.
   Canonical database paths remain literal; URLs use only the accepted bounded
   [decoder subset](../../scripts/bot-media-reference-preflight.sql). Canonical,
   legacy URL and preview are independent observations. Preview uses the parent
   message bucket. Missing buckets, malformed metadata, conflicting pointers,
   unsupported URLs and unregistered objects remain unresolved/ambiguous holds.
3. **Table-level message admission.** Rehearse separate AFTER STATEMENT
   INSERT/UPDATE/DELETE hooks with transition tables; UPDATE without a column
   list. Handle complete OLD/final-NEW references plus existing bindings, after
   moderation scrubbing. Removing a message-edge is not Storage DELETE/refund.
   Preserve direct permitted writes, forward RPC/fallback and bot `file_id`.

Stage 1 has [applied/verified identity and immutable bindings](2026-10-03-bot-media-logical-identity.md):
final **42/42**, 12 operator cases, same-image PG17 full restore and independent
source/test/operator approval; one guarded production application at 01:07 MSK
after backup `20261003-010706`. Stages 2 and 3 are **not implemented yet**. Do not
claim the whole foundation from a new UUID column or repeat stage 1 SQL.
Registry/backfill/initial observations require an atomic bootstrap without a
writer window. Backfill never proves absent references or provider terminality.

## Lock And Authority Contract

Reference admission should use compatible shared object fences over the full
distinct old/new/binding set in stable bucket/path/generation order. Recheck
admission after waiting. Do not update a shared reference counter while holding
only shared locks. No new quota/operation acquisition after object fences.
A test-only closer must not wait for message, membership or Storage rows.
Unknown coverage requires a shared coverage fence: an existing unknown hold
must block close, and an unknown writer after close must not bypass it.

This lock contract is **unproven**, especially across multiple statements,
nested writes and INSERT ON CONFLICT. Sorting one handler is insufficient.
Use actual independent PostgreSQL sessions and preserve the existing lock
prefixes in [writer inventory](2026-10-02-bot-media-writer-inventory.md).
If those interleavings fail, ship only identity/observations with admission
explicitly open; do not label that a writer fence.

RLS, ownership, same-chat visibility, token/membership and idempotency checks
remain independent authority. Forward and `file_id` authorization after new
waits needs proof. No production seal or deletion entrypoint belongs here.
Physical Storage generation, late PUT outcomes, avatar/variant writers and
moderation lifecycle stay open until their separate acceptance.

## Source Evidence

- [Receipt and rotating lease](../../supabase/migrations/20261002020000_bot_inline_media_ingest.sql):
  admission preserves original charge time/bytes and result; commit has existing
  quota, operation, receipt, membership and Storage/grant waits.
- [Upload attempts](../../supabase/migrations/20261002155123_bot_media_upload_intents.sql):
  pending/unknown are retained; lease UUID is not object generation.
- [Path guard](../../.migration-backup/supabase/migrations/20260913131000_message_media_path_guard.sql):
  ownership remains necessary; UPDATE coverage lacks URL/metadata-only changes.
- [Forward](../../.migration-backup/supabase/migrations/20260911144000_forward_message_with_media.sql)
  and [file reuse](../../.migration-backup/supabase/migrations/20260919040000_a_bot_can_send_back_the_file_it_was_sent.sql):
  source reads lack an object fence.
- [Preview renderer](../../artifacts/kub/src/hooks/useMediaVariants.ts) and
  [final scrub](../../supabase/migrations/20260928210000_deleted_message_keeps_nothing.sql):
  account for parent bucket and final row; do not omit every deleted message.

## Required Acceptance

Identity: takeover/retry leaves one immutable logical identity; every old/new
attempt and managed grant retains its issuance binding; receipts, initial
charges, results and ordinary grants are preserved. Unknown outcomes remain
held. Refuse identity changes/path reuse and unauthorized direct access.

Resolver/admission: baseline RED, writer-first and test-closer-first for actual
authenticated and trusted writes; URL-only/preview-only changes, forward
RPC/fallback and `file_id`; reverse-order multi-object operations and rollback;
authorization changes during waits. Independent literal oracles require zero
committed new references after close, retained holds and unchanged accounting.
Expose omission of URL/preview, trusted bypass, checking before wait and treating
unresolved as absent. Same-image PG17 backup/restore/rollback and independent
review remain mandatory before any production SQL. None of those new behavioral
tests or migrations were run by this source/design assessment.

This source/design assessment itself made no runtime/schema/client/device changes,
production captures, Storage calls or paid device-minute use. Current implementation
status and workers are in the linked identity record and HANDOVER, not this older assessment.
