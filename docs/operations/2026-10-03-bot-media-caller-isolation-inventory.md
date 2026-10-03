# Message Media Caller And Isolation Inventory

Date: 2026-10-03. Source baseline: `15abed3d9f84282a86dbbac4c5f935fe937101ae`,
branch `codex/bot-inline-media-20261002`. Owner: independent documentation sidecar.
Stage: bounded source inventory. Evidence: linked repository definitions and
consumers. Blocker: actual caller isolation/configuration and full-schema acceptance.
Next: coordinator-owned waited-authority cases and explicit compatibility gates.

**Source only, not live catalog or deployment evidence.** No SQL/session, tests,
SSH/API, secret read, native operation, commit or push was performed. Historical
acceptance in [HANDOVER](../HANDOVER.md) is not refreshed by this inventory.
This does not establish exhaustive coverage of every permitted database writer.

The [coverage protocol](2026-10-03-bot-media-coverage-protocol.md) is test-only,
RC-only and try-only. Existing authority/lock-prefix analysis and its interleavings
remain in the [prefix review](2026-10-03-bot-media-coverage-prefix-review.md);
this document does not repeat or accept those races. The broader
[writer inventory](2026-10-02-bot-media-writer-inventory.md) and
[foundation](2026-10-03-bot-media-admission-foundation.md) retain non-message holders,
external I/O and physical-generation obligations. No production close/delete/refund
permission follows from identifying a caller.

## Application Callers And Mutation Bodies

