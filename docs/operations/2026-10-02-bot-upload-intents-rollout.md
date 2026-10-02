# Bot Upload Intent Rollout

Date: 2026-10-02. Owner: Codex coordinator.
Source: reviewed candidate `ba7871c2`, runtime `9b41605d`, SQL `bb0bec42`.
Production before-state: web `ebb050a3`; Gateway/worker `2900eeb7`.
Source acceptance: [upload intents](2026-10-02-bot-media-upload-intents.md).

## Resume

Stage: guarded additive SQL and reviewed mandatory-RPC runtime are deployed.
Actual-provider canary and independent database/Storage metadata verification
pass. All owned workers are closed; this record is the documentation closeout.
No reapply or resend is needed.
No Android build/install/publication or destructive media cleanup is included.

## Gates

- [x] Fresh archive `20261002-194924`: at least 15 checksums pass; full database
  archive is readable. Private roles backup excludes passwords.
- [x] Full restore into the same PostgreSQL 17.6 image, not a reduced fixture.
  `pg_restore --exit-on-error`, explicit database/socket/role, no `--create`,
  `--no-owner` or `--no-acl`; roles and default privileges retained.
- [x] Isolation before restore: network none, no ports/mounts, non-root UID,
  not privileged, 1 GiB/one CPU limit. Cron launch is off before any archive
  statement; restored jobs are disabled. No API or provider process runs there.
- [x] Exact SQL and rollback hashes match reviewed source and archive copies.
  Nine behavioral groups pass; additional exact whole-file reapply refusal
  preserves the ledger hash and leaves both RPCs absent.
- [x] Actual role-switched SELECT/INSERT/UPDATE/DELETE denials: 12/12. PG17
  membership/INHERIT/SET chains provide no client/service/authenticator path to
  `postgres` or `supabase_admin`. Restored defaults, old function catalogs,
  table/column grants and policies remain unchanged.
- [x] Independently review the narrow guarded production-apply helper.
- [x] Take another verified before-state backup and apply the additive SQL once.
- [x] Independently verify new bodies/owners/RLS/ACL and unchanged old functions
  and Storage policies; reload the PostgREST schema cache.
- [x] Publish the mandatory-RPC runtime only after the database gate passes.
- [x] Verify exact running revisions and a synthetic actual-provider canary.
- [x] Remove only the owned isolated container and close workers; record the
  final checkpoint and remaining fencing work.

## Restore Evidence

The initial shipped control refuses begin with SQLSTATE `42883`. Installing the
exact candidate leaves prior public/private/storage function metadata, relations,
column ACLs, all policies and default ACLs equal. Nine-table before/after data
aggregates are equal; no copied personal row/body is exposed.

Actual restored service-role calls prove pending admission, one attempt per
lease, object metadata/grant/message commit, completed retry returning the
original receipt, retained unknown after a new lease succeeds, contradictory
outcome refusal, and late acknowledgement after revocation with commit refused.
The literal 64/65 cap includes pending and acknowledged attempts. Four synthetic
receipts retain 272 charged bytes. Rollback retains all 68 attempt rows (32
pending, one unknown and 35 acknowledged), charged receipts, messages, objects
and the prior catalog; only the two new RPCs disappear. Exact reapply refuses
`bot_media_upload_prestate_exists` and keeps the private aggregate hash equal.

Two preliminary harness failures are not acceptance: restored registration
requires an invite, and the existing reserve result has `duplicate`/`lease_id`,
not a `state` field. The isolated fixture temporarily changes the invite-only
setting inside its setup transaction and restores the original boolean before
commit; auth triggers and RLS remain enabled. It creates fictional identities
only, never edits copied users/invites. Clean restores separate the repaired
fixture runs. No product SQL/runtime change was needed.

Root-only server receipts/logs are under
`/srv/letscube/backups/bot-upload-intents-20261002`; backup and personal data
never leave the server. This is database/metadata proof, not a restored Storage
byte service or provider-terminal-state proof. Previous PG18 concurrency,
mutation and handler tests remain valid source evidence, not live acceptance.

The actual web build also passes: `sw.js build d9324cbfbe9c2199`, built in
37.28 seconds. Existing sourcemap and large-chunk warnings are present; no
unrelated frontend patch is claimed. QA account/disposable-bot preflight passes
with zero mutations. It does not substitute for the post-deploy canary.

## Production Apply

Fresh before-state backup `20261002-201708` passes checksums and archive listing.
Database archive SHA-256:
`ce5d860480fe9fac2daeba06577af7b4fd9bec8f6c657a6c5ebbd6644bf30c26`.
An additional full archive bound to the pinned production socket/cluster has
SHA-256 `284be0be4da28181b5a763444259da9e9096a293d2ea7976860075d044966185`.
Both are root-only and remain server-side. Before/after identity, old function
bodies/ACLs and the policy fingerprint are guarded.

