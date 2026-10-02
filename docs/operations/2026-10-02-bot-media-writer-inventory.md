# Bot media reference writers and external I/O: source inventory

Date: 2026-10-02. Source baseline: `6bbff06b`, branch `codex/bot-inline-media-20261002`.

**Source review only.** No database/catalog query, Storage request, credentials,
device access or production mutation was performed. Migration definitions below
are repository evidence, not a claim that every definition is currently installed.
This is a bounded inventory of the named paths, not exhaustive proof of all writers.

The coordinator subsequently captured a separate schema-only live catalog at
22:57 MSK; see [resolver acceptance](2026-10-02-bot-media-reference-resolver.md#next-boundary).
It confirms the named path-guard update columns and unchanged purge claim body,
not every claim in this source inventory or complete fencing. Do not repeat the
accepted reference audit solely because the original inventory was source-only.

Resume: documentation worker; inventory complete; evidence is the linked source;
blocker for reclamation is missing shared reference/generation/external-I/O fencing;
next action is the coordinator's read-only reference audit, then an independently
reviewed no-delete fence slice.

## Baseline and boundary

[HANDOVER](../HANDOVER.md) records the upload-intent rollout as accepted and the
next work as writer/generation/purge fencing plus legacy/encoded references.
Do not repeat that rollout. [Lifecycle](2026-10-02-bot-media-lifecycle.md) keeps
reclamation disabled; [upload intents](2026-10-02-bot-media-upload-intents.md)
preserve pending/unknown PUT attempts. Neither a lease UUID nor a path fingerprint
is an object generation. This report does not authorize deletion or quota release.

Keep these namespaces separate: inline bot media uses `chat-media/<chat>/bots/...`;
ordinary client uploads use `media/<user>/...`; bot avatars use
`media/bot-avatars/...`; derived variants use `media`. An avatar or variant is not
automatically an ingest-charged object. References to an ingest object can outlive
the message that introduced it.

## Writer inventory

| Path and source | Reference/external operation | Existing boundary; missing lifecycle fence |
| --- | --- | --- |
| Human send: [appOutbox](../../artifacts/kub/src/lib/outbox/appOutbox.ts), [background upload](../../artifacts/kub/src/lib/outbox/appBackgroundUploads.ts), [attachment upload](../../artifacts/kub/src/lib/attachmentUpload.ts), [path builder](../../artifacts/kub/src/lib/stagedAttachments.ts) | Direct `messages.insert` carries `media_bucket`, `media_path`, `media_url`, `media_metadata`; compatibility retry omits metadata. Original and optional adjacent preview are uploaded before the insert. Large uploads use [TUS](../../artifacts/kub/src/lib/resumableStorageUpload.ts); both upload forms are insert-only. | Normal UI generates human-owned paths, not bot paths. DB writers still need a table-level admission fence covering canonical, URL and preview changes, rather than a check only in this sender. Ordinary RLS clients cannot PUT/UPDATE/DELETE the reserved bot namespace under the restrictive policies below; that does not serialize reference writes or trusted worker I/O. |
| Forward: [useMessages](../../artifacts/kub/src/hooks/useMessages.ts), [forwardInsertPayload](../../artifacts/kub/src/lib/messageForward.ts), [forward RPC migration](../../.migration-backup/supabase/migrations/20260911144000_forward_message_with_media.sql) | RPC copies canonical columns, full metadata and legacy `media_url`, then copies ready `media_variants` source/target pointers into rows for the destination. Missing-RPC fallback directly inserts copied message fields; it does not copy variant rows itself. Neither path uploads original bytes. | RPC checks source visibility, destination membership/mute and topic. Its source/variant reads do not take an object fence. A forward may add a hold after purge has checked the original. Shared variants and legacy URL-only forwards must count independently of the original message. |
| Bot media/file reuse: [methods/messages](../../artifacts/api-server/src/bot/methods/messages.ts), [repository](../../artifacts/api-server/src/bot/repository.ts), [file_id SQL](../../.migration-backup/supabase/migrations/20260919040000_a_bot_can_send_back_the_file_it_was_sent.sql) | Existing `media` goes through `bot_upload_authorize_internal` and a consumed upload grant. `file_id` resolves an authoritative same-chat readable, non-deleted source and copies its canonical pointer plus whitelisted metadata/preview. Both call `bot_message_command_internal` / `bot_send_message_internal` to insert a new reference; `file_id` does not upload or consume a grant. | Membership, post-join/privacy visibility, type and idempotency checks are not a deletion fence. The `file_id` source read has no object-generation lock. Grants bind bot/chat/bucket/path and attributes, not an immutable object generation. Preserve the same-chat restriction. |
| Bot inline upload: [methods/messages](../../artifacts/api-server/src/bot/methods/messages.ts), [repository](../../artifacts/api-server/src/bot/repository.ts), [ingest SQL](../../.migration-backup/supabase/migrations/20261002020000_bot_inline_media_ingest.sql), [attempt SQL](../../.migration-backup/supabase/migrations/20261002155123_bot_media_upload_intents.sql) | Reserve charged receipt; begin durable attempt; external insert-only upload; duplicate-object download/byte verification; finish ACK or unknown; commit through grant/message command. Commit checks Storage metadata and takes a Storage row share lock inside its transaction. | This is already implemented, not a missing PUT log. Pending/unknown attempts remain holds, including old attempts after lease takeover. Missing: generation binding and cooperation by *other* reference writers/deleters. ACK is not proof that no older request can still finish; a SQL lock does not span remote I/O. |
| Profile/chat avatars: [SettingsScreen](../../artifacts/kub/src/components/settings/SettingsScreen.tsx), [ChatInfoPanel](../../artifacts/kub/src/components/chat/ChatInfoPanel.tsx), [UsersTab](../../artifacts/kub/src/pages/admin/UsersTab.tsx), [admin avatar RPC](../../.migration-backup/supabase/migrations/20260517_admin_profile_avatar_permissions.sql), [useUser](../../artifacts/kub/src/hooks/useUser.ts) | UI uploads an avatar then updates `profiles.avatar_url` or `chats.avatar_url`; clearing removes the reference. Admin path uses `admin_update_user_profile` with a compatibility direct update. Missing-profile bootstrap can insert an avatar URL from auth metadata. | Permissions/ownership gate the row operation, not lifecycle admission of its URL. `admin_update_user_profile` assigns the supplied URL after permission checks. Scan/guard inserts, swaps and clears, including non-UI/direct permitted writes. Avatar holders have no `message_id`; message-only reference counting misses them. |
| Bot avatar: [botAvatar](../../artifacts/kub/src/lib/botAvatar.ts), [management route](../../artifacts/api-server/src/bot/managementRoutes.ts), [avatar schema/policies](../../.migration-backup/supabase/migrations/20260904010000_bot_avatar.sql), [current setter body](../../.migration-backup/supabase/migrations/20260919030000_a_refusal_to_set_a_picture_says_why.sql), [policy repair](../../.migration-backup/supabase/migrations/20260905140000_bot_avatar_policy_repair.sql) | Owner uploads with `upsert:true` to its bot-avatar path; API records URL using `bot_set_avatar_internal`. Clear sets URL null and leaves bytes. | Setter locks the bot row, checks owner/state and the bot-specific URL prefix; it is not an object-existence/generation fence. Ordinary setter cannot point directly at an inline `chat-media` object. Still inventory `bots.avatar_url` for trusted/legacy references and any future avatar reclamation; do not broaden its URL contract. |
| Variant worker: [mediaVariantsWorker](../../artifacts/api-server/src/workers/mediaVariantsWorker.ts), [variant schema](../../.migration-backup/supabase/migrations/20260622_media_variants_pipeline.sql), [chat avatar shape](../../.migration-backup/supabase/migrations/20260904040000_chat_avatar_variants.sql) | Resolves message canonical/legacy URL or profile/chat avatar URL, downloads source, uploads derived target with `upsert:true`, then separately deletes/reinserts variant rows. Both `source_bucket/source_path` and `variant_bucket/variant_path` are references. Video rendition can also reuse original bytes as the rendition. Failure rows also carry pointers. | Job claims are per target, not per object. Reads, external PUT and row replacement are separate operations; rereading outstanding work afterward is not admission fencing. Hold the source during work and the target before PUT through publication, including failed/unknown I/O and a crash between PUT and row insert. Current worker handles profile/chat avatar scopes, not a bot-avatar job scope. |
| D-103 deletion: [purge worker](../../artifacts/api-server/src/workers/mediaPurgeWorker.ts), [purge SQL](../../.migration-backup/supabase/migrations/20260928210000_deleted_message_keeps_nothing.sql) | Soft delete scrubs message references and queues original/derived preview paths. Claim removes deleted-message variant rows and queues their targets, marks known live references kept, leases pending queue rows, then worker externally removes objects and calls finish. | Lease is on queue UUID, not `(bucket,path,generation)`; different messages can queue the same object. No shared fence protects the interval between claim and Storage remove. `finish` identifies queue UUID, not a rotating claimant token/generation. Existing purge is a participant that must be integrated, not a bypass for a new cleanup mechanism. |

## Current trigger and policy interactions

- [Path guard](../../.migration-backup/supabase/migrations/20260913131000_message_media_path_guard.sql):
  `trg_guard_message_media_path` is BEFORE INSERT or UPDATE OF
  `media_bucket, media_path, user_id, bot_id, forwarded_from_id`. Its helper allows
  null paths, trusted/auth-null writes, bot senders and matching forwarded paths;
  otherwise it checks the human prefix. It neither fires on URL-only/preview-only
  updates nor takes a lifecycle lock. Do not replace its ownership checks with
  lifecycle checks; both are necessary.
- [Membership epoch](../../.migration-backup/supabase/migrations/20260926144000_bot_privacy_delivery_epoch.sql):
  `trg_a_lock_bot_message_epoch` runs BEFORE INSERT, taking SHARE locks on active
  chat-bot membership rows in bot-id order. `trg_guard_bot_message_created_at`
  governs timestamps, not object liveness.
- [Forward origin](../../.migration-backup/supabase/migrations/20260921120000_a_forward_names_its_source.sql):
  `trg_messages_forward_origin` owns attribution and prevents later attribution
  edits. It does not protect the referenced Storage object.
- [Variant queue](../../.migration-backup/supabase/migrations/20260913120000_media_variant_job_queue.sql):
  `trg_enqueue_media_variant_job_on_insert`, `..._on_update`,
  `..._for_profile`, `..._for_chat` enqueue work after message/avatar mutations.
  [Micro-group amendment](../../.migration-backup/supabase/migrations/20260930150100_micro_group_avatar_variants.sql)
  expands the chat enqueue predicate. These jobs are not generation reservations.
- [Deletion](../../.migration-backup/supabase/migrations/20260928210000_deleted_message_keeps_nothing.sql):
  BEFORE `trg_zz_deleted_message_keeps_nothing` has the final scrub; AFTER
  `trg_zz_deleted_message_leaves_no_preview` scrubs notifications.
  `trg_content_report_closed_finishes_deletion` revisits a deletion after report
  closure. Open `new/reviewing` reports retain message material. Any reference
  accounting must observe the final row, preserve moderation holds and coordinate
  their creation/closure, not treat a deleted row as automatically reference-free.
- [Ingest Storage policies](../../.migration-backup/supabase/migrations/20261002020000_bot_inline_media_ingest.sql):
  restrictive INSERT/UPDATE/DELETE guards block ordinary clients on the reserved
  `chat-media` bot path. Service-role/Storage-owner I/O bypasses RLS by design;
  these policies cannot stand in for worker-side lifecycle participation.

## Lock ordering: existing versus proposed

1. Ingest reserve/commit take **global quota advisory lock -> bot/idempotency
   operation advisory lock**. Both lock active token/bot rows SHARE; reserve
   checks membership before receipt FOR UPDATE, commit locks receipt before
   membership. Commit then locks `storage.objects` SHARE, obtains a grant and
   inserts a message. The message trigger adds ordered membership SHARE locks.
2. Upload begin takes **operation -> token/bot -> receipt -> membership**;
   finish takes **operation -> attempt row**. Neither subsequently takes quota.
   [Grant authorization](../../.migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql)
   serializes the bot/chat/bucket/path grant key and locks a grant row. That key is
   not a universal object fence shared by avatars, forwards or purge.
3. Existing media commands take the operation lock, never quota; direct message
   writes/forwards have no quota/operation prefix. Avatar setter already holds a
   bot row. Variant jobs and purge claim use queue row locks / SKIP LOCKED, which
   end before external I/O.
4. Lifecycle's **quota (if needed) -> operation (if needed) -> sorted object
   fences** is a proposed hierarchy, not installed proof. A new object trigger
   must account for rows already locked by UPDATE and the membership/Storage/
   grant locks above. A purge holding object fence then waiting for a message row
   can cycle with a message UPDATE holding that row then waiting for the fence.
   Do not introduce that inverse wait; establish/rehearse one ordering before
   implementing admission and sealing. Multi-object old/new source/target sets
   need deterministic order, not only sorted locks inside each individual row.

## Exact gaps and next bounded slice

The linked D-103 claim tests canonical live message paths, explicit/derived
previews and **variant targets**. It does not test legacy `media_url`, avatar URLs,
variant **sources**, ingest receipts or upload attempts. It checks references in
one transaction, then performs DELETE later. The worker also percent-decodes the
queued path before removal: comparison and deletion can therefore name different
strings for the same object. Unsupported/ambiguous URL forms must hold, not become
negative reference evidence. The coordinator owns the read-only URL audit; this
inventory does not duplicate or edit it.

Recommended next implementation after that audit: **reference admission foundation
for ingest-owned objects, with deletion and quota release still disabled**.

- Add a reviewed private object-generation/fence boundary and DB admission for
  message canonical/legacy URL/preview references, including direct INSERT/PATCH,
  forward RPC/fallback and bot `media`/`file_id`. Resolve old and new references
  consistently; preserve all existing authorization and idempotency semantics.
- Make the existing D-103 path hold ingest-owned objects, including recognized
  encoded aliases and unresolved overlaps, until it joins the same seal/intent
  protocol. A new reclaimer being disabled does not disable this old deleter.
- Rehearse admission versus a **test-only seal**, including the current grant,
  Storage and membership waits. This slice must not expose a production seal,
  remove bytes, release quota or claim that avatar/variant writers are fenced.
- Follow separately with avatar/reference mutation fences and variant source/
  target I/O intents, then D-103 claimant/generation-aware external DELETE and
  exactly-once quota release. Until all participate, keep reclamation closed.

## Acceptance interleavings still needed

These are required future behavioral/concurrency cases, **not tests run here**.
Use independent DB sessions and controlled fake Storage barriers, not source regex.

1. Direct canonical insert, URL-only insert/update and preview-only change racing
   a seal: writer-first creates a hold; seal-first refuses the new reference.
   Exercise authenticated direct writes and trusted writes separately.
2. Forward RPC and fallback pause after source read; source is deleted and purge
   claims; forward resumes. No successful reference may point to bytes removed
   by the competing delete. Repeat for shared variant target and encoded URL.
3. `file_id`/existing-grant send versus delete, plus token/membership changes while
   locks wait: no bypass of visibility, no inverse-lock deadlock, no stale grant
   attaching a released generation. Completed retries keep their original result.
4. Avatar set/swap/clear and missing-profile insert race seal; admin and bot setter
   remain permission-bound. A holder with no message row still prevents deletion.
5. Variant source read pauses before PUT; source reference changes/deletes; target
   PUT finishes late. Cover PUT-before-row crash, failed/unknown operation, avatar
   reused target path and shared target. Source and target remain held until a
   conclusive generation-bound outcome, not merely job lease expiry.
6. Old upload attempt completes after lease takeover or token revocation; newer
   attempt already ACKed. Old pending/unknown still blocks reclamation. Test
   missing Storage object with unknown PUT, not only currently present bytes.
7. D-103 has two queue rows for one object; claim expires during DELETE; second
   claimant starts, first returns late. No late finish certifies a new generation;
   lost DELETE response and crash-before-finish retain a hold and cannot double
   release quota or erase rolling daily usage/receipts.
8. Open moderation hold versus delete/reference removal and subsequent closure;
   reverse-order multi-object writes; variant-row delete/insert gap. Preserve
   evidence and recheck after lock waits. Unknown reference resolution stays a
   blocker rather than being counted as absent.

## Verification limits

Local work was targeted source inspection plus report link/whitespace checks.
No application suite or live acceptance was run for this documentation-only task.
Live function bodies, owners, ACL/RLS, trigger ordering/enabled state, job status,
actual object/reference counts and unsupported URL populations must be supplied
by the coordinator's authorized read-only audit before any migration proposal
uses them as prestate. Historical live observations in linked docs are not a
fresh catalog check. No runtime, migration or coordinator-owned preflight file
was edited; no commit or push was made.
