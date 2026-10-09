# Push Session Retirement

Owner: coordinator. Source branch: `codex/bot-inline-media-20261002`.
Current stage: installed once, independently read back, and accepted by ordinary
Realme QA Auth/binding/logout with server retirement. All three exact-owned QA
packages were removed; primary/test app data and users were preserved. Narrow
Git publication is pending. Stable Android remains 0.1.14/build15.

## Observed Cause

The genuine Task5 QA client passed normal rendered login, native device binding
and ordinary logout on Realme, using the same accepted target APK, not a mocked
Auth flow. All five calibrated booleans passed. Post-logout read-only counts for
the owned QA account/attempt showed no new Auth sessions or non-revoked refresh
tokens, but one enabled Android FCM endpoint remained. That observer is bounded
by account/time, not exact session ID; it is not delivery evidence.

Live catalog inspection confirmed `user_push_devices.session_id` uses
`ON DELETE SET NULL` without a custom retirement trigger. The seven-argument
legacy registrar could accept an unexpired JWT carrying an already-deleted SID
and re-enable an unbound endpoint. A draft frontend pre-signout fix was withdrawn
after review exposed concurrency/lifecycle/offline races. It was never deployed.

## Installed Fix And Validation

- A private, fixed-search-path definer trigger retires only endpoints matching
  both the deleted SID and its owner, before the FK clears SID. Token rotations
  for that SID are covered; other sessions, users and truly SID-less legacy
  endpoints are preserved. No existing orphan backfill is performed.
- Registration with a SID claim requires a live matching session, including
  legacy overloads. Public signatures/grants and generic push protocol stay the
  same. The change does not promise offline server logout.
- Actual SQL PGlite/PG18 controls reproduced the shipped failure, then passed
  15/15, including five mutants. Four rollback drift cases first failed with
  missing rejection, then passed after independent review's P2 was corrected.
  Body, owner, definer, path and ACL are checked before rollback removes the hook.
- Fresh exact-target before-state backup:
  `/srv/letscube/backups/push-retirement-20261010-r1`; archive 6,118,331 bytes,
  six checksums verified, archive readable and old function marker confirmed.
  This is not a claim of successful full restore.
- Actual PG17 rollback-only rehearsal passed: two old-session endpoints retired,
  successor preserved, late legacy registration refused, rollback restored the
  original registrar. After outer rollback, exact catalog matched and all
  fictional fixture sessions/endpoints were absent.
- Actual two-connection PG17 rehearsal passed six ordered cases: registration,
  rotation and successor rebind, each registration-first and deletion-first.
  `pg_blocking_pids` proved overlap. Every deletion committed; deletion-first
  old registration/rotation refused with 23503, successor rebind survived.
  No timeout/deadlock was counted as acceptance. Scratch rollback and exact-owned
  database removal passed; the production target remained unchanged by rehearsal.
  This is bounded coverage, not proof of every possible concurrent/offline flow.
- Two earlier concurrency harness attempts refused before any scenario and
  cleaned their scratch databases. The real container uses BusyBox timeout and
  has no stdbuf; only the harness adapter changed. A read-only flush control
  proved psql barriers before the accepted run.
- Canonical migration: `20261009205919_push_session_retirement.sql`, SHA256
  `839f13fd062b85e3578af671049c1d043c3d0ba067d842e3fa9ff4c721723039`;
  rollback SHA256
  `359e5a0608e5d2366b19bd54fc78f0c6bcfa6436532462107660465078cc9dcd`.
  Both are byte-identical to their proposal and migration-backup copies.
- Production SQL was dispatched exactly once. The first postcheck rejected
  regclass pretty-printing (`sessions` instead of `auth.sessions`), not the
  migration. An independent verification-only read checked the exact relation
  OID, function bodies/trigger and preserved RLS/rights/schema/unregister contract.
  It passed without replaying SQL; the original observer failure is retained.
- A new ordinary Realme run on the unchanged accepted QA target APK passed one
  test, zero skips, all five rendered Auth/native-binding/logout booleans. All
  owned endpoints were inactive afterward, including the original QA orphan
  retired by normal re-registration/logout; no new sessions remained. This
  account/time-window observer is not exact-SID delivery proof or broad backfill.
- The native-controller mutation-loader harness was repaired for three relative
  imports; its focused selection passed40/40. The interrupted aggregate suite
  remains interrupted, not PASS.

## Remaining Work

Publish only this reviewed SQL/test/evidence slice from a main-based worktree;
keep unfinished native-preview commits separate. Then continue actual native
credential/explicit-choice/composition acceptance. Do not rerun completed Task5
binding/logout just to produce another green count. No natural FCM delivery,
notification-card display, rich preview or native Stable acceptance is claimed.
Source-suite execution interrupted during the rejected draft is not a PASS.
Secrets, raw instrumentation, personal screens and message content are not in
this report. A063, primary APK/data and pre-existing test APK were unchanged.
