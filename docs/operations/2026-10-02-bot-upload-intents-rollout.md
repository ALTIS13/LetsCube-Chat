# Bot Upload Intent Rollout

Date: 2026-10-02. Owner: Codex coordinator.
Source: reviewed candidate `ba7871c2`, runtime `9b41605d`, SQL `bb0bec42`.
Production before-state: web `ebb050a3`; Gateway/worker `2900eeb7`.
Source acceptance: [upload intents](2026-10-02-bot-media-upload-intents.md).

## Resume

Stage: guarded additive SQL applied once at 20:17 MSK; independent verification
accepted. Reviewed mandatory-RPC runtime publication and provider canary next.
No new runtime has been deployed by this rollout yet.
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
- [ ] Publish the mandatory-RPC runtime only after the database gate passes.
- [ ] Verify exact running revisions and a synthetic actual-provider canary.
- [ ] Remove only the owned isolated container and close workers; record the
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

## Rollback And Remaining Work

Pause new admissions and restore compatible old runtime before disabling the
new RPCs. Keep the ledger and pending/unknown holds. In-flight finalizers may
leave pending rows; those are not safe deletion/refund candidates. Re-enabling
RPCs over the retained ledger needs a separately reviewed recovery path.

Writer/generation fencing, D-103 purge and legacy/encoded reference coverage
remain open. No deletion, pruning or quota release is authorised by this rollout.