The apply helper records a prepared attempt durably before its single SQL call.
Lost acknowledgements are independently reconciled, never blindly retried or
rolled back. An immediately absent table after a disconnected call is UNKNOWN:
a delayed commit is not ruled out. The reviewed envelope passes 9/9 behavioral
cases, including a forced late commit and a prepared-record omission mutant.

At `2026-10-02T17:17:45.891Z`, attempt and apply receipts report `verified`.
A separate SSH/psql connection confirms PostgreSQL 17.6, both exact new bodies,
`postgres` ownership, empty search paths, service-role-only execution and private
ledger RLS. Initial rows/policies/direct grants/unsafe owner paths are zero;
all public tables retain RLS, old function metadata and Storage policies are
unchanged. PostgREST schema cache reload is complete. Do not reapply the SQL.

## Runtime And Provider Acceptance

Reviewed source reached the candidate branch first and then `main` at
`856e03e495cc53ba6b9cbbb2b74427bcb0e85409`, after fresh fetch, separate outgoing
range review and own-commit-tree alias checks. Gateway was deployed deliberately;
web, worker and support mail completed their configured automatic rollouts.
At acceptance, Gateway/worker/web each have one healthy exact-revision replica.

The old Gateway bundle SHA-256 is
`68f71ac9cec8a7e67a7ec37ed1889dd1808b50f037cc8105dc9e097d578aeec1`:
reserve is present; begin/finish are absent. New Gateway and the worker's built
Gateway artifact both have SHA-256
`4ee2d694ff13daa49f1b4ba77524b649fbc9509fc7349f964de6b1813943277e`,
with all three markers present. This is bundle/runtime proof; the worker's main
entry does not itself host Bot API routes.

Web public/container entry and SW hashes match and remain byte-identical to the
prior accepted web wave. Entry SHA-256:
`e5e2d0993054d46996c5b30e55954d139217d75cc0a57e7056984a6fe999436d`;
SW SHA-256: `74d2cd9a7e779853db9af7e9465c61c2d35097489a74c0c8cfd7b6801f2b0cbc`.
New/removed documentation markers and both retained old entry hashes pass.
No frontend behavior or installed-native acceptance is inferred from this.

The public API canary passes 9/9 against actual Storage: seven inline formats,
exact downloaded SHA-256/MIME/size, identical retry receipts, changed-payload
409, reference resends, exactly 14 bot messages and an unmentioned incoming
user photo readable by the full-access bot. It uses only a fictional QA group
and the disposable QA bot. The exact group is removed, bot token revoked and
bot returned to pending deletion.

Independent REPEATABLE READ READ ONLY verification at 20:44 MSK confirms seven
acknowledged attempts, seven complete charged receipts / 11,810 bytes, zero
pending/unknown attempts in that cohort, equal chat identity in both ledgers,
and seven matching `chat-media` metadata rows. Retries/resends add no attempts.
The full aggregate is now 28 complete charged receipts / 47,240 bytes and 28
matching metadata rows, with zero reserved receipts. Earlier 21-row reports are
historical snapshots, not current cleanup candidates.

Two observer findings are explicitly instrument corrections, not product
regressions. An unrelated absent group could previously pass cleanup attribution:
the actual shared validator now requires both chat booleans strictly true.
Legacy assertions are RED (3 pass / 5 fail); corrected assertions pass 8/8 and
both omission mutations fail. The first live observer queried `media` instead
of authoritative `chat-media`, returning zero objects. Independent control
returns seven correct-bucket rows, zero wrong-bucket rows and seven matching
metadata rows; the corrected observer passes without rerunning the canary.
Independent scoped re-review accepts both instrument corrections with no new
P1/P2; it does not claim to have executed the live checks. The query/validator
proof and coordinator-executed provider byte proof are distinct.

Apply/attempt/runtime/canary receipts and the pinned archive are root:600 in the
private server record directory. No message body, path, credential, dump or
provider diagnostic enters this report. No Storage deletion, charge release,
native operation or paid cloud session occurred. Lost-response/crash/revocation
faults remain source/isolated-database evidence; this live canary tests normal
provider behavior, not injected production failures.

The exact owned restore container is absent after guarded removal. All workers
and needed test/build processes have completed. A documentation-only closeout
may advance the web image tag; backend revisions and web content hashes above
remain the accepted behavior baseline. Verify its final healthy web image and
public/container parity separately, without resending or reapplying anything.

## Rollback And Remaining Work

Pause new admissions and restore compatible old runtime before disabling the
new RPCs. Keep the ledger and pending/unknown holds. In-flight finalizers may
leave pending rows; those are not safe deletion/refund candidates. Re-enabling
RPCs over the retained ledger needs a separately reviewed recovery path.

Writer/generation fencing, D-103 purge and legacy/encoded reference coverage
remain open. No deletion, pruning or quota release is authorised by this rollout.