Gateway [construction](../../artifacts/api-server/src/botGatewayIndex.ts#L57)
supplies the real repository/handler set to the app's
[method-router mount](../../artifacts/api-server/src/bot/app.ts#L128).
Links name actual consumers, not only exported declarations. SQL references are
repository definitions/deltas; installed bodies, ACLs, enabled triggers and
PostgREST role/function settings were not queried.

| Surface | Actual source caller | Message mutation and transaction boundary |
| --- | --- | --- |
| Bot text, edit and delete | Mounted [message handler set](../../artifacts/api-server/src/bot/methodRouter.ts#L63); [text](../../artifacts/api-server/src/bot/methods/messages.ts#L253), [edit/delete](../../artifacts/api-server/src/bot/methods/messages.ts#L300) call `executeMessageCommand`; [repository RPC](../../artifacts/api-server/src/bot/repository.ts#L673). | `public.bot_message_command_internal(uuid,uuid,text,jsonb,text,text)` [definition](../../.migration-backup/supabase/migrations/20260919040000_a_bot_can_send_back_the_file_it_was_sent.sql#L125), with [ingest delta](../../supabase/migrations/20261002020000_bot_inline_media_ingest.sql#L92). Sends call `public.bot_send_message_internal(uuid,uuid,text,jsonb,text)`; edit/delete [UPDATE messages](../../.migration-backup/supabase/migrations/20260919040000_a_bot_can_send_back_the_file_it_was_sent.sql#L372). Command/send have implicit VOLATILE declarations; the ingest migration explicitly requires `provolatile='v'` for both [at prestate](../../supabase/migrations/20261002020000_bot_inline_media_ingest.sql#L32). `sendChatAction` takes the command path but [does not mutate messages](../../.migration-backup/supabase/migrations/20260919040000_a_bot_can_send_back_the_file_it_was_sent.sql#L348), so message triggers are not an RPC-wide isolation gate. |
| Bot existing media and `file_id` | [sendMedia](../../artifacts/api-server/src/bot/methods/messages.ts#L185) calls preflight, optionally a separate `authorizeMedia`, then command [at 210](../../artifacts/api-server/src/bot/methods/messages.ts#L210); repository [preflight/grant RPCs](../../artifacts/api-server/src/bot/repository.ts#L686). | The same send body [reads authoritative same-chat file_id](../../.migration-backup/supabase/migrations/20260919040000_a_bot_can_send_back_the_file_it_was_sent.sql#L531), or consumes a matching grant, then [INSERTs messages](../../.migration-backup/supabase/migrations/20260919040000_a_bot_can_send_back_the_file_it_was_sent.sql#L695). `file_id` does not upload/obtain a grant. Preflight, grant and send are separate RPC calls, not one coverage transaction. |
| Bot inline ingest commit | [reserve/upload/commit sequence](../../artifacts/api-server/src/bot/methods/messages.ts#L162); [commit RPC](../../artifacts/api-server/src/bot/repository.ts#L725). | `public.bot_media_ingest_commit_internal(uuid,uuid,text,text,uuid,jsonb)` [definition](../../supabase/migrations/20261002020000_bot_inline_media_ingest.sql#L264), implicit VOLATILE. [Grant, commit marker, nested command and completion](../../supabase/migrations/20261002020000_bot_inline_media_ingest.sql#L328) share the commit RPC transaction. Earlier reserve, upload-attempt RPCs and external PUT are separate and are not undone by a refused message. A complete-receipt duplicate [returns before DML](../../supabase/migrations/20261002020000_bot_inline_media_ingest.sql#L302); do not assert that every duplicate reaches the message barrier. |
| Human ordinary text/media send | [useMessages enqueue](../../artifacts/kub/src/hooks/useMessages.ts#L1268); background attachment [handoff to the same outbox](../../artifacts/kub/src/lib/outbox/appBackgroundUploads.ts#L165). | [sendEntry](../../artifacts/kub/src/lib/outbox/appOutbox.ts#L72) performs direct PostgREST `messages.insert`, with canonical/URL/metadata pointers. The [missing-metadata retry](../../artifacts/kub/src/lib/outbox/appOutbox.ts#L100) and acknowledgement read are separate requests. Normal client authorization remains RLS; message coverage cannot be limited to trusted RPCs. An earlier completed Storage upload is outside the insert transaction. |
| Human edit, soft delete, delete batch and pin | Direct [content edit](../../artifacts/kub/src/hooks/useMessages.ts#L1409), [deleted_at update](../../artifacts/kub/src/hooks/useMessages.ts#L1432); [batch deletion RPC/fallback](../../artifacts/kub/src/hooks/useMessages.ts#L1547); [pin/unpin RPC](../../artifacts/kub/src/hooks/useMessages.ts#L1574). | `public.delete_messages_for_everyone(uuid[])` is explicitly VOLATILE [at 101](../../.migration-backup/supabase/migrations/20260911143000_delete_messages_for_everyone.sql#L101) and [UPDATEs messages plus deletion ledger](../../.migration-backup/supabase/migrations/20260911143000_delete_messages_for_everyone.sql#L190). `public.pin_message(uuid)` / `unpin_message(uuid)` have implicit VOLATILE [definitions](../../.migration-backup/supabase/migrations/20260506_message_pinning_permissions.sql#L23) and mutate `pinned`. Separate deletion batches/fallback calls are not one atomic client transaction. Content-only/pin/no-op updates still enter a whole-table statement barrier. |
| Human forward RPC and legacy fallback | [forwardMessage](../../artifacts/kub/src/hooks/useMessages.ts#L1624) tries `forward_message`; [direct fallback](../../artifacts/kub/src/hooks/useMessages.ts#L1637) uses [forwardInsertPayload](../../artifacts/kub/src/lib/messageForward.ts#L73). | `public.forward_message(uuid,uuid,uuid,timestamptz,uuid)` is explicitly VOLATILE SECURITY DEFINER [at 74](../../.migration-backup/supabase/migrations/20260911144000_forward_message_with_media.sql#L74). [INSERT and ready-variant copying](../../.migration-backup/supabase/migrations/20260911144000_forward_message_with_media.sql#L158) are inside its call; fallback is an authenticated table insert, without that variant-copy body. Only a missing RPC selects fallback; an admission refusal [returns an error](../../artifacts/kub/src/hooks/useMessages.ts#L1630), not another writer path. Neither source supplies isolation settings. |
| Moderator report closure | [ReportsTab.resolveReport](../../artifacts/kub/src/pages/admin/ReportsTab.tsx#L239) PATCHes `content_reports`, not `messages`. | `trg_content_report_closed_finishes_deletion` invokes implicit-VOLATILE `private.closed_report_finishes_deletion()` [at 203](../../.migration-backup/supabase/migrations/20260928210000_deleted_message_keeps_nothing.sql#L203); terminal report status causes nested `UPDATE messages SET deleted_at=deleted_at`. The same report transaction reaches the BEFORE-row final scrub [at 133](../../.migration-backup/supabase/migrations/20260928210000_deleted_message_keeps_nothing.sql#L133), then message statement hooks. Coverage refusal can roll back the report PATCH; report-only mutations that execute no message DML are not automatically participants. |
| Other known nested/system writers | Membership's implicit-VOLATILE [write_membership_service_message](../../supabase/migrations/20260930150000_micro_groups.sql#L428) [INSERTs a system row](../../supabase/migrations/20260930150000_micro_groups.sql#L500). Group-call implicit-VOLATILE [voice_group_call_open](../../supabase/migrations/20260930190000_group_chat_calls.sql#L217) INSERTs; [voice_group_call_close](../../supabase/migrations/20260930190000_group_chat_calls.sql#L263) UPDATEs. | A barrier on every message statement reaches these paths even without media. Their outer membership/call transactions inherit any refusal; they are compatibility obligations, not an exhaustive list of system writers/cron entrypoints. Profile-FK sender tombstones, direct owner/service SQL, bulk DML, cascades and TRUNCATE also need their actual permitted execution contexts inventoried before rollout. |

## Volatility And Isolation Boundaries

1. **HTTP is not an isolation setting.** Gateway [callRpc](../../artifacts/api-server/src/bot/repository.ts#L399)
   delegates to `client.rpc` and does not issue BEGIN/SET TRANSACTION. The inspected
   application caller modules contain no `transaction_isolation`,
   `default_transaction_isolation` or SET TRANSACTION configuration. Effective
   PostgREST role/function/session isolation and transaction-end policy remain
   **unknown**, not established RC by a single request or a source declaration.
2. **STABLE readers remain readers.**
   [bot_membership_authorize_internal](../../.migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql#L2552)
   and [bot_can_receive_message](../../.migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql#L2611)
   are STABLE authority helpers. [bot_message_media_references](../../supabase/migrations/20261002222251_bot_message_media_references.sql#L84)
   is SQL STABLE, reading the registry; [bot_media_url_pointer](../../supabase/migrations/20261002222251_bot_message_media_references.sql#L45)
   is SQL IMMUTABLE decoding only. Their declarations do not prove authorization
   freshness after a wait or fresh post-acquisition reference absence. Freshness
   depends on the invoking command and transaction; see the existing prefix review.
3. **The accepted observer is not admission.** Its explicitly VOLATILE
   [AFTER-statement function](../../supabase/migrations/20261002232331_bot_message_media_observations.sql#L74)
   rereads final message rows and maintains observations. The
   [four installed-source trigger definitions](../../supabase/migrations/20261002232331_bot_message_media_observations.sql#L126)
   are distinct from candidate coverage. The [identity bootstrap SET TRANSACTION](../../supabase/migrations/20261002212749_bot_media_logical_identity.sql#L8)
   controls that migration transaction only, not future application calls.
4. **Candidate entrypoints are explicit VOLATILE.**
   [before_write](../../tests/server/fixtures/bot-media-coverage-candidate.sql#L6)
   checks exact `read committed`, returns `0A000` otherwise and tries shared coverage
   (`55P03` on contention); [after_write](../../tests/server/fixtures/bot-media-coverage-candidate.sql#L39)
   performs final/OLD/bound-observation reads in fresh commands. The
   [closer](../../tests/server/fixtures/bot-media-coverage-candidate.sql#L73)
   checks RC and tries exclusive coverage before independent resolver reads; it
   changes only fictional control state. These declarations are not a live install.
5. **Coverage is statement-triggered and transaction-held.**
   [BEFORE I/U/D/TRUNCATE and AFTER I/U/D](../../tests/server/fixtures/bot-media-coverage-candidate.sql#L123)
   are attached to `public.messages`, not HTTP routes. Nested statements reenter
   the same transaction-held shared key. Duplicate/no-message paths may not enter
   it. Fixed-snapshot RR/Serializable and exact-mode READ UNCOMMITTED are unsupported;
   no silent isolation reset is approved. Savepoints need actual lock-lifetime proof,
   not a caller-set flag. The [fixture loader](../../tests/server/bot-media-coverage.fixture.mjs#L18)
   installs this SQL only in disposable fixtures (with a baseline bypass), not runtime.

## Concrete Missing Or Unsupported Surfaces

- **Caller retry semantics are not ready for coverage contention.** Gateway
  [databaseError](../../artifacts/api-server/src/bot/repository.ts#L363) has no dedicated
  `55P03`/`0A000` mapping, so those fall to internal error. UI
  [classifySendFailure](../../artifacts/kub/src/lib/outbox/outboxRules.ts#L76) distinguishes
  unanswered transport from any answered refusal; the runner
  [removes refused entries](../../artifacts/kub/src/lib/outbox/outboxRunner.ts#L103)
  unless explicitly retained. No automatic whole-operation coverage retry is
  established. A future contract must preserve actor, fingerprint/client ID and
  original accounting, reauthenticate each fresh request, and never bypass admission.
- **All message mutations pay the compatibility cost.** The candidate checks OLD
  references too [at 59](../../tests/server/fixtures/bot-media-coverage-candidate.sql#L59).
  Content edits, pinning and moderation cleanup can refuse on closed/unknown
  retained references; restricting the feature to media sends misses these callers.
  Shared/exclusive contention can reject even a media-free system notice. There is
  no currently approved production availability policy for these refusals.
- **Non-message holders still escape the message barrier.** Reserve/attempt/grant,
  report creation/review state, avatar URLs, variant publication and external PUT/
  DELETE need their own participant inventory/protocol. A report closure's nested
  message UPDATE does not fence every moderation hold mutation. The whole-chat-media
  purge hold remains mandatory; message-only success is not deletion eligibility.
- **Uninspected execution contexts remain unsupported evidence, not proven absent.**
  Raw clients can invoke permitted table/RPC writes without the UI. Effective
  proconfig/role settings, retained connections, STABLE enclosing wrappers,
  dynamically executed SQL, cron/migration/admin transactions and trigger/cascade
  topology need exact catalog/behavior evidence. Disabled triggers or replica-role
  bypass are outside the prototype's application-role guarantee. No permissions
  should be broadened to make a coverage test pass.

## Next Bounded Acceptance Obligations

These are proposed oracles, **not tests executed by this sidecar**. The coordinator
owns actual waited-authority tests; use the prefix review for their lock sequences.

| Gate | Required caller-specific outcome |
| --- | --- |
| Effective RC configuration | Capture actual API role/function/session isolation and commit policy for human insert/PATCH/RPC, service command and commit, and nested moderator writes. Test deployed-equivalent configuration locally; a source-level `client.rpc` is not this proof. |
| Unsupported isolation | Seed RR/Serializable snapshots before a separate close, then invoke actual send/file_id/commit/forward, direct PATCH and report closure; reject before committing message/report/result/accounting effects. Exercise READ UNCOMMITTED's exact-mode refusal separately. Treat no-DML duplicate/no-op returns separately rather than asserting all RPC calls must reject. |
| Volatility/snapshot freshness | Execute actual VOLATILE caller chains around the candidate, including nested moderation and final-row observer. Prove post-acquisition fresh scans and STABLE-helper invocation boundaries; an untested enclosing wrapper is not approved. Preserve the authority-after-wait comparison with baseline. |
| Busy retry and fallback | Actual `55P03` must roll back the whole current operation. Distinguish it from missing-RPC/schema fallback and `0A000`; verify the user-visible retry uses unchanged idempotency/client identity with fresh authority, no consumed grant/completion/result from the refused transaction, and no duplicate send. Earlier reserve/PUT stays held. |
| Non-media/nested compatibility | Pin/content-only/system/member/call writes and terminal report PATCH must either complete with existing authority or return a documented atomic refusal; no silent outer success after a rolled-back nested operation. Report-held media and final scrub stay observable. |
| Remaining production gates | Exact PG17/full schema, owners/ACL/RLS/proconfig, enabled triggers, bootstrap/rollback and every non-message participant remain separate. Keep all reclamation and native publication closed. |

## Validation

Only local source reads and this new document were authorized. Validation is
focused relative-link/line-anchor existence and whitespace diff checking, not an
application suite or fresh database rehearsal. Other owners' files are untouched.
