# Transaction-wide coverage: prefix review

Date: 2026-10-03. Source baseline: `e9d713d49d348c0fccac465be9cec5bef6763153`,
branch `codex/bot-inline-media-20261002`. Owner: independent source-review sidecar.
Stage: complete source assessment; coordinator owns prototype and session tests.
Evidence: repository sources below, not a fresh live catalog or executed race.
Blocker: actual coverage/snapshot/auth acceptance. Next: controlled local sessions.

## Judgment and boundary

The proposed single transaction-wide shared/exclusive **try-only** coverage key
can avoid adding an advisory-lock wait edge. A writer must refuse with `55P03`
when shared acquisition fails; the closer must similarly refuse exclusive
acquisition. Neither retries/waits inside the transaction, upgrades object locks,
nor acquires quota/operation/member/Storage/message-row locks as a closer.
The shared lock remains through later writer statements, not just one statement.
This removes the particular per-object reverse-order closer cycle, not every
existing writer-writer deadlock or SQL/table-lock wait.
Updating fixture control rows is not intrinsically nonblocking: every permitted
control writer must be serialized by the exclusive coverage key, or those writes
need a separate nonwaiting/refusal rule. Do not let the closer wait on an
uncovered row owner while it retains exclusive coverage.

This is conditional design assessment, not acceptance of coordinator code. Fresh
READ COMMITTED observations after successful acquisition and final-row checks
remain load-bearing. Existing authority must stay independent. Message-only
coverage is not avatar/variant/external-I/O coverage, physical generation,
provider terminality, deletion eligibility, or quota-release permission.
The applied whole-`chat-media` purge hold stays unchanged.

## Exact source prefixes

These links identify repository definitions/deltas, not verified live bodies.

