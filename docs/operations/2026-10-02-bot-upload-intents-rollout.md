# Bot Upload Intent Rollout

Date: 2026-10-02. Owner: Codex coordinator.
Source: reviewed candidate `ba7871c2`, runtime `9b41605d`, SQL `bb0bec42`.
Production before-state: web `ebb050a3`; Gateway/worker `2900eeb7`.
Source acceptance: [upload intents](2026-10-02-bot-media-upload-intents.md).

## Resume

Stage: fresh full PostgreSQL 17 restore accepted; guarded production apply next.
No production SQL or new runtime has been applied by this rollout yet.
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
- [ ] Independently review the narrow guarded production-apply helper.
- [ ] Take another verified before-state backup and apply the additive SQL once.
- [ ] Independently verify new bodies/owners/RLS/ACL and unchanged old functions
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

## Rollback And Remaining Work

Pause new admissions and restore compatible old runtime before disabling the
new RPCs. Keep the ledger and pending/unknown holds. In-flight finalizers may
leave pending rows; those are not safe deletion/refund candidates. Re-enabling
RPCs over the retained ledger needs a separately reviewed recovery path.

Writer/generation fencing, D-103 purge and legacy/encoded reference coverage
remain open. No deletion, pruning or quota release is authorised by this rollout.