| Path | Existing order before the proposed message-statement boundary |
| --- | --- |
| Ingest reserve | [quota then operation](../../supabase/migrations/20261002020000_bot_inline_media_ingest.sql#L204), token/bot SHARE at 206, membership SHARE/authorize at 212, receipt UPDATE lock at 218. Receipt/identity/PUT intent work alone does not execute a message statement. |
| Ingest commit | [quota/operation and token/bot SHARE](../../supabase/migrations/20261002020000_bot_inline_media_ingest.sql#L282), receipt UPDATE at 290, membership SHARE/authorize at 297, Storage SHARE at 320, grant authorization at 328, wall-clock lease recheck at 329, command/send at 336, receipt completion at 337. Preserve all of these locks and checks. |
| Upload begin/finish | [begin](../../supabase/migrations/20261002155123_bot_media_upload_intents.sql#L112): operation, token/bot SHARE, receipt UPDATE, membership SHARE, then clock/lease at 138. Finish at 165 uses operation/attempt, intentionally recording a persisted outcome rather than current-token authorization. Neither path proves reference coverage. |
| Existing-media grant | [authorization](../../.migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql#L2803) and Storage existence precede grant-key advisory wait at 2820 and grant UPDATE lock at 2839. [Accepted ingest delta](../../supabase/migrations/20261002020000_bot_inline_media_ingest.sql#L55) strengthens object attributes, not that order. |
| Bot command/send and `file_id` | [command membership check](../../.migration-backup/supabase/migrations/20260919040000_a_bot_can_send_back_the_file_it_was_sent.sql#L302) precedes operation at 310; send at 453 checks membership before its operation at 461. `file_id` source/visibility is read at 531; ordinary media waits on grant at 664; INSERT starts at 695; idempotency and grant consumption follow. [Ingest command delta](../../supabase/migrations/20261002020000_bot_inline_media_ingest.sql#L94) adds the receipt guard under the existing operation lock, not quota acquisition. |
| Forward RPC | [source/visibility reads](../../.migration-backup/supabase/migrations/20260911144000_forward_message_with_media.sql#L104), destination membership/mute/topic at 128, INSERT at 158, ready variant copying at 182. No quota/operation prefix or source row lock. The RPC is SECURITY DEFINER at 84. The direct fallback has a separate RLS path. |
| Message row prefix | [BEFORE INSERT epoch](../../supabase/migrations/20260926144000_bot_privacy_delivery_epoch.sql#L219) waits for active membership SHARE in bot-id order. It does not itself reject a now-removed sending bot or rerun `file_id` visibility. [Path guard](../../.migration-backup/supabase/migrations/20260913131000_message_media_path_guard.sql#L84) rereads forward canonical pointer equality, not source audience authorization; it does not fire for URL/metadata-only UPDATE. |
| Identity/grant hooks | [grant identity trigger](../../supabase/migrations/20261002212749_bot_media_logical_identity.sql#L228) inserts retained UUID/path claims and binding at 280. These uniqueness/FK checks can have their own existing waits before message insertion. Do not replace them with the coverage key. |

The bot `file_id` gateway also has an authority boundary outside the transaction:
[token lookup](../../artifacts/api-server/src/bot/repository.ts#L308) authenticates
the request, whereas [command RPC parameters](../../artifacts/api-server/src/bot/repository.ts#L673)
do not carry token ID. Ingest commit does carry it at 727 and locks that token.
Do not claim identical in-flight token-revocation guarantees for these paths or
reuse an already-authenticated request context for a fresh retry.

## Snapshot and authorization obligations

1. **Acquisition is not snapshot refresh.** A statement can start before a writer
   commits but execute a successful exclusive try-lock after that commit. A
   materialized pre-lock result, STABLE caller, or one lock-and-scan SQL statement
   is not a fresh post-acquisition negative-reference proof. Use a separate fresh
   READ COMMITTED command inside a VOLATILE coordinator helper after acquisition.
   The [accepted resolver](../../supabase/migrations/20261002222251_bot_message_media_references.sql#L84)
   is STABLE; its freshness comes from the invoking query, not the try-lock.
   The same obligation applies to the writer's final closed-state read.
2. **Refuse unsupported isolation; do not silently reset it.** REPEATABLE READ and
   SERIALIZABLE may retain a snapshot predating a committed close. Both writer and
   closer helpers must check isolation before using the protocol. Tests must
   exercise a transaction whose earlier snapshot already exists, not only a
   connection default. READ UNCOMMITTED is not the explicitly approved RC mode.
3. **File reuse has an existing post-read wait.** Hold a membership row update
   uncommitted, let `file_id` read the old full-visibility source, then stop the
   send at the epoch SHARE wait. Commit privacy `full -> restricted`, removal,
   or a later join epoch before releasing it. Membership/source checks at 453/531
   are earlier than that wait. Coverage success and pointer registration alone
   cannot prove fresh authorization. Run accepted baseline and candidate; prove
   refusal/revalidation or name the retained baseline gap rather than attributing
   it to the new key. Ingest's retained token/member SHARE locks are different:
   they prevent a competing mutation from committing after those locks are held.
4. **Forward source and destination authority are separate.** After source and
   destination checks, pause at the destination's existing epoch row wait; commit
   source removal/hiding/clear or destination mute/removal. A canonical pointer
   equality check is not a source-visibility check, and this definer RPC does not
   gain the fallback's RLS guarantees. Characterize baseline/candidate separately.
5. **No lifecycle authority from a refused or failed message.** An ingest commit
   can reach coverage after grant/receipt work; failure must roll back that
   transaction's new consumption, message, result and completion. Earlier reserve,
   separate grant RPC and external PUT effects are not rolled back by a later SQL
   error. Original charges and pending/unknown attempts remain held.

## Concrete independent-session acceptance cases

Use fictional databases and actual loaded prefix/helper definitions. Pause at
named test-only barriers and confirm `pg_locks`/`pg_blocking_pids`; elapsed time or
sleep alone is not an oracle. Test barriers are not part of the proposed protocol.

| Case | Controlled interleaving and literal oracle |
| --- | --- |
| C1 writer-first / closer-first | Writer holds shared coverage across a successful statement: closer returns `55P03`, with no queued coverage wait. Closer holds exclusive: new writer returns `55P03`. After close commits and the key is free, a new writer may acquire shared but must refuse the closed final pointer. Zero committed references after close. |
| C2 reversed statements / nested / UPSERT | A writer writes B then A in separate statements; also nested B-to-A and ON CONFLICT UPDATE/INSERT combinations from the earlier counterexamples. A concurrent closer immediately refuses, rather than waiting on an exclusive object key. Preserve rollback/accounting; do not assert all pre-existing row deadlocks are impossible. |
| C3 fresh closer snapshot | Pause closer after its outer statement snapshot but before try-lock. Writer commits a known reference, then closer acquires exclusive. It must see that reference and leave control open. A same-statement/precomputed-read mutant must fail this oracle. |
| C4 fresh writer closed-state | Pause writer after outer statement snapshot but before shared acquisition. Closer commits closed control state. Resume writer: successful shared acquisition must still lead to final-pointer refusal. A STABLE/pre-lock state-read mutant must fail. |
| C5 isolation and savepoints | Preseed RR/Serializable snapshots, close in another session, then attempt writer/closer: fail before effects. In RC, acquire coverage inside a savepoint, roll back it, and attempt another statement: actually reacquire, not a cached GUC flag. A committed pre-savepoint write retains coverage. |
| C6 prefix waits / no inverse closer wait | Pause ingest on quota/operation/Storage/grant or identity-claim prefix before coverage. Closer must neither acquire those keys nor wait for writer-owned rows. If it closes while the writer has not acquired coverage, the later writer refuses closed admission and its commit work rolls back. After writer already holds coverage, closer refuses immediately even if that writer is waiting on an old row prefix. |
| C7 ingest token/member/clock | Revoke token or remove member while commit waits before acquiring the corresponding SHARE lock: refuse fresh authorization. Conversely, once token/member SHARE are held, revocation/removal must remain blocked, not commit unnoticed. Expire the lease at the existing Storage/grant wait: keep the clock-based refusal at line 329. |
| C8 file_id authority | Execute the full-to-restricted/removal/rejoin epoch interleaving above with an otherwise readable same-chat source; compare baseline/candidate behavior. Cross-chat, pre-join and unreadable controls stay refused. No message, consumed grant or new idempotent result on denial. |
| C9 forward RPC and fallback | Execute the source/destination revocation wait above through real forward RPC and direct permitted fallback separately. Preserve bans, mute, topic, source hiding/clear and attribution. Copying variants does not enlarge message-only coverage into variant fencing. |
| C10 global unknown hold / atomic batch | Known eligible fixture object plus one unrelated unresolved or ambiguous message anywhere: no control target closes. Cover unsupported URL, unregistered other bucket, malformed preview, known conflicting pointers and deleted-but-moderation-retained media. Unsupported is not absent; a later candidate failure must not leave earlier controls closed. |
| C11 final rows / reentrancy / privilege | URL-only/preview-only UPDATE, DELETE/TRUNCATE, nested rewrites and attempted sender/path spoofing retain existing authority. Final reread must catch nested replacement with a closed pointer. Same-backend exclusive/shared reentrancy must not bypass the final closed-state rule. Client roles cannot write control state; caller-set flags or key parameters cannot bypass fixed-key acquisition and the final guard. |

For C6/C7 compare immutable receipt snapshots, original charge time/bytes, attempt
bindings and persisted outcomes with the state before the tested commit. Do not
mistake unchanged earlier reservations/PUT attempts for failed rollback.

## Explicit exclusions and validation

The closer scans final `public.messages` through the resolver, not merely the
derived observation ledger. [Current final-row observer](../../supabase/migrations/20261002232331_bot_message_media_observations.sql#L98)
is evidence of nested/OLD+NEW handling, not existing admission. Registered means
logical identity only. The receipt/attempt/grant, avatars, variant sources/targets,
and remote PUT/DELETE channels remain separate obligations. No production closer,
Storage removal, physical seal, accounting reset or automatic retry is approved.

This sidecar read source and wrote only this report. No PostgreSQL session/test,
production/SSH/API call, secret read, native operation, commit or push was made.
Behavioral cases above are required future oracles, not results. This is bounded
to named prefixes; it is not an exhaustive writer/catalog or auth audit.
